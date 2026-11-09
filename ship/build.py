# Сборка VESPER Explorer: геометрия → сцена Blender → GLB / FBX / .blend + коллайдеры + таблица материалов.
# Запуск (из корня репозитория):
#   uv run --with numpy --with pillow python ship/gen_textures.py
#   uv run --python 3.11 --with bpy --with numpy python ship/build.py
import json
import math
import os
import shutil
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vesper import exterior, hull, interior, materials  # noqa: E402
from vesper import layout as L  # noqa: E402
from vesper.geo import MB, bbox, box  # noqa: E402

OUT = os.path.join(HERE, "export")
TEX_SRC = os.path.join(HERE, "build", "Textures")
TEX = os.path.join(OUT, "Textures")
DECK_NAME = {"A": "Deck_A_Living", "S": "Deck_S_Sky_Lounge", "B": "Deck_B", "C": "Deck_C", "H": "Deck_BC_Production"}


def empty(name, coll, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = 1.0
    o.location = loc
    coll.objects.link(o)
    if parent:
        o.parent = parent
    return o


def coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def door_leaf(name, d, side, mats, col, parent):
    w, h, t = d["w"], d["h"], d["t"]
    mb = MB(name)
    lw = w / 2
    gate = d["kind"] == "gate"
    mat = "M_Paint_Yellow" if gate else "M_Door"
    if d["axis"] == "x":
        bbox(mb, -lw / 2, -t / 2, 0, lw / 2, t / 2, h, mat, c=0.015)
        ex = lw / 2 if side < 0 else -lw / 2      # кромка у центра проёма
        box(mb, ex - 0.02, -t / 2 - 0.004, 0.1, ex + 0.02, t / 2 + 0.004, h - 0.1, "M_Strip_Blue" if not gate else "M_Hazard")
        if not gate:
            box(mb, -0.12, -t / 2 - 0.003, 1.2, 0.12, t / 2 + 0.003, 1.9, "M_Glass_Interior")
        loc = (side * lw / 2, 0, 0)
    else:
        bbox(mb, -t / 2, -lw / 2, 0, t / 2, lw / 2, h, mat, c=0.015)
        ey = lw / 2 if side < 0 else -lw / 2
        box(mb, -t / 2 - 0.004, ey - 0.02, 0.1, t / 2 + 0.004, ey + 0.02, h - 0.1, "M_Strip_Blue" if not gate else "M_Hazard")
        if not gate:
            box(mb, -t / 2 - 0.003, -0.12, 1.2, t / 2 + 0.003, 0.12, 1.9, "M_Glass_Interior")
        loc = (0, side * lw / 2, 0)
    if gate:
        for k in range(4):
            z = 0.3 + k * (h - 0.6) / 3
            if d["axis"] == "x":
                box(mb, -lw / 2 + 0.1, -t / 2 - 0.005, z, lw / 2 - 0.1, t / 2 + 0.005, z + 0.12, "M_Metal_Dark")
            else:
                box(mb, -t / 2 - 0.005, -lw / 2 + 0.1, z, t / 2 + 0.005, lw / 2 - 0.1, z + 0.12, "M_Metal_Dark")
    ob = mb.build(mats, col, parent=parent)
    ob.location = loc
    return ob


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    t0 = time.time()
    if os.path.isdir(TEX):
        shutil.rmtree(TEX)
    shutil.copytree(TEX_SRC, TEX)
    mats = materials.build(TEX)

    c_ext, c_int, c_door, c_light = coll("Exterior"), coll("Interior"), coll("Doors"), coll("Lights")
    root = empty("VESPER_Explorer", sc.collection)
    e_ext = empty("Exterior", c_ext, root)
    e_int = empty("Interior", c_int, root)
    e_door = empty("Doors", c_door, root)
    e_light = empty("Lights", c_light, root)

    H = hull.Hull()
    I = interior.Interior(H)
    rooms = I.build()
    hmb, glass, cglass, frames = H.build(I.region_mat)
    stats = {}
    for mb in [hmb, glass, cglass, frames] + exterior.build(H):
        mb.build(mats, c_ext, parent=e_ext)
        stats[mb.name] = mb.tris()

    decks = {}
    for code, mb in rooms.items():
        r = I.rooms[code]
        dk = r["deck"]
        if dk not in decks:
            decks[dk] = empty(DECK_NAME[dk], c_int, e_int)
        node = empty(f"{code}_{interior._slug(r['name'])}_Room", c_int, decks[dk])
        node["room"] = code
        node["title"] = r["name"]
        mb.build(mats, c_int, parent=node)
        stats.setdefault("interior", 0)
        stats["interior"] += mb.tris()

    seen = {}
    for d in I.doors:
        base = f"Door_{d['name']}"
        seen[base] = seen.get(base, 0) + 1
        name = base if seen[base] == 1 else f"{base}_{seen[base]}"
        de = empty(name, c_door, e_door, loc=(d["x"], d["y"], d["z"]))
        de["type"] = "sliding_door"
        de["openDistance"] = round(d["w"] / 2 - 0.05, 3)
        de["slideAxis"] = d["axis"]
        de["room"] = d["room"]
        door_leaf(f"{name}_Leaf_L", d, -1, mats, c_door, de)
        door_leaf(f"{name}_Leaf_R", d, 1, mats, c_door, de)
    stats["doors"] = len(I.doors)

    lg = {}
    for k, li in enumerate(I.lights):
        dk = li["deck"]
        if dk not in lg:
            lg[dk] = empty(f"Lights_{dk}", c_light, e_light)
        ld = bpy.data.lights.new(f"L_{li['room']}_{k:03d}", "POINT")
        ld.energy = li["power"]
        ld.color = li["color"]
        ld.shadow_soft_size = li["radius"]
        ld.use_custom_distance = True
        ld.cutoff_distance = li["range"]
        lo = bpy.data.objects.new(ld.name, ld)
        lo.location = li["pos"]
        c_light.objects.link(lo)
        lo.parent = lg[dk]
        lo["unityIntensity"] = round(min(8.0, max(0.4, li["power"] / 60.0)), 2)
        lo["lightRange"] = round(li["range"], 2)
    stats["lights"] = len(I.lights)
    print("scene built in %.1fs" % (time.time() - t0), stats)
    return H, I, mats, stats


def colliders(H, I, mats):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials.build(TEX)
    c = bpy.context.scene.collection
    root = empty("VESPER_Explorer_Colliders", c)
    for mb in (H.collider(), I.col_struct, I.col_furn):
        mb.build(mats, c, parent=root, sharp_deg=1.0)


def export(H, I, mats, stats):
    os.makedirs(OUT, exist_ok=True)
    glb = os.path.join(OUT, "Vesper_Explorer.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_lights=True, export_extras=True,
                              export_yup=True, export_apply=True, export_image_format="AUTO", export_cameras=False)
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, "Vesper_Explorer.fbx"), path_mode="RELATIVE", use_custom_props=True,
                             object_types={"EMPTY", "MESH", "LIGHT"}, apply_scale_options="FBX_SCALE_UNITS",
                             axis_forward="-Z", axis_up="Y", mesh_smooth_type="FACE", use_mesh_modifiers=True)
    blend = os.path.join(OUT, "Vesper_Explorer.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    with open(os.path.join(OUT, "Unity", "Vesper_Materials.json") if os.path.isdir(os.path.join(OUT, "Unity")) else
              os.path.join(OUT, "Vesper_Materials.json"), "w", encoding="utf-8") as f:
        json.dump(materials.table(), f, ensure_ascii=False, indent=1)
    colliders(H, I, mats)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "Vesper_Explorer_Colliders.glb"), export_format="GLB",
                              export_materials="NONE", export_yup=True)
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, "Vesper_Explorer_Colliders.fbx"), object_types={"EMPTY", "MESH"},
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y", mesh_smooth_type="FACE")
    with open(os.path.join(OUT, "build_stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)


def main():
    os.makedirs(OUT, exist_ok=True)
    u = os.path.join(OUT, "Unity")
    if os.path.isdir(u):
        shutil.rmtree(u)
    shutil.copytree(os.path.join(HERE, "assets", "Unity"), u)
    H, I, mats, stats = build_scene()
    tris = sum(v for k, v in stats.items() if k not in ("doors", "lights"))
    stats["triangles_total_without_doors"] = tris
    export(H, I, mats, stats)
    print("export ->", OUT, stats)


if __name__ == "__main__":
    main()
