# Контрольные рендеры (Cycles). Запуск: python ship/render.py <файл.blend|glb> <папка> [шоты через запятую]
import math
import os
import sys
import bpy
from mathutils import Vector

SHOTS = {
    # имя: (позиция камеры, цель, фокус мм)
    "ref": ((-70, -74, 30), (0, -4, -1), 40),        # ракурс референса: левый борт, нос справа
    "side": ((150, -2, 2), (0, -2, 0), 38),
    "top": ((0, 1, 170), (0, 1, 0), 40),
    "rear": ((-62, 92, 28), (0, 8, 0), 40),
    "bow": ((30, -82, 6), (0, -38, 1), 40),
    "below": ((55, -40, -45), (0, 0, -3), 38),
    "detail": ((26, -14, 8), (11, -26, 3), 40),
}
# интерьер (включаются точечные источники): позиция, цель, фокус
INTERIOR = {
    "i_hall1": ((-6.5, -23.5, 0.8), (3.0, -6.0, -3.5), 18),
    "i_hall2": ((7.5, 25.8, -0.2), (-2.0, 10.0, -4.0), 18),
    "i_mess": ((8.5, -1.4, 5.2), (-4.0, 6.5, 3.8), 18),
    "i_cabin": ((9.6, -9.6, 5.3), (3.5, -6.6, 3.9), 16),
    "i_lounge": ((-9.6, 15.4, 5.4), (-4.0, 9.5, 3.9), 16),
    "i_sky": ((0.0, -19.0, 9.2), (0.0, 0.0, 8.2), 18),
    "i_bridge": ((6.0, -31.6, 5.6), (-1.5, -45.0, 2.4), 16),
    "i_obs": ((0.0, -31.4, 0.6), (0.0, -39.0, 0.0), 16),
    "i_control": ((2.6, 5.3, 0.6), (-1.0, -10.0, -4.0), 18),
    "i_reactor": ((7.0, 32.0, -0.2), (0.0, 36.0, -2.0), 18),
}
# поэтажные планы (орто сверху, срез ближней плоскостью камеры): высота среза, масштаб
PLANS = {"plan_A": 6.3, "plan_S": 10.0, "plan_B": 2.3, "plan_C": -2.4}


def setup(samples=int(os.environ.get("VESPER_SAMPLES", 48)), res=(int(os.environ.get("VESPER_RX", 1600)), int(os.environ.get("VESPER_RY", 700)))):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 6
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    sky = nt.nodes.new("ShaderNodeTexGradient") if False else None
    bg.inputs[0].default_value = (0.012, 0.016, 0.026, 1)
    bg.inputs[1].default_value = 1.0
    for o in list(bpy.data.objects):
        if o.name.startswith("_R_"):
            bpy.data.objects.remove(o)
    def sun(name, rot, e, col):
        l = bpy.data.lights.new(name, "SUN")
        l.energy = e
        l.color = col
        l.angle = math.radians(1.5)
        o = bpy.data.objects.new(name, l)
        sc.collection.objects.link(o)
        o.rotation_euler = [math.radians(a) for a in rot]
    sun("_R_key", (55, 0, -50), 4.2, (1.0, 0.96, 0.9))
    sun("_R_fill", (115, 0, -60), 0.5, (0.55, 0.7, 1.0))
    sun("_R_rim", (75, 0, 10), 1.2, (0.8, 0.88, 1.0))
    cd = bpy.data.cameras.new("_R_cam")
    cam = bpy.data.objects.new("_R_cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.clip_end = 2000
    return cam


def shot(cam, path, loc, tgt, lens):
    cam.data.type = "PERSP"
    cam.data.clip_start = 0.05
    cam.data.lens = lens
    cam.location = loc
    d = Vector(tgt) - Vector(loc)
    if abs(d.x) < 1e-6 and abs(d.y) < 1e-6:
        cam.rotation_euler = (0, 0, math.radians(90))    # строго сверху: корабль горизонтально, нос слева
    else:
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def plan(cam, path, zcut):
    sc = bpy.context.scene
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    sc.render.resolution_x, sc.render.resolution_y = int(rx * 1.25), int(rx * 0.35)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 106
    cam.location = (0, -2.0, zcut)
    cam.rotation_euler = (0, 0, math.radians(90))
    cam.data.clip_start = 0.01
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.render.resolution_x, sc.render.resolution_y = rx, ry


def set_lights(on):
    for o in bpy.data.objects:
        if o.type == "LIGHT" and not o.name.startswith("_R_"):
            o.hide_render = not on
    for n in ("_R_key", "_R_fill", "_R_rim"):
        o = bpy.data.objects.get(n)
        if o:
            o.data.energy = {"_R_key": 4.2, "_R_fill": 0.5, "_R_rim": 1.2}[n] * (0.08 if on else 1.0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    src, out = argv[0], argv[1]
    names = argv[2].split(",") if len(argv) > 2 else list(SHOTS) + list(INTERIOR) + list(PLANS)
    if src.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=src)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=src)
    os.makedirs(out, exist_ok=True)
    cam = setup()
    for n in names:
        p = os.path.join(out, n + ".png")
        if n in SHOTS:
            set_lights(False)
            shot(cam, p, *SHOTS[n])
        elif n in INTERIOR:
            set_lights(True)
            shot(cam, p, *INTERIOR[n])
        else:
            set_lights(True)
            plan(cam, p, PLANS[n])


if __name__ == "__main__":
    main()
