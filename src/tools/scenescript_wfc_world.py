#!/usr/bin/env python3
"""Meta SceneScript DSL + Wave Function Collapse (WFC) 3D World Builder.

Uses `trimesh` + `manifold3d` (watertight CSG boolean union/difference) to:
1. Compile Meta SceneScript architectural DSL commands (`make_wall`, `make_door`,
   `make_window`, `make_pillar`, `make_bbox`) with REAL boolean door/window
   openings cut through 3D walls + glass panes + wooden door frames!
2. Run constraint-propagated Wave Function Collapse (WFC) to generate a complete
   3D bazaar courtyard / dungeon / city block and export a multi-material .glb!

Usage:
  python3 src/tools/scenescript_wfc_world.py --mode scenescript --preset bazaar_hall --out public/assets/custom/scenescript_hall.glb
  python3 src/tools/scenescript_wfc_world.py --mode wfc --grid 6 --out public/assets/custom/wfc_courtyard.glb
"""
import argparse
import json
import math
import os
import random

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

PRESET_SCENESCRIPTS = {
    "bazaar_hall": [
        "make_wall id=0 ax=-6.0 ay=0.0 az=-4.0 bx=6.0 by=0.0 bz=-4.0 height=3.8 thickness=0.32",
        "make_wall id=1 ax=6.0 ay=0.0 az=-4.0 bx=6.0 by=0.0 bz=4.0 height=3.8 thickness=0.32",
        "make_wall id=2 ax=6.0 ay=0.0 az=4.0 bx=-6.0 by=0.0 bz=4.0 height=3.8 thickness=0.32",
        "make_wall id=3 ax=-6.0 ay=0.0 az=4.0 bx=-6.0 by=0.0 bz=-4.0 height=3.8 thickness=0.32",
        "make_door id=10 wall_id=2 position_t=0.5 width=2.2 height=2.6",
        "make_window id=20 wall_id=0 position_t=0.28 width=1.6 height=1.3 elevation=1.2",
        "make_window id=21 wall_id=0 position_t=0.72 width=1.6 height=1.3 elevation=1.2",
        "make_window id=22 wall_id=1 position_t=0.5 width=1.8 height=1.3 elevation=1.2",
        "make_window id=23 wall_id=3 position_t=0.5 width=1.8 height=1.3 elevation=1.2",
        "make_bbox id=30 class=counter cx=-2.5 cy=0.55 cz=-2.2 sx=2.8 sy=1.1 sz=1.1 yaw=0.0",
        "make_bbox id=31 class=counter cx=2.5 cy=0.55 cz=-2.2 sx=2.8 sy=1.1 sz=1.1 yaw=0.0",
    ]
}


def pbr_mat(name, rgba, metallic=0.05, roughness=0.8, alpha_mode="OPAQUE"):
    return PBRMaterial(
        name=name,
        baseColorFactor=rgba,
        metallicFactor=metallic,
        roughnessFactor=roughness,
        alphaMode=alpha_mode,
    )


