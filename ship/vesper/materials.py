# Материалы VESPER Explorer: таблица + сборка Principled BSDF, совместимая с экспортом glTF (ORM, normal, emission, alpha).
import os
import bpy
from . import geo

# name: (набор текстур, цвет-множитель, roughness, metallic, emission rgb, сила, alpha, тайл м, двусторонний)
W = (1, 1, 1)
T = {
    # --- корпус
    "M_Hull_Light": ("Hull_Light", W, 1, 1, None, 0, None, 9.0),
    "M_Hull_Mid": ("Hull_Mid", W, 1, 1, None, 0, None, 9.0),
    "M_Hull_Dark": ("Hull_Dark", W, 1, 1, None, 0, None, 7.0),
    "M_Frame_Dark": ("Metal_Dark", (0.55, 0.57, 0.6), 1, 1, None, 0, None, 2.0),
    "M_Metal_Dark": ("Metal_Dark", W, 1, 1, None, 0, None, 2.0),
    "M_Metal_Brushed": ("Metal_Brushed", W, 1, 1, None, 0, None, 2.0),
    "M_Greeble": ("Greeble_Tech", W, 1, 1, None, 0, None, 3.0),
    "M_Engine": ("Engine_Metal", W, 1, 1, None, 0, None, 3.0),
    "M_Engine_Glow": (None, (0.04, 0.05, 0.06), 0.4, 0, (0.45, 0.78, 1.0), 9, None, 1),
    "M_Engine_Core": (None, (0.04, 0.05, 0.06), 0.4, 0, (0.82, 0.94, 1.0), 16, None, 1),
    "M_Intake_Glow": (None, (0.04, 0.05, 0.06), 0.4, 0, (0.35, 0.7, 1.0), 6, None, 1),
    "M_Glass_Canopy": (None, (0.05, 0.07, 0.09), 0.05, 0.0, None, 0, 0.42, 1),
    "M_Glass_Window": (None, (0.06, 0.08, 0.1), 0.05, 0.0, None, 0, 0.35, 1),
    "M_Glass_Interior": (None, (0.7, 0.82, 0.88), 0.05, 0.0, None, 0, 0.18, 1),
    "M_Nav_Red": (None, (0.2, 0.02, 0.02), 0.4, 0, (1.0, 0.08, 0.05), 12, None, 1),
    "M_Nav_Green": (None, (0.02, 0.2, 0.05), 0.4, 0, (0.1, 1.0, 0.3), 12, None, 1),
    "M_Nav_White": (None, (0.8, 0.8, 0.8), 0.4, 0, (1.0, 1.0, 1.0), 14, None, 1),
    "M_Strip_Ext": (None, (0.8, 0.85, 0.9), 0.4, 0, (0.92, 0.96, 1.0), 10, None, 1),
    "M_Decals": ("Decals", W, 1, 1, None, 0, "MASK", 1),
    "M_Hazard": ("Hazard", W, 1, 1, None, 0, None, 1.0),
    "M_Plastic_White": ("Plastic_White", W, 1, 1, None, 0, None, 1.0),
    "M_Plastic_Black": ("Plastic_White", (0.05, 0.055, 0.06), 1, 1, None, 0, None, 1.0),
    "M_Rubber": ("Rubber", W, 1, 1, None, 0, None, 1.0),
    # --- интерьер: поверхности
    "M_Floor_Deck": ("Floor_Deck", W, 1, 1, None, 0, None, 2.0),
    "M_Floor_Hall": ("Floor_Hall", W, 1, 1, None, 0, None, 4.0),
    "M_Floor_Grate": ("Floor_Grate", W, 1, 1, None, 0, None, 1.2),
    "M_Floor_Wood": ("Wood", (0.92, 0.82, 0.7), 1, 1, None, 0, None, 2.4),
    "M_Carpet": ("Fabric", (0.36, 0.33, 0.3), 1, 1, None, 0, None, 1.0),
    "M_Ceiling": ("Ceiling", W, 1, 1, None, 0, None, 2.0),
    "M_Wall_Panel": ("Wall_Panel", W, 1, 1, None, 0, None, 2.5),
    "M_Wall_White": ("Wall_White", W, 1, 1, None, 0, None, 2.5),
    "M_Wall_Warm": ("Wall_White", (0.93, 0.88, 0.8), 1, 1, None, 0, None, 2.5),
    "M_Wall_Industrial": ("Wall_Industrial", W, 1, 1, None, 0, None, 3.0),
    "M_Wood": ("Wood", W, 1, 1, None, 0, None, 1.5),
    "M_Wood_Dark": ("Wood", (0.45, 0.32, 0.24), 1, 1, None, 0, None, 1.5),
    "M_Fabric_Beige": ("Fabric", (0.79, 0.73, 0.64), 1, 1, None, 0, None, 0.6),
    "M_Fabric_Blue": ("Fabric", (0.24, 0.36, 0.52), 1, 1, None, 0, None, 0.6),
    "M_Fabric_Navy": ("Fabric", (0.12, 0.15, 0.24), 1, 1, None, 0, None, 0.6),
    "M_Fabric_Red": ("Fabric", (0.55, 0.16, 0.13), 1, 1, None, 0, None, 0.6),
    "M_Fabric_Green": ("Fabric", (0.25, 0.4, 0.3), 1, 1, None, 0, None, 0.6),
    "M_Fabric_Grey": ("Fabric", (0.42, 0.43, 0.45), 1, 1, None, 0, None, 0.6),
    "M_Leather": ("Fabric", (0.33, 0.19, 0.11), 1, 1, None, 0, None, 0.6),
    "M_Paint_Yellow": ("Metal_Painted", (0.95, 0.72, 0.15), 1, 1, None, 0, None, 1.5),
    "M_Paint_Orange": ("Metal_Painted", (0.92, 0.42, 0.12), 1, 1, None, 0, None, 1.5),
    "M_Paint_Blue": ("Metal_Painted", (0.25, 0.45, 0.75), 1, 1, None, 0, None, 1.5),
    "M_Paint_Teal": ("Metal_Painted", (0.18, 0.55, 0.55), 1, 1, None, 0, None, 1.5),
    "M_Paint_Red": ("Metal_Painted", (0.75, 0.15, 0.12), 1, 1, None, 0, None, 1.5),
    "M_Paint_Green": ("Metal_Painted", (0.3, 0.55, 0.3), 1, 1, None, 0, None, 1.5),
    "M_Paint_Grey": ("Metal_Painted", (0.6, 0.63, 0.66), 1, 1, None, 0, None, 1.5),
    "M_Door": ("Metal_Painted", (0.54, 0.58, 0.64), 1, 1, None, 0, None, 1.5),
    "M_Screens": ("Screens", W, 1, 1, (1, 1, 1), 2.5, None, 1),
    "M_Signs": ("Signs", W, 1, 1, (1, 1, 1), 2.0, None, 1),
    "M_Plant_Leaf": (None, (0.12, 0.34, 0.1), 0.55, 0, None, 0, None, 1),
    "M_Plant_Leaf2": (None, (0.22, 0.45, 0.14), 0.55, 0, None, 0, None, 1),
    "M_Soil": (None, (0.16, 0.1, 0.06), 0.95, 0, None, 0, None, 1),
    "M_Ceramic": ("Plastic_White", (0.95, 0.95, 0.94), 1, 1, None, 0, None, 1.0),
    "M_Mirror": (None, (0.9, 0.92, 0.95), 0.02, 1, None, 0, None, 1),
    "M_Liquid_Blue": (None, (0.1, 0.35, 0.5), 0.1, 0, (0.1, 0.5, 0.8), 1.5, None, 1),
    "M_Hologram": (None, (0.1, 0.3, 0.4), 0.3, 0, (0.3, 0.8, 1.0), 1.2, None, 1),
    "M_Reactor_Core": (None, (0.2, 0.4, 0.6), 0.3, 0, (0.45, 0.85, 1.0), 14, None, 1),
    # --- светильники
    "M_Light_Warm": (None, (0.9, 0.85, 0.75), 0.5, 0, (1.0, 0.82, 0.6), 8, None, 1),
    "M_Light_White": (None, (0.9, 0.9, 0.9), 0.5, 0, (0.95, 0.97, 1.0), 9, None, 1),
    "M_Light_Blue": (None, (0.6, 0.75, 0.9), 0.5, 0, (0.45, 0.75, 1.0), 6, None, 1),
    "M_Light_Grow": (None, (0.8, 0.5, 0.8), 0.5, 0, (1.0, 0.45, 0.85), 6, None, 1),
    "M_Strip_Warm": (None, (0.9, 0.8, 0.6), 0.5, 0, (1.0, 0.7, 0.4), 6, None, 1),
    "M_Strip_Blue": (None, (0.4, 0.6, 0.9), 0.5, 0, (0.3, 0.65, 1.0), 6, None, 1),
    "M_Strip_Orange": (None, (0.9, 0.5, 0.2), 0.5, 0, (1.0, 0.45, 0.1), 6, None, 1),
    "M_Strip_White": (None, (0.9, 0.9, 0.9), 0.5, 0, (1.0, 1.0, 1.0), 6, None, 1),
}

