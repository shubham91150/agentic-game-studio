#!/usr/bin/env python3
"""
Objaverse 3D Object & Part-Hierarchy Inspector (src/tools/search_objaverse.py)

Searches Objaverse LVIS categories and metadata for matching 3D objects,
returns object descriptions + part names, and downloads 1 reference .glb into
storage/cache/objaverse/ so the agent can inspect its real 3D mesh hierarchy
(node names, vertex counts, bounding boxes, material slots) to learn how
real 3D artists structure multi-part assets.

Usage:
  python3 src/tools/search_objaverse.py --query "sports car" --limit 5
  python3 src/tools/search_objaverse.py --query "car" --limit 3
"""

import argparse
import json
import re
import shutil
import struct
import sys
from pathlib import Path

import objaverse

ROOT_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT_DIR / "storage" / "cache" / "objaverse"

# Canonical PartNet anatomical part decompositions for key game asset families
PARTNET_BLUEPRINTS = {
    "vehicle": [
        "chassis_lower",
        "body_shell",
        "cabin_glass",
        "wheel_fl (tire + rim + brake_disc)",
        "wheel_fr (tire + rim + brake_disc)",
        "wheel_rl (tire + rim + brake_disc)",
        "wheel_rr (tire + rim + brake_disc)",
        "headlight_l",
        "headlight_r",
        "taillight_l",
        "taillight_r",
        "grille",
        "wing_spoiler",
        "side_mirror_l",
        "side_mirror_r",
        "exhaust_twin",
    ],
    "building": [
        "foundation_plinth",
        "wall_facade",
        "window_frames",
        "glass_panes",
        "door_entrance",
        "canopy",
        "balcony_railings",
        "cornice_ledge",
        "roof_slates",
        "rooftop_hvac",
    ],
    "tree": [
        "root_flare",
        "trunk_main",
        "boughs_primary",
        "branches_secondary",
        "twigs",
        "leaf_canopy_clusters",
    ],
    "stall": [
        "frame_poles",
        "counter_base",
        "canopy_awning",
        "cooking_pan_kadhai",
        "containers_props",
        "hanging_lantern",
    ],
}

QUERY_SYNONYMS = {
    "car": [
        "car_(automobile)",
        "race_car",
        "convertible_(automobile)",
        "motor_vehicle",
        "sports_car",
        "cab_(taxi)",
        "jeep",
        "limousine",
        "minivan",
        "police_cruiser",
    ],
    "sports car": [
        "race_car",
        "convertible_(automobile)",
        "car_(automobile)",
        "motor_vehicle",
    ],
    "building": [
        "building",
        "house",
        "skyscraper",
        "castle",
        "tower",
        "barn",
        "cabin",
        "church",
        "lighthouse",
    ],
    "tree": [
        "tree",
        "Christmas_tree",
        "palm_tree",
        "maple_tree",
        "oak_tree",
        "pine_tree",
        "willow_tree",
        "plant",
    ],
}


def detect_partnet_family(query: str) -> str:
    q = query.lower()
    if any(k in q for k in ("car", "truck", "vehic", "bus", "jeep", "auto", "racer")):
        return "vehicle"
    if any(k in q for k in ("build", "house", "tower", "arch", "shop", "apartment")):
        return "building"
    if any(k in q for k in ("tree", "oak", "pine", "willow", "palm", "forest", "plant")):
        return "tree"
    if any(k in q for k in ("stall", "bazaar", "market", "stand", "cart", "booth")):
        return "stall"
    return "vehicle"


def match_lvis_categories(lvis: dict, query: str) -> list[str]:
    q_clean = query.strip().lower()
    q_norm = re.sub(r"[^a-z0-9]+", "_", q_clean).strip("_")
    tokens = [t for t in re.split(r"[^a-z0-9]+", q_clean) if len(t) >= 2]

    matched = []
    seen = set()

    def add_cat(c: str):
        if c in lvis and c not in seen:
            seen.add(c)
            matched.append(c)

    # 1. Explicit synonyms
    for syn_key, syn_cats in QUERY_SYNONYMS.items():
        if syn_key in q_clean or q_clean in syn_key:
            for c in syn_cats:
                add_cat(c)

    # 2. Exact / prefix category matches
    for cat in lvis.keys():
        cat_low = cat.lower()
        if cat_low == q_norm or cat_low.startswith(q_norm + "_("):
            add_cat(cat)

    # 3. Whole-word token matches
    for cat in lvis.keys():
        cat_words = set(re.split(r"[^a-z0-9]+", cat.lower()))
        if any(t in cat_words for t in tokens):
            add_cat(cat)

    # 4. Substring fallback
    if not matched:
        for cat in lvis.keys():
            if any(t in cat.lower() for t in tokens):
                add_cat(cat)

    return matched


