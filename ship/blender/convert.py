"""Конвертация ассета в Blender (bpy 5.x, без GUI):
glTF → Vesper_Explorer.blend (текстуры по относительным путям) + Vesper_Explorer.fbx (для Unity) + коллайдеры FBX
и превью-рендеры Cycles. Запуск: uv run --python 3.11 --with bpy python blender/convert.py [--render] [--only-render]
"""
import bpy, os, sys, math, json, time
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT = os.path.join(ROOT, 'export')
TEXDIR = os.path.join(EXPORT, 'Textures')
GLTF = os.path.join(ROOT, 'build', 'gltf', 'Vesper_Explorer.gltf')
COLS = os.path.join(ROOT, 'build', 'gltf', 'Vesper_Explorer_Colliders.gltf')
PREV = os.path.join(EXPORT, 'Previews')
args = sys.argv[1:]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.unit_settings.scale_length = 1.0


def import_gltf(path):
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=False, import_shading='NORMALS')


def relink_images():
    missing = []
    for img in bpy.data.images:
        if img.source != 'FILE':
            continue
        name = os.path.basename(bpy.path.abspath(img.filepath))
        target = os.path.join(TEXDIR, name)
        if not os.path.exists(target):
            missing.append(name)
        img.filepath = target
        img.name = os.path.splitext(name)[0]
        if img.packed_file:
            img.unpack(method='REMOVE')
    return missing


def tidy_scene():
    # коллекции верхнего уровня по корневым узлам (удобно скрывать интерьер/свет)
    root = bpy.data.objects.get('VESPER_Explorer')
    scene_col = bpy.context.scene.collection
    for top in (root.children if root else []):
        col = bpy.data.collections.new(top.name)
        scene_col.children.link(col)
        stack = [top]
        while stack:
            o = stack.pop()
            for c in list(o.users_collection):
                c.objects.unlink(o)
            col.objects.link(o)
            stack.extend(o.children)
    if root:
        for c in list(root.users_collection):
            c.objects.unlink(root)
        scene_col.objects.link(root)
    # пустышки — маленькие стрелки, чтобы не мешали
    for o in bpy.data.objects:
        if o.type == 'EMPTY':
            o.empty_display_size = 0.3


def export_fbx(path, object_types={'EMPTY', 'MESH', 'LIGHT'}):
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=False, object_types=object_types,
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', bake_space_transform=True,
        axis_forward='-Z', axis_up='Y', mesh_smooth_type='OFF', use_mesh_modifiers=True,
        add_leaf_bones=False, path_mode='RELATIVE', embed_textures=False, use_custom_props=True)


def setup_render(samples=48, w=1600, h=900):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    try:
        s.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    s.cycles.max_bounces = 6
    s.cycles.transparent_max_bounces = 12
    s.render.resolution_x, s.render.resolution_y = w, h
    s.render.film_transparent = False
    s.view_settings.view_transform = 'AgX'
    try:
        s.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    world = bpy.data.worlds.new('Space')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.004, 0.006, 0.01, 1)
    bg.inputs['Strength'].default_value = 1.0
    s.world = world


def add_camera(name, loc, target, lens=35, clip_start=0.1):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.clip_start = clip_start
    cam_data.clip_end = 3000
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam


def render(cam, name, samples=None, exposure=0.0, sun=True, interior_lights=True):
    s = bpy.context.scene
    s.camera = cam
    if samples:
        s.cycles.samples = samples
    s.view_settings.exposure = exposure
    for o in bpy.data.objects:
        if o.name.startswith('Preview_Sun') or o.name.startswith('Preview_Rim'):
            o.hide_render = not sun
        elif o.type == 'LIGHT':
            o.hide_render = not interior_lights
    os.makedirs(PREV, exist_ok=True)
    s.render.filepath = os.path.join(PREV, name + '.png')
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'render {name}: {time.time() - t:.1f}s', flush=True)


def preview_lights():
    sun = bpy.data.lights.new('Preview_Sun', 'SUN')
    sun.energy = 4.0
    sun.angle = math.radians(0.6)
    so = bpy.data.objects.new('Preview_Sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(-25), math.radians(140))
    bpy.context.scene.collection.objects.link(so)
    rim = bpy.data.lights.new('Preview_Rim', 'SUN')
    rim.energy = 1.2
    rim.color = (0.55, 0.7, 1.0)
    ro = bpy.data.objects.new('Preview_Rim', rim)
    ro.rotation_euler = (math.radians(-120), math.radians(10), math.radians(-30))
    bpy.context.scene.collection.objects.link(ro)


def main():
    t0 = time.time()
    only_render = '--only-render' in args
    if not only_render:
        reset()
        import_gltf(GLTF)
        missing = relink_images()
        tidy_scene()
        stats = {
            'objects': len(bpy.data.objects), 'meshes': len(bpy.data.meshes), 'materials': len(bpy.data.materials),
            'images': len(bpy.data.images), 'lights': len([o for o in bpy.data.objects if o.type == 'LIGHT']),
            'tris': sum(sum(len(p.vertices) - 2 for p in m.polygons) for m in bpy.data.meshes), 'missing_images': missing,
        }
        print('BLENDER_STATS', json.dumps(stats), flush=True)
        export_fbx(os.path.join(EXPORT, 'Vesper_Explorer.fbx'))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXPORT, 'Vesper_Explorer.blend'), relative_remap=True, compress=True)
        # коллайдеры
        reset()
        import_gltf(COLS)
        export_fbx(os.path.join(EXPORT, 'Vesper_Explorer_Colliders.fbx'), {'EMPTY', 'MESH'})
        print(f'convert done in {time.time() - t0:.1f}s', flush=True)
    if '--render' in args or only_render:
        bpy.ops.wm.open_mainfile(filepath=os.path.join(EXPORT, 'Vesper_Explorer.blend'))
        setup_render()
        preview_lights()
        # Blender: нос → −Y, правый борт → +X, верх → +Z
        shots = [
            ('01_Exterior_Hero', (-62, -58, 24), (0, -6, -1), 40, 0.1, 64, 0.0, True),
            ('02_Exterior_Rear', (48, 70, 16), (0, 22, -1.5), 40, 0.1, 64, 0.0, True),
            ('03_Section_Starboard', (40, -2, 1.0), (0, -2, 1.0), 18, 31.6, 48, 1.0, False),
            ('04_Command_Bridge', (0.4, -27.6, 4.15), (-1.0, -41.0, 3.2), 18, 0.05, 64, 1.2, False),
            ('05_Reactor_Core', (-4.6, 21.0, -3.6), (0, 26.0, -4.2), 16, 0.05, 64, 1.0, False),
            ('06_Corridor_DeckB', (0, 12.0, 0.15), (0, -14.0, 0.05), 16, 0.05, 48, 1.0, False),
        ]
        only = [a.split('=', 1)[1] for a in args if a.startswith('--shot=')]
        for name, loc, tgt, lens, clip, smp, exp, sun in shots:
            if only and not any(name.startswith(o) for o in only):
                continue
            cam = add_camera('Cam_' + name, loc, tgt, lens, clip)
            render(cam, name, smp, exp, sun=sun)


main()
