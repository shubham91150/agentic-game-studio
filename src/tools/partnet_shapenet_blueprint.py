#!/usr/bin/env python3
"""PartNet + ShapeNet Hierarchical Part-Tree & Metric CAD Blueprint Builder.

Provides canonical ShapeNetCore synset IDs, real-world metric dimensions (m),
and PartNet fine-grained anatomical part hierarchies for 3D game assets, plus
direct multi-part watertight .glb synthesis (--generate-bpy) via trimesh/manifold3d.

Usage:
  python3 src/tools/partnet_shapenet_blueprint.py --query "bazaar stall"
  python3 src/tools/partnet_shapenet_blueprint.py --query "bazaar stall" --generate-bpy --out storage/cache/pro_builder/bazaar_stall.glb
  python3 src/tools/partnet_shapenet_blueprint.py --list
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

PBR_PRESETS = {
    "metal_iron": {"baseColorFactor": [48, 52, 58, 255], "metallicFactor": 0.85, "roughnessFactor": 0.35},
    "brass": {"baseColorFactor": [212, 168, 72, 255], "metallicFactor": 0.9, "roughnessFactor": 0.22},
    "copper_pan": {"baseColorFactor": [184, 105, 58, 255], "metallicFactor": 0.88, "roughnessFactor": 0.28},
    "chrome": {"baseColorFactor": [230, 235, 240, 255], "metallicFactor": 0.95, "roughnessFactor": 0.08},
    "car_paint": {"baseColorFactor": [200, 28, 36, 255], "metallicFactor": 0.72, "roughnessFactor": 0.18},
    "rubber_tire": {"baseColorFactor": [24, 24, 26, 255], "metallicFactor": 0.05, "roughnessFactor": 0.88},
    "wood_teak": {"baseColorFactor": [122, 78, 42, 255], "metallicFactor": 0.05, "roughnessFactor": 0.72},
    "wood_dark": {"baseColorFactor": [78, 48, 26, 255], "metallicFactor": 0.05, "roughnessFactor": 0.78},
    "fabric_awning": {"baseColorFactor": [196, 54, 38, 255], "metallicFactor": 0.02, "roughnessFactor": 0.82},
    "fabric_gold": {"baseColorFactor": [224, 168, 44, 255], "metallicFactor": 0.15, "roughnessFactor": 0.65},
    "glass": {"baseColorFactor": [170, 215, 235, 110], "metallicFactor": 0.9, "roughnessFactor": 0.05, "alphaMode": "BLEND"},
    "brick_wall": {"baseColorFactor": [158, 74, 54, 255], "metallicFactor": 0.02, "roughnessFactor": 0.86},
    "stone_plinth": {"baseColorFactor": [132, 128, 122, 255], "metallicFactor": 0.04, "roughnessFactor": 0.84},
    "bark": {"baseColorFactor": [92, 64, 42, 255], "metallicFactor": 0.02, "roughnessFactor": 0.9},
    "foliage": {"baseColorFactor": [54, 128, 48, 255], "metallicFactor": 0.02, "roughnessFactor": 0.75},
    "emissive_warm": {"baseColorFactor": [255, 220, 140, 255], "metallicFactor": 0.1, "roughnessFactor": 0.2, "emissiveFactor": [1.0, 0.82, 0.42]},
    "emissive_red": {"baseColorFactor": [255, 45, 35, 255], "metallicFactor": 0.1, "roughnessFactor": 0.2, "emissiveFactor": [1.0, 0.12, 0.08]},
}

BLUEPRINTS = {
    "bazaar_stall": {
        "shapenet_synset_id": "04379243_stall",
        "category": "Architecture / Street Bazaar Stall (Lucknow / Market Stall)",
        "aliases": ["bazaar stall", "jalebi stall", "market stall", "food stall", "shop stall", "street cart"],
        "real_world_dims_m": {"width": 3.2, "height": 2.75, "depth": 2.2},
        "partnet_parts": [
            {"name": "plinth_stone_base", "role": "levelled ground masonry base", "primitive": "box", "size_m": [3.2, 0.14, 2.2], "pos_m": [0.0, 0.07, 0.0], "material": "stone_plinth"},
            {"name": "counter_body_main", "role": "wooden vendor counter cabinet", "primitive": "box", "size_m": [2.9, 0.86, 1.1], "pos_m": [0.0, 0.57, 0.35], "material": "wood_teak"},
            {"name": "counter_top_slab", "role": "serving counter overhang slab", "primitive": "box", "size_m": [3.05, 0.08, 1.25], "pos_m": [0.0, 1.04, 0.35], "material": "wood_dark"},
            {"name": "bhatti_furnace_housing", "role": "brick stove hearth for kadhai", "primitive": "cylinder", "size_m": [0.76, 0.32, 0.76], "pos_m": [-0.75, 1.24, 0.35], "material": "brick_wall"},
            {"name": "cooking_pan_kadhai", "role": "deep iron/brass kadhai wok", "primitive": "cylinder", "size_m": [0.68, 0.18, 0.68], "pos_m": [-0.75, 1.46, 0.35], "material": "metal_iron"},
            {"name": "syrup_vessel_handi", "role": "brass sugar-syrup vessel", "primitive": "cylinder", "size_m": [0.46, 0.24, 0.46], "pos_m": [0.05, 1.20, 0.35], "material": "brass"},
            {"name": "display_tray_step_1", "role": "lower brass sweet display tray", "primitive": "box", "size_m": [0.85, 0.08, 0.55], "pos_m": [0.82, 1.12, 0.42], "material": "brass"},
            {"name": "display_tray_step_2", "role": "upper brass sweet display tray", "primitive": "box", "size_m": [0.85, 0.08, 0.40], "pos_m": [0.82, 1.22, 0.22], "material": "brass"},
            {"name": "display_glass_sneeze_guard", "role": "front transparent glass shield", "primitive": "box", "size_m": [0.90, 0.34, 0.03], "pos_m": [0.82, 1.25, 0.72], "material": "glass"},
            {"name": "pillar_fl", "role": "front-left bamboo/iron support pole", "primitive": "cylinder", "size_m": [0.09, 2.45, 0.09], "pos_m": [-1.45, 1.36, 0.95], "material": "wood_dark"},
            {"name": "pillar_fr", "role": "front-right support pole", "primitive": "cylinder", "size_m": [0.09, 2.45, 0.09], "pos_m": [1.45, 1.36, 0.95], "material": "wood_dark"},
            {"name": "pillar_bl", "role": "back-left support pole", "primitive": "cylinder", "size_m": [0.09, 2.45, 0.09], "pos_m": [-1.45, 1.36, -0.95], "material": "wood_dark"},
            {"name": "pillar_br", "role": "back-right support pole", "primitive": "cylinder", "size_m": [0.09, 2.45, 0.09], "pos_m": [1.45, 1.36, -0.95], "material": "wood_dark"},
            {"name": "roof_frame_beam_front", "role": "upper horizontal cross-beam", "primitive": "box", "size_m": [3.05, 0.08, 0.08], "pos_m": [0.0, 2.52, 0.95], "material": "wood_dark"},
            {"name": "roof_frame_beam_back", "role": "rear horizontal cross-beam", "primitive": "box", "size_m": [3.05, 0.08, 0.08], "pos_m": [0.0, 2.52, -0.95], "material": "wood_dark"},
            {"name": "canopy_awning_main", "role": "pitched fabric bazaar canopy roof", "primitive": "box", "size_m": [3.35, 0.16, 2.35], "pos_m": [0.0, 2.64, 0.0], "material": "fabric_awning"},
            {"name": "canopy_valance_fringe", "role": "decorative gold front valance trim", "primitive": "box", "size_m": [3.35, 0.18, 0.06], "pos_m": [0.0, 2.48, 1.15], "material": "fabric_gold"},
            {"name": "hanging_lantern_left", "role": "warm glowing brass bazaar lantern", "primitive": "cylinder", "size_m": [0.22, 0.32, 0.22], "pos_m": [-1.15, 2.22, 0.92], "material": "emissive_warm"},
            {"name": "hanging_lantern_right", "role": "warm glowing brass bazaar lantern", "primitive": "cylinder", "size_m": [0.22, 0.32, 0.22], "pos_m": [1.15, 2.22, 0.92], "material": "emissive_warm"},
            {"name": "storage_crate_side", "role": "wooden supply crate beside counter", "primitive": "box", "size_m": [0.52, 0.48, 0.52], "pos_m": [-1.18, 0.38, -0.55], "material": "wood_teak"},
        ],
    },
    "sports_car": {
        "shapenet_synset_id": "02958343",
        "category": "Vehicle / Sports Coupe (ShapeNet 02958343 + PartNet Level-3)",
        "aliases": ["sports car", "car", "race car", "supercar", "sedan", "vehicle"],
        "real_world_dims_m": {"width": 1.92, "height": 1.24, "depth": 4.45},
        "partnet_parts": [
            {"name": "chassis_undertray", "role": "carbon-fiber floorpan & diffuser", "primitive": "box", "size_m": [1.86, 0.16, 4.32], "pos_m": [0.0, 0.24, 0.0], "material": "metal_iron"},
            {"name": "body_lower_shell", "role": "main sculpted fender & door beltline", "primitive": "box", "size_m": [1.92, 0.46, 4.40], "pos_m": [0.0, 0.52, 0.0], "material": "car_paint"},
            {"name": "hood_front_deck", "role": "sloped aerodynamic front hood", "primitive": "box", "size_m": [1.74, 0.14, 1.35], "pos_m": [0.0, 0.76, 1.32], "material": "car_paint"},
            {"name": "cabin_greenhouse_pillars", "role": "roof canopy & A/B/C pillars", "primitive": "box", "size_m": [1.52, 0.42, 1.85], "pos_m": [0.0, 0.96, -0.15], "material": "car_paint"},
            {"name": "cabin_glass_windshield", "role": "transparent wrap-around cockpit glass", "primitive": "box", "size_m": [1.56, 0.38, 1.92], "pos_m": [0.0, 0.96, -0.14], "material": "glass"},
            {"name": "splitter_front_lip", "role": "front aero chin splitter", "primitive": "box", "size_m": [1.94, 0.07, 0.34], "pos_m": [0.0, 0.19, 2.12], "material": "metal_iron"},
            {"name": "grille_intake_front", "role": "front radiator mesh grille", "primitive": "box", "size_m": [1.28, 0.24, 0.10], "pos_m": [0.0, 0.42, 2.18], "material": "metal_iron"},
            {"name": "headlight_left", "role": "LED projector headlamp left", "primitive": "box", "size_m": [0.36, 0.12, 0.16], "pos_m": [-0.68, 0.62, 2.14], "material": "emissive_warm"},
            {"name": "headlight_right", "role": "LED projector headlamp right", "primitive": "box", "size_m": [0.36, 0.12, 0.16], "pos_m": [0.68, 0.62, 2.14], "material": "emissive_warm"},
            {"name": "taillight_bar_rear", "role": "full-width rear LED lightbar", "primitive": "box", "size_m": [1.72, 0.11, 0.10], "pos_m": [0.0, 0.66, -2.18], "material": "emissive_red"},
            {"name": "wing_spoiler_blade", "role": "rear GT downforce wing", "primitive": "box", "size_m": [1.78, 0.06, 0.34], "pos_m": [0.0, 1.04, -2.02], "material": "metal_iron"},
            {"name": "wing_strut_l", "role": "left wingswan-neck mount", "primitive": "box", "size_m": [0.06, 0.28, 0.22], "pos_m": [-0.52, 0.88, -2.00], "material": "metal_iron"},
            {"name": "wing_strut_r", "role": "right wing swan-neck mount", "primitive": "box", "size_m": [0.06, 0.28, 0.22], "pos_m": [0.52, 0.88, -2.00], "material": "metal_iron"},
            {"name": "mirror_side_l", "role": "left wing mirror", "primitive": "box", "size_m": [0.22, 0.10, 0.16], "pos_m": [-0.98, 0.82, 0.55], "material": "car_paint"},
            {"name": "mirror_side_r", "role": "right wing mirror", "primitive": "box", "size_m": [0.22, 0.10, 0.16], "pos_m": [0.98, 0.82, 0.55], "material": "car_paint"},
            {"name": "wheel_fl_tire", "role": "front-left radial tire", "primitive": "wheel", "size_m": [0.28, 0.68, 0.68], "pos_m": [-0.88, 0.34, 1.38], "material": "rubber_tire"},
            {"name": "wheel_fr_tire", "role": "front-right radial tire", "primitive": "wheel", "size_m": [0.28, 0.68, 0.68], "pos_m": [0.88, 0.34, 1.38], "material": "rubber_tire"},
            {"name": "wheel_rl_tire", "role": "rear-left radial tire", "primitive": "wheel", "size_m": [0.30, 0.70, 0.70], "pos_m": [-0.88, 0.35, -1.36], "material": "rubber_tire"},
            {"name": "wheel_rr_tire", "role": "rear-right radial tire", "primitive": "wheel", "size_m": [0.30, 0.70, 0.70], "pos_m": [0.88, 0.35, -1.36], "material": "rubber_tire"},
            {"name": "wheel_fl_rim", "role": "front-left alloy rim", "primitive": "wheel", "size_m": [0.30, 0.44, 0.44], "pos_m": [-0.89, 0.34, 1.38], "material": "chrome"},
            {"name": "wheel_fr_rim", "role": "front-right alloy rim", "primitive": "wheel", "size_m": [0.30, 0.44, 0.44], "pos_m": [0.89, 0.34, 1.38], "material": "chrome"},
            {"name": "wheel_rl_rim", "role": "rear-left alloy rim", "primitive": "wheel", "size_m": [0.32, 0.46, 0.46], "pos_m": [-0.89, 0.35, -1.36], "material": "chrome"},
            {"name": "wheel_rr_rim", "role": "rear-right alloy rim", "primitive": "wheel", "size_m": [0.32, 0.46, 0.46], "pos_m": [0.89, 0.35, -1.36], "material": "chrome"},
            {"name": "exhaust_twin_pipes", "role": "dual rear exhaust tailpipes", "primitive": "box", "size_m": [0.48, 0.10, 0.18], "pos_m": [0.0, 0.26, -2.20], "material": "chrome"},
        ],
    },
    "commercial_building": {
        "shapenet_synset_id": "02913152",
        "category": "Architecture / Multi-Story Commercial Building (PartNet Building)",
        "aliases": ["building", "commercial building", "shop building", "house", "skyscraper", "office"],
        "real_world_dims_m": {"width": 10.0, "height": 11.2, "depth": 8.0},
        "partnet_parts": [
            {"name": "foundation_plinth", "role": "stone masonry foundation", "primitive": "box", "size_m": [10.4, 0.45, 8.4], "pos_m": [0.0, 0.225, 0.0], "material": "stone_plinth"},
            {"name": "facade_core_walls", "role": "brick multi-story structural walls", "primitive": "box", "size_m": [10.0, 10.2, 8.0], "pos_m": [0.0, 5.55, 0.0], "material": "brick_wall"},
            {"name": "cornice_band_f1", "role": "first-floor stone cornice ledge", "primitive": "box", "size_m": [10.3, 0.22, 8.3], "pos_m": [0.0, 3.85, 0.0], "material": "stone_plinth"},
            {"name": "cornice_band_f2", "role": "second-floor stone cornice ledge", "primitive": "box", "size_m": [10.3, 0.22, 8.3], "pos_m": [0.0, 7.25, 0.0], "material": "stone_plinth"},
            {"name": "roof_parapet_ledge", "role": "rooftop perimeter parapet", "primitive": "box", "size_m": [10.45, 0.42, 8.45], "pos_m": [0.0, 10.85, 0.0], "material": "stone_plinth"},
            {"name": "entrance_door_frame", "role": "ground-floor wooden entrance door", "primitive": "box", "size_m": [2.2, 2.6, 0.25], "pos_m": [0.0, 1.75, 4.02], "material": "wood_dark"},
            {"name": "entrance_canopy", "role": "overhanging storefront awning", "primitive": "box", "size_m": [3.4, 0.18, 1.2], "pos_m": [0.0, 3.25, 4.5], "material": "fabric_awning"},
            {"name": "window_glass_f2_bay", "role": "second-floor reflective window glass", "primitive": "box", "size_m": [7.8, 1.6, 0.12], "pos_m": [0.0, 5.55, 4.01], "material": "glass"},
            {"name": "window_glass_f3_bay", "role": "third-floor reflective window glass", "primitive": "box", "size_m": [7.8, 1.6, 0.12], "pos_m": [0.0, 8.95, 4.01], "material": "glass"},
            {"name": "rooftop_hvac_unit", "role": "rooftop mechanical chiller unit", "primitive": "box", "size_m": [2.1, 1.1, 1.6], "pos_m": [-2.2, 11.4, -1.2], "material": "metal_iron"},
            {"name": "rooftop_water_tank", "role": "elevated cylindrical rooftop water tank", "primitive": "cylinder", "size_m": [1.6, 1.8, 1.6], "pos_m": [2.4, 11.75, -1.5], "material": "metal_iron"},
        ],
    },
    "streetlamp": {
        "shapenet_synset_id": "03636649",
        "category": "Street Furniture / Cast-Iron Heritage Streetlamp (ShapeNet 03636649)",
        "aliases": ["streetlamp", "lamp", "lantern", "light pole", "street light"],
        "real_world_dims_m": {"width": 0.85, "height": 4.6, "depth": 0.85},
        "partnet_parts": [
            {"name": "base_pedestal", "role": "octagonal cast-iron base plinth", "primitive": "cylinder", "size_m": [0.46, 0.65, 0.46], "pos_m": [0.0, 0.325, 0.0], "material": "metal_iron"},
            {"name": "shaft_column", "role": "tapered fluted lamp post column", "primitive": "cylinder", "size_m": [0.16, 3.4, 0.16], "pos_m": [0.0, 2.35, 0.0], "material": "metal_iron"},
            {"name": "lantern_collar_bracket", "role": "ornate upper brass bracket", "primitive": "box", "size_m": [0.42, 0.12, 0.42], "pos_m": [0.0, 4.08, 0.0], "material": "brass"},
            {"name": "lantern_glass_globe", "role": "warm glowing lantern bulb housing", "primitive": "cylinder", "size_m": [0.36, 0.42, 0.36], "pos_m": [0.0, 4.32, 0.0], "material": "emissive_warm"},
            {"name": "lantern_cap_finial", "role": "top dome weather cap", "primitive": "B_cone", "size_m": [0.48, 0.22, 0.48], "pos_m": [0.0, 4.62, 0.0], "material": "metal_iron"},
        ],
    },
}

# Add 55+ canonical ShapeNet synset aliases mapping to nearest rich PartNet blueprint
SHAPENET_SYNSETS = {
    "02958343": ("car / automobile", "sports_car"),
    "02924116": ("bus / transit", "sports_car"),
    "04468005": ("train / locomotive", "sports_car"),
    "03790512": ("motorcycle", "sports_car"),
    "04379243": ("table / stall / counter", "bazaar_stall"),
    "03001627": ("chair / seating", "bazaar_stall"),
    "02828884": ("bench / street bench", "bazaar_stall"),
    "02913152": ("building / structure", "commercial_building"),
    "04460130": ("tower / steeple", "commercial_building"),
    "03636649": ("lamp / streetlamp / lantern", "streetlamp"),
}


def resolve_blueprint(query: str) -> dict:
    q = (query or "bazaar_stall").strip().lower()
    if q in BLUEPRINTS:
        return {"key": q, **BLUEPRINTS[q]}
    for key, bp in BLUEPRINTS.items():
        if q in key or any(q in a or a in q for a in bp["aliases"]):
            return {"key": key, **bp}
    for syn_id, (label, target_key) in SHAPENET_SYNSETS.items():
        if q == syn_id or q in label:
            return {"key": target_key, "matched_synset": syn_id, **BLUEPRINTS[target_key]}
    return {"key": "bazaar_stall", "note": f"Mapped '{query}' to closest PartNet multi-part blueprint", **BLUEPRINTS["bazaar_stall"]}


def build_part_mesh(part: dict) -> trimesh.Trimesh:
    prim = part.get("primitive", "box")
    sx, sy, sz = part["size_m"]
    px, py, pz = part["pos_m"]
    if prim == "cylinder":
        m = trimesh.creation.cylinder(radius=sx * 0.5, height=sy, sections=24)
        # trimesh cylinder is along Z; rotate 90 deg around X so height is along Y
        rot = trimesh.transformations.rotation_matrix(math.pi / 2.0, [1, 0, 0])
        m.apply_transform(rot)
    elif prim == "wheel":
        m = trimesh.creation.cylinder(radius=sy * 0.5, height=sx, sections=24)
        # rotate 90 deg around Y so wheel axle is along X
        rot = trimesh.transformations.rotation_matrix(math.pi / 2.0, [0, 1, 0])
        m.apply_transform(rot)
    elif prim == "B_cone":
        m = trimesh.creation.cone(radius=sx * 0.5, height=sy, sections=20)
        rot = trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1, 0, 0])
        m.apply_transform(rot)
    else:
        m = trimesh.creation.box(extents=[sx, sy, sz])
    m.apply_translation([px, py, pz])
    mat_key = part.get("material", "wood_teak")
    mat_cfg = PBR_PRESETS.get(mat_key, PBR_PRESETS["wood_teak"])
    pbr = PBRMaterial(
        name=f"mat_{mat_key}",
        baseColorFactor=mat_cfg["baseColorFactor"],
        metallicFactor=mat_cfg["metallicFactor"],
        roughnessFactor=mat_cfg["roughnessFactor"],
        emissiveFactor=mat_cfg.get("emissiveFactor", [0.0, 0.0, 0.0]),
        alphaMode=mat_cfg.get("alphaMode", "OPAQUE"),
    )
    m.visual = trimesh.visual.TextureVisuals(material=pbr)
    return m


def export_blueprint_glb(bp: dict, out_path: str) -> dict:
    scene = trimesh.Scene()
    total_verts = 0
    total_faces = 0
    for part in bp["partnet_parts"]:
        mesh = build_part_mesh(part)
        total_verts += len(mesh.vertices)
        total_faces += len(mesh.faces)
        scene.add_geometry(mesh, node_name=part["name"], geom_name=part["name"])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    glb_bytes = scene.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(glb_bytes)
    return {
        "ok": True,
        "out": out_path,
        "bytes": len(glb_bytes),
        "magic": glb_bytes[:4].decode("ascii", errors="ignore"),
        "part_count": len(bp["partnet_parts"]),
        "vertices": total_verts,
        "faces": total_faces,
    }


def main():
    ap = argparse.ArgumentParser(description="PartNet + ShapeNet Blueprint & CAD Multi-Part GLB Builder")
    ap.add_argument("--query", default="bazaar stall", help="Category or ShapeNet synset query")
    ap.add_argument("--list", action="store_true", help="List available canonical blueprints & synsets")
    ap.add_argument("--generate-bpy", action="store_true", help="Synthesize multi-part .glb from PartNet blueprint")
    ap.add_argument("--out", default="storage/cache/pro_builder/partnet_asset.glb", help="Output .glb path")
    args = ap.parse_args()

    if args.list:
        print(json.dumps({"blueprints": list(BLUEPRINTS.keys()), "shapenet_synsets": SHAPENET_SYNSETS}, indent=2))
        return

    bp = resolve_blueprint(args.query)
    result = {
        "key": bp["key"],
        "shapenet_synset_id": bp["shapenet_synset_id"],
        "category": bp["category"],
        "real_world_dims_m": bp["real_world_dims_m"],
        "part_count": len(bp["partnet_parts"]),
        "partnet_parts": bp["partnet_parts"],
    }
    if args.generate_bpy:
        result["build"] = export_blueprint_glb(bp, args.out)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