def inspect_glb_hierarchy(glb_path: Path) -> dict:
    """
    Parses the glTF 2.0 JSON chunk from a binary .glb file and extracts node names,
    mesh parts, vertex counts, bounding boxes, and material slots.
    """
    with open(glb_path, "rb") as f:
        header = f.read(12)
        if len(header) < 12:
            raise ValueError(f"Invalid GLB header in {glb_path}")
        magic, version, total_len = struct.unpack("<4sII", header)
        if magic != b"glTF":
            raise ValueError(f"Not a valid glTF binary: {glb_path}")
        chunk_len, chunk_type = struct.unpack("<II", f.read(8))
        json_bytes = f.read(chunk_len)

    gltf = json.loads(json_bytes.decode("utf-8", errors="replace"))
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    accessors = gltf.get("accessors", [])

    node_names = []
    for idx, n in enumerate(nodes):
        name = n.get("name") or f"node_{idx}"
        if name not in node_names:
            node_names.append(name)

    material_slots = []
    for idx, m in enumerate(materials):
        pbr = m.get("pbrMetallicRoughness", {})
        material_slots.append(
            {
                "index": idx,
                "name": m.get("name") or f"material_{idx}",
                "alphaMode": m.get("alphaMode", "OPAQUE"),
                "doubleSided": m.get("doubleSided", False),
                "metallicFactor": pbr.get("metallicFactor", 1.0),
                "roughnessFactor": pbr.get("roughnessFactor", 1.0),
            }
        )

    mesh_parts = []
    total_vertices = 0
    global_min = [float("inf"), float("inf"), float("inf")]
    global_max = [float("-inf"), float("-inf"), float("-inf")]

    for m_idx, mesh in enumerate(meshes):
        mesh_name = mesh.get("name") or f"mesh_{m_idx}"
        for p_idx, prim in enumerate(mesh.get("primitives", [])):
            attrs = prim.get("attributes", {})
            pos_idx = attrs.get("POSITION")
            v_count = 0
            bbox = None
            if pos_idx is not None and 0 <= pos_idx < len(accessors):
                acc = accessors[pos_idx]
                v_count = acc.get("count", 0)
                amin = acc.get("min")
                amax = acc.get("max")
                if amin and amax and len(amin) == 3 and len(amax) == 3:
                    size = [round(amax[i] - amin[i], 4) for i in range(3)]
                    bbox = {
                        "min": [round(x, 4) for x in amin],
                        "max": [round(x, 4) for x in amax],
                        "size": size,
                    }
                    for i in range(3):
                        global_min[i] = min(global_min[i], amin[i])
                        global_max[i] = max(global_max[i], amax[i])

            total_vertices += v_count
            mat_idx = prim.get("material")
            mat_name = (
                material_slots[mat_idx]["name"]
                if mat_idx is not None and 0 <= mat_idx < len(material_slots)
                else "default"
            )
            mesh_parts.append(
                {
                    "partName": mesh_name if p_idx == 0 else f"{mesh_name}_prim{p_idx}",
                    "vertexCount": v_count,
                    "materialSlot": mat_name,
                    "boundingBox": bbox,
                }
            )

    overall_bbox = None
    if global_min[0] != float("inf"):
        overall_bbox = {
            "min": [round(x, 4) for x in global_min],
            "max": [round(x, 4) for x in global_max],
            "size": [round(global_max[i] - global_min[i], 4) for i in range(3)],
        }

    return {
        "file": str(glb_path.relative_to(ROOT_DIR))
        if glb_path.is_relative_to(ROOT_DIR)
        else str(glb_path),
        "bytes": glb_path.stat().st_size,
        "nodeCount": len(nodes),
        "meshCount": len(meshes),
        "primitiveCount": len(mesh_parts),
        "totalVertices": total_vertices,
        "overallBoundingBox": overall_bbox,
        "nodeNames": node_names[:40],
        "materialSlots": material_slots[:25],
        "meshParts": mesh_parts[:30],
    }