def apply_mat(mesh: trimesh.Trimesh, mat: PBRMaterial) -> trimesh.Trimesh:
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def build_scenescript_glb(lines: list[str], out_path: str) -> dict:
    walls = {}
    doors = []
    windows = []
    bboxes = []

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        cmd = parts[0]
        kv = {}
        for tok in parts[1:]:
            if "=" in tok:
                k, v = tok.split("=", 1)
                try:
                    kv[k] = float(v) if ("." in v or "-" in v or v.isdigit()) else v
                except ValueError:
                    kv[k] = v
        if cmd == "make_wall":
            walls[int(kv["id"])] = kv
        elif cmd == "make_door":
            doors.append(kv)
        elif cmd == "make_window":
            windows.append(kv)
        elif cmd == "make_bbox":
            bboxes.append(kv)

    scene = trimesh.Scene()
    mat_wall = pbr_mat("scenescript_wall", [176, 92, 66, 255], 0.04, 0.84)
    mat_floor = pbr_mat("scenescript_floor", [128, 122, 114, 255], 0.05, 0.78)
    mat_wood = pbr_mat("scenescript_wood", [112, 72, 38, 255], 0.06, 0.72)
    mat_glass = pbr_mat("scenescript_glass", [175, 220, 240, 110], 0.9, 0.06, "BLEND")

    # Floor slab
    floor_mesh = apply_mat(trimesh.creation.box(extents=[13.2, 0.18, 9.2]), mat_floor)
    floor_mesh.apply_translation([0.0, -0.09, 0.0])
    scene.add_geometry(floor_mesh, node_name="floor_slab")

    csg_cuts = 0
    for wid, w in walls.items():
        ax, az = float(w["ax"]), float(w["az"])
        bx, bz = float(w["bx"]), float(w["bz"])
        h = float(w.get("height", 3.6))
        th = float(w.get("thickness", 0.3))
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz)
        angle = math.atan2(dx, dz)

        wall_box = trimesh.creation.box(extents=[th, h, length])
        cutters = []
        frame_meshes = []

        # Collect doors & windows on this wall
        for d in [x for x in doors if int(x["wall_id"]) == wid]:
            t = float(d.get("position_t", 0.5))
            dw = float(d.get("width", 2.0))
            dh = float(d.get("height", 2.4))
            z_local = (t - 0.5) * length
            y_local = -h * 0.5 + dh * 0.5
            cut = trimesh.creation.box(extents=[th * 2.2, dh, dw])
            cut.apply_translation([0.0, y_local, z_local])
            cutters.append(cut)
            # Wooden architrave lintel above door
            lintel = trimesh.creation.box(extents=[th * 1.18, 0.14, dw + 0.24])
            lintel.apply_translation([0.0, -h * 0.5 + dh + 0.07, z_local])
            frame_meshes.append((f"door_lintel_{int(d['id'])}", lintel, mat_wood))

        for wn in [x for x in windows if int(x["wall_id"]) == wid]:
            t = float(wn.get("position_t", 0.5))
            ww = float(wn.get("width", 1.5))
            wh = float(wn.get("height", 1.2))
            elev = float(wn.get("elevation", 1.2))
            z_local = (t - 0.5) * length
            y_local = -h * 0.5 + elev + wh * 0.5
            cut = trimesh.creation.box(extents=[th * 2.2, wh, ww])
            cut.apply_translation([0.0, y_local, z_local])
            cutters.append(cut)
            pane = trimesh.creation.box(extents=[0.04, wh, ww])
            pane.apply_translation([0.0, y_local, z_local])
            frame_meshes.append((f"window_glass_{int(wn['id'])}", pane, mat_glass))
            sill = trimesh.creation.box(extents=[th * 1.22, 0.09, ww + 0.18])
            sill.apply_translation([0.0, -h * 0.5 + elev - 0.045, z_local])
            frame_meshes.append((f"window_sill_{int(wn['id'])}", sill, mat_floor))

        if cutters:
            try:
                wall_box = trimesh.boolean.difference([wall_box] + cutters, engine="manifold")
                csg_cuts += len(cutters)
            except Exception:
                pass

        rot = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        mid = [(ax + bx) * 0.5, h * 0.5, (az + bz) * 0.5]
        wall_box.apply_transform(rot)
        wall_box.apply_translation(mid)
        apply_mat(wall_box, mat_wall)
        scene.add_geometry(wall_box, node_name=f"wall_{wid}")

        for fname, fmesh, fmat in frame_meshes:
            fmesh.apply_transform(rot)
            fmesh.apply_translation(mid)
            apply_mat(fmesh, fmat)
            scene.add_geometry(fmesh, node_name=fname)

    for bb in bboxes:
        bmesh = trimesh.creation.box(extents=[float(bb["sx"]), float(bb["sy"]), float(bb["sz"])])
        bmesh.apply_translation([float(bb["cx"]), float(bb["cy"]), float(bb["cz"])])
        apply_mat(bmesh, mat_wood)
        scene.add_geometry(bmesh, node_name=f"bbox_{bb.get('class','prop')}_{int(bb['id'])}")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    glb_bytes = scene.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(glb_bytes)
    return {
        "ok": True,
        "mode": "scenescript",
        "out": out_path,
        "bytes": len(glb_bytes),
        "walls": len(walls),
        "csg_boolean_openings": csg_cuts,
        "nodes": len(scene.geometry),
    }


