# Проверка экспортированного GLB: структура, материалы, extras дверей, источники света, текстуры.
# Запуск: python3 ship/check_glb.py ship/export/Vesper_Explorer.glb
import json
import struct
import sys
from collections import Counter


def main(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and ver == 2 and length == len(data), "bad GLB header"
    jlen, jtype = struct.unpack_from("<II", data, 12)
    g = json.loads(data[20:20 + jlen])
    nodes = g.get("nodes", [])
    tris = 0
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            acc = g["accessors"][p["indices"]] if "indices" in p else g["accessors"][p["attributes"]["POSITION"]]
            tris += acc["count"] // 3
    doors = [n for n in nodes if n.get("extras", {}).get("type") == "sliding_door"]
    lights = g.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])
    mats = g.get("materials", [])
    tinted = [m["name"] for m in mats if m.get("pbrMetallicRoughness", {}).get("baseColorFactor") and
              m["pbrMetallicRoughness"].get("baseColorTexture")]
    no_tex = [m["name"] for m in mats if not m.get("pbrMetallicRoughness", {}).get("baseColorTexture")]
    occl = sum(1 for m in mats if "occlusionTexture" in m)
    print(f"size {len(data) / 1e6:.1f} MB, nodes {len(nodes)}, meshes {len(g.get('meshes', []))}, triangles {tris}")
    print(f"materials {len(mats)} (with occlusion {occl}), textures {len(g.get('textures', []))}, images {len(g.get('images', []))}")
    print(f"tinted (factor × texture): {len(tinted)} e.g. {tinted[:5]}")
    print(f"untextured: {no_tex}")
    print(f"alpha modes: {Counter(m.get('alphaMode', 'OPAQUE') for m in mats)}")
    print(f"doors with extras: {len(doors)}; sample: {doors[0]['name'] if doors else None} {doors[0].get('extras') if doors else None}")
    leaves = [n["name"] for n in nodes if n.get("name", "").endswith(("_Leaf_L", "_Leaf_R"))]
    print(f"door leaves: {len(leaves)}")
    print(f"lights: {len(lights)}")
    names = [n.get("name", "") for n in nodes]
    for want in ("Hull", "Windows_Glass", "Cockpit_Glass", "Engine_Pods", "Engines_Main", "Decals", "H-01_Proizvodstvennyy_Tsekh_1"):
        print(f"  node {want}: {'ok' if want in names else 'MISSING'}")


if __name__ == "__main__":
    main(sys.argv[1])