def search_objaverse(query: str, limit: int = 5, download_ref: bool = True) -> dict:
    lvis = objaverse.load_lvis_annotations()
    matched_cats = match_lvis_categories(lvis, query)

    candidate_uids = []
    uid_to_cat = {}
    for cat in matched_cats[:8]:
        for uid in lvis.get(cat, [])[:15]:
            if uid not in uid_to_cat:
                uid_to_cat[uid] = cat
                candidate_uids.append(uid)
            if len(candidate_uids) >= max(limit * 8, 25):
                break
        if len(candidate_uids) >= max(limit * 8, 25):
            break

    annotations = objaverse.load_annotations(candidate_uids) if candidate_uids else {}
    tokens = [t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) >= 2]

    def score_item(uid: str, ann: dict) -> tuple:
        name = (ann.get("name") or "").strip()
        desc = (ann.get("description") or "").strip()
        tags = [t.get("name", "").lower() for t in ann.get("tags", [])]
        fc = ann.get("faceCount") or 0
        vc = ann.get("vertexCount") or 0
        is_ascii = 1 if name and all(32 <= ord(c) < 127 for c in name) else 0
        good_poly = 1 if 200 <= fc <= 150000 else 0
        text_blob = f"{name.lower()} {desc.lower()} {' '.join(tags)}"
        is_scan = (
            1
            if any(
                s in text_blob
                for s in ("scaniverse", "polycam", "everypoint", "lidar", "photogrammetry")
            )
            else 0
        )
        kw_hits = sum(1 for t in tokens if t in text_blob)
        return (is_ascii, 1 - is_scan, good_poly, kw_hits, min(fc, 50000))

    ranked_uids = sorted(
        [u for u in candidate_uids if u in annotations],
        key=lambda u: score_item(u, annotations[u]),
        reverse=True,
    )

    selected_uids = ranked_uids[:limit]
    family = detect_partnet_family(query)
    partnet_parts = PARTNET_BLUEPRINTS.get(family, PARTNET_BLUEPRINTS["vehicle"])

    results = []
    for uid in selected_uids:
        ann = annotations[uid]
        tags = [t.get("name") for t in ann.get("tags", []) if t.get("name")][:8]
        cats = [c.get("name") for c in ann.get("categories", []) if c.get("name")]
        results.append(
            {
                "uid": uid,
                "name": ann.get("name") or f"objaverse_{uid[:8]}",
                "lvisCategory": uid_to_cat.get(uid, "unknown"),
                "license": ann.get("license") or "CC-BY / Objaverse",
                "vertexCount": ann.get("vertexCount", 0),
                "faceCount": ann.get("faceCount", 0),
                "tags": tags,
                "categories": cats,
                "recommendedPartHierarchy": partnet_parts,
            }
        )

    reference_inspection = None
    if download_ref and selected_uids:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        ref_uid = selected_uids[0]
        downloaded = objaverse.load_objects([ref_uid])
        src_path_str = downloaded.get(ref_uid)
        if src_path_str and Path(src_path_str).exists():
            dest_glb = CACHE_DIR / f"{ref_uid}.glb"
            shutil.copy2(src_path_str, dest_glb)
            reference_inspection = inspect_glb_hierarchy(dest_glb)
            reference_inspection["uid"] = ref_uid
            reference_inspection["name"] = results[0]["name"]

    return {
        "query": query,
        "matchedLvisCategories": matched_cats[:10],
        "partnetFamily": family,
        "partnetBlueprint": partnet_parts,
        "count": len(results),
        "results": results,
        "referenceGlbInspection": reference_inspection,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Search Objaverse LVIS categories and inspect 3D .glb part hierarchies."
    )
    parser.add_argument(
        "--query",
        required=True,
        help='Search query (e.g. "sports car", "car", "tree", "building")',
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Maximum number of matching objects to return (default: 5)",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Skip downloading the top reference .glb",
    )
    args = parser.parse_args()

    out = search_objaverse(
        query=args.query, limit=args.limit, download_ref=not args.no_download
    )
    sys.stdout.write(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
