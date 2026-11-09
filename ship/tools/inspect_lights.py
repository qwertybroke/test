import bpy, os, sys
bpy.ops.wm.open_mainfile(filepath=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'export', 'Vesper_Explorer.blend'))
ls = [o for o in bpy.data.objects if o.type == 'LIGHT']
print('n', len(ls))
for o in ls[:6]:
    print(o.name, o.data.type, round(o.data.energy, 2), tuple(round(c, 2) for c in o.data.color), round(o.data.shadow_soft_size, 2), o.get('unityIntensity'), o.get('lightRange'), tuple(round(v, 2) for v in o.matrix_world.translation))
print('blend_lighting_mode', getattr(bpy.context.scene, 'gltf_lighting_mode', None))