for k, v in T.items():
    geo.TILE[k] = v[7]

_occ_group = None


def _occlusion_group():
    """Группа 'glTF Material Output' — экспортер glTF берёт из неё карту occlusion."""
    global _occ_group
    if _occ_group:
        return _occ_group
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    _occ_group = g
    return g


def _img(tex_dir, fname, non_color):
    path = os.path.join(tex_dir, fname)
    if not os.path.exists(path):
        return None
    im = bpy.data.images.get(fname) or bpy.data.images.load(path)
    if non_color:
        im.colorspace_settings.name = "Non-Color"
    return im


def build(tex_dir):
    global _occ_group
    _occ_group = None
    mats = {}
    for name, (tset, col, rough, metal, emi, strength, alpha, _tile) in T.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        N = nt.nodes
        L = nt.links
        bsdf = N.get("Principled BSDF")
        out = N.get("Material Output")
        bsdf.location = (300, 0)
        out.location = (600, 0)
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        m.diffuse_color = (*col, 1)
        if tset:
            base = _img(tex_dir, f"T_{tset}_BaseColor.jpg", False) or _img(tex_dir, f"T_{tset}_BaseColor.png", False)
            tb = N.new("ShaderNodeTexImage"); tb.image = base; tb.location = (-500, 300)
            if col != W:
                mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.location = (-150, 300)
                mix.inputs["Factor"].default_value = 1.0
                L.new(tb.outputs["Color"], mix.inputs[6]); mix.inputs[7].default_value = (*col, 1)
                L.new(mix.outputs[2], bsdf.inputs["Base Color"])
            else:
                L.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha == "MASK":
                rnd = N.new("ShaderNodeMath"); rnd.operation = "ROUND"; rnd.location = (-150, 120)
                L.new(tb.outputs["Alpha"], rnd.inputs[0]); L.new(rnd.outputs[0], bsdf.inputs["Alpha"])
                m.surface_render_method = "DITHERED"
            orm = _img(tex_dir, f"T_{tset}_ORM.jpg", True)
            if orm:
                to = N.new("ShaderNodeTexImage"); to.image = orm; to.location = (-500, 0)
                sep = N.new("ShaderNodeSeparateColor"); sep.location = (-200, 0)
                L.new(to.outputs["Color"], sep.inputs[0])
                L.new(sep.outputs[1], bsdf.inputs["Roughness"])
                L.new(sep.outputs[2], bsdf.inputs["Metallic"])
                g = N.new("ShaderNodeGroup"); g.node_tree = _occlusion_group(); g.location = (300, -450)
                L.new(sep.outputs[0], g.inputs["Occlusion"])
            nrm = _img(tex_dir, f"T_{tset}_Normal.jpg", True)
            if nrm:
                tn = N.new("ShaderNodeTexImage"); tn.image = nrm; tn.location = (-500, -300)
                nm = N.new("ShaderNodeNormalMap"); nm.location = (-200, -300)
                L.new(tn.outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs[0], bsdf.inputs["Normal"])
            if emi:
                em = _img(tex_dir, f"T_{tset}_Emission.jpg", False)
                if em:
                    te = N.new("ShaderNodeTexImage"); te.image = em; te.location = (-500, -600)
                    L.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = strength
        elif emi:
            bsdf.inputs["Emission Color"].default_value = (*emi, 1)
            bsdf.inputs["Emission Strength"].default_value = strength
        if isinstance(alpha, float):
            bsdf.inputs["Alpha"].default_value = alpha
            m.surface_render_method = "BLENDED"
            m.use_backface_culling = False
        mats[name] = m
    return mats


def table():
    """Таблица для Unity (Vesper_Materials.json), формат совместим с VesperExplorerImporter."""
    out = []
    for name, (tset, col, rough, metal, emi, strength, alpha, _t) in sorted(T.items()):
        has = bool(tset)
        out.append(dict(
            name=name, set=tset or "", baseColor=[*col, alpha if isinstance(alpha, float) else 1.0],
            metallic=float(metal), roughness=float(rough), emission=list(emi or (0, 0, 0)),
            emissionStrength=float(strength),
            alphaMode="BLEND" if isinstance(alpha, float) else ("MASK" if alpha == "MASK" else "OPAQUE"),
            doubleSided=isinstance(alpha, float),
            baseMap=(f"T_{tset}_BaseColor.png" if tset == "Decals" else f"T_{tset}_BaseColor.jpg") if has else "",
            normalMap=f"T_{tset}_Normal.jpg" if has else "",
            maskMap=f"T_{tset}_MaskMap.png" if has else "",
            emissionMap=f"T_{tset}_Emission.jpg" if has and emi else "",
        ))
    return {"materials": out}