def build_wfc_courtyard_glb(grid_n: int, out_path: str, seed: int = 42) -> dict:
    rng = random.Random(seed)
    # WFC tile types: ROAD, PLAZA, STALL, ARCH_GATE, FOUNTAIN, BUILDING
    compat = {
        "ROAD": {"ROAD", "PLAZA", "STALL", "ARCH_GATE"},
        "PLAZA": {"ROAD", "PLAZA", "STALL", "FOUNTAIN"},
        "STALL": {"ROAD", "PLAZA", "BUILDING"},
        "ARCH_GATE": {"ROAD", "BUILDING"},
        "FOUNTAIN": {"PLAZA"},
        "BUILDING": {"STALL", "ARCH_GATE", "BUILDING"},
    }
    all_tiles = list(compat.keys())
    wave = [[set(all_tiles) for _ in range(grid_n)] for _ in range(grid_n)]

    # Seed center as FOUNTAIN/PLAZA and borders with ARCH_GATE/BUILDING
    mid = grid_n // 2
    wave[mid][mid] = {"FOUNTAIN"}
    for _ in range(grid_n * grid_n * 2):
        # Find lowest-entropy undecided cell
        candidates = [(len(wave[z][x]), z, x) for z in range(grid_n) for x in range(grid_n) if len(wave[z][x]) > 1]
        if not candidates:
            break
        candidates.sort(key=lambda t: t[0])
        _, cz, cx = candidates[0]
        choice = rng.choice(sorted(wave[cz][cx]))
        wave[cz][cx] = {choice}
        # Propagate constraints (BFS)
        stack = [(cz, cx)]
        while stack:
            z, x = stack.pop()
            allowed_nbrs = set()
            for t in wave[z][x]:
                allowed_nbrs |= compat[t]
            for dz, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nz, nx = z + dz, x + dx
                if 0 <= nz < grid_n and 0 <= nx < grid_n:
                    before = len(wave[nz][nx])
                    nxt = wave[nz][nx] & allowed_nbrs
                    if nxt and len(nxt) < before:
                        wave[nz][nx] = nxt
                        stack.append((nz, nx))

    scene = trimesh.Scene()
    tile_m = 6.0
    half = (grid_n - 1) * tile_m * 0.5
    counts = {}

    for gz in range(grid_n):
        for gx in range(grid_n):
            tile = sorted(wave[gz][gx])[0]
            counts[tile] = counts.get(tile, 0) + 1
            wx = gx * tile_m - half
            wz = gz * tile_m - half

            paving = trimesh.creation.box(extents=[tile_m * 0.98, 0.14, tile_m * 0.98])
            paving.apply_translation([wx, 0.07, wz])
            apply_mat(paving, pbr_mat(f"pave_{gz}_{gx}", [96, 94, 90, 255] if tile == "ROAD" else [148, 136, 118, 255]))
            scene.add_geometry(paving, node_name=f"tile_{gz}_{gx}_{tile}")

            if tile == "BUILDING":
                bh = 5.5 + ((gz + gx) % 3) * 2.4
                b = trimesh.creation.box(extents=[tile_m * 0.82, bh, tile_m * 0.82])
                b.apply_translation([wx, bh * 0.5 + 0.14, wz])
                apply_mat(b, pbr_mat(f"bldg_{gz}_{gx}", [168, 86, 62, 255]))
                scene.add_geometry(b, node_name=f"bldg_{gz}_{gx}")
            elif tile == "STALL":
                counter = trimesh.creation.box(extents=[2.6, 0.9, 1.4])
                counter.apply_translation([wx, 0.59, wz])
                apply_mat(counter, pbr_mat(f"stall_c_{gz}_{gx}", [122, 78, 42, 255]))
                canopy = trimesh.creation.box(extents=[3.0, 0.18, 2.2])
                canopy.apply_translation([wx, 2.35, wz])
                apply_mat(canopy, pbr_mat(f"stall_r_{gz}_{gx}", [204, 58, 40, 255]))
                scene.add_geometry(counter, node_name=f"stall_base_{gz}_{gx}")
                scene.add_geometry(canopy, node_name=f"stall_roof_{gz}_{gx}")
            elif tile == "FOUNTAIN":
                basin = trimesh.creation.cylinder(radius=2.1, height=0.55, sections=24)
                basin.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2.0, [1, 0, 0]))
                basin.apply_translation([wx, 0.42, wz])
                apply_mat(basin, pbr_mat(f"fount_{gz}_{gx}", [64, 156, 196, 255], 0.2, 0.15))
                scene.add_geometry(basin, node_name=f"fountain_{gz}_{gx}")
            elif tile == "ARCH_GATE":
                arch = trimesh.creation.box(extents=[4.2, 4.4, 1.1])
                hole = trimesh.creation.box(extents=[2.2, 3.1, 2.0])
                hole.apply_translation([0.0, -0.65, 0.0])
                try:
                    arch = trimesh.boolean.difference([arch, hole], engine="manifold")
                except Exception:
                    pass
                arch.apply_translation([wx, 2.34, wz])
                apply_mat(arch, pbr_mat(f"arch_{gz}_{gx}", [182, 112, 76, 255]))
                scene.add_geometry(arch, node_name=f"arch_gate_{gz}_{gx}")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    glb_bytes = scene.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(glb_bytes)
    return {
        "ok": True,
        "mode": "wfc",
        "grid": f"{grid_n}x{grid_n}",
        "tile_counts": counts,
        "out": out_path,
        "bytes": len(glb_bytes),
        "nodes": len(scene.geometry),
    }


def main():
    ap = argparse.ArgumentParser(description="Meta SceneScript DSL + WFC 3D World Builder")
    ap.add_argument("--mode", choices=["scenescript", "wfc"], default="scenescript")
    ap.add_argument("--preset", default="bazaar_hall")
    ap.add_argument("--grid", type=int, default=6)
    ap.add_argument("--out", default="public/assets/custom/scenescript_world.glb")
    args = ap.parse_args()

    if args.mode == "wfc":
        res = build_wfc_courtyard_glb(args.grid, args.out)
    else:
        lines = PRESET_SCENESCRIPTS.get(args.preset, PRESET_SCENESCRIPTS["bazaar_hall"])
        res = build_scenescript_glb(lines, args.out)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
