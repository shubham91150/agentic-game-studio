#!/usr/bin/env python3
"""
Blender Built-in Addons + Part-by-Part Procedural Builder (src/tools/blender_pro_builder.py)

Leverages Blender 3.4's built-in precision modeling addons:
  - add_curve_sapling (Sapling Tree Generator — multi-branch + leaf-card 3D trees)
  - archimesh (Architectural rooms, doors, windows, columns, tiled roofs)
  - ant_landscape (A.N.T. Landscape procedural mountain / canyon / hills terrain)
  - add_mesh_extra_objects & add_mesh_BoltFactory

Can be invoked directly with python3 (automatically spawns headless Blender)
or inside `blender --background --python src/tools/blender_pro_builder.py -- ...`.

Usage:
  python3 src/tools/blender_pro_builder.py --type sapling_tree --preset oak --out tree.glb
  python3 src/tools/blender_pro_builder.py --type arch_building --floors 3 --width 10 --depth 8 --out building.glb
  python3 src/tools/blender_pro_builder.py --type landscape --preset canyon --out terrain.glb
"""

import argparse
import ast
import json
import math
import os
import site
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
SAPLING_PRESET_DIR = Path("/usr/share/blender/scripts/addons/add_curve_sapling/presets")


def parse_cli_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate 3D trees, buildings, and terrains using Blender built-in addons."
    )
    parser.add_argument(
        "--type",
        required=True,
        choices=["sapling_tree", "arch_building", "landscape"],
        help="Asset generator type",
    )
    parser.add_argument(
        "--preset",
        default="oak",
        help="Preset name: oak|pine|willow for sapling_tree, canyon|mountain|hills for landscape",
    )
    parser.add_argument(
        "--floors",
        type=int,
        default=3,
        help="Number of floors for arch_building (default: 3)",
    )
    parser.add_argument(
        "--width",
        type=float,
        default=10.0,
        help="Building width in meters for arch_building (default: 10.0)",
    )
    parser.add_argument(
        "--depth",
        type=float,
        default=8.0,
        help="Building depth in meters for arch_building (default: 8.0)",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output .glb file path",
    )
    return parser.parse_args(argv)


def run_outside_blender():
    args = parse_cli_args(sys.argv[1:])
    cmd = [
        "blender",
        "--background",
        "--python",
        str(Path(__file__).resolve()),
        "--",
        *sys.argv[1:],
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout + "\n" + proc.stderr + "\n")
        sys.exit(proc.returncode)

    # Extract JSON summary line emitted by the Blender runner
    summary = None
    for line in reversed(proc.stdout.splitlines()):
        if line.startswith("BLENDER_PRO_JSON:"):
            summary = json.loads(line[len("BLENDER_PRO_JSON:") :])
            break
    if summary:
        sys.stdout.write(json.dumps(summary, indent=2) + "\n")
    else:
        sys.stdout.write(proc.stdout)


# ============================================================================
# Inside-Blender Execution Path
# ============================================================================
def run_inside_blender():
    for extra in (site.getusersitepackages(), "/usr/share/blender/scripts/addons"):
        if extra not in sys.path:
            sys.path.append(extra)

    import addon_utils
    import bmesh
    import bpy

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parse_cli_args(argv)
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    enabled_addons = []
    for mod_name in (
        "add_curve_sapling",
        "archimesh",
        "ant_landscape",
        "add_mesh_extra_objects",
        "add_mesh_BoltFactory",
    ):
        try:
            bpy.ops.preferences.addon_enable(module=mod_name)
            enabled_addons.append(mod_name)
        except Exception:
            try:
                addon_utils.enable(mod_name, default_set=True)
                enabled_addons.append(mod_name)
            except Exception:
                pass

    # Clean default scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)

    def make_pbr_mat(
        name: str,
        base_color: tuple[float, float, float, float],
        roughness: float = 0.7,
        metallic: float = 0.0,
        alpha: float = 1.0,
        emission: tuple[float, float, float] | None = None,
    ):
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = base_color
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = metallic
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = alpha
            if emission and "Emission" in bsdf.inputs:
                bsdf.inputs["Emission"].default_value = (*emission, 1.0)
                if "Emission Strength" in bsdf.inputs:
                    bsdf.inputs["Emission Strength"].default_value = 2.0
        if alpha < 1.0:
            mat.blend_method = "BLEND"
        return mat

    def assign_mat(obj, mat):
        if obj.type != "MESH" or obj.data is None:
            return
        obj.data.materials.clear()
        obj.data.materials.append(mat)

    def add_bevel_and_weighted_normals(obj, width: float = 0.015, segments: int = 2):
        if obj.type != "MESH":
            return
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(35)
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = width
        bev.segments = segments
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(30)
        wn = obj.modifiers.new(name="WeightedNormal", type="WEIGHTED_NORMAL")
        wn.keep_sharp = True

    def create_box_part(
        name: str,
        size: tuple[float, float, float],
        location: tuple[float, float, float],
        mat,
        bevel_width: float = 0.015,
    ):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = (size[0], size[1], size[2])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign_mat(obj, mat)
        if bevel_width > 0:
            add_bevel_and_weighted_normals(obj, width=bevel_width, segments=2)
        return obj

    # ========================================================================
    # 1. SAPLING TREE GENERATOR (add_curve_sapling)
    # ========================================================================
    if args.type == "sapling_tree":
        preset_map = {
            "oak": "japanese_maple.py",
            "pine": "small_pine.py",
            "willow": "weeping_willow.py",
        }
        preset_key = args.preset.lower()
        preset_file = SAPLING_PRESET_DIR / preset_map.get(
            preset_key, "japanese_maple.py"
        )
        raw_text = preset_file.read_text(encoding="utf-8")
        preset_dict = ast.literal_eval(raw_text)

        valid_props = set(bpy.ops.curve.tree_add.get_rna_type().properties.keys())
        kw = {k: v for k, v in preset_dict.items() if k in valid_props}

        # Optimize for game-ready real-time 3D multi-branch + leaf-card hierarchy
        kw["do_update"] = True
        kw["bevel"] = True
        kw["showLeaves"] = True
        kw["useArm"] = False
        kw["makeMesh"] = False
        kw["levels"] = 3
        kw["bevelRes"] = 2
        kw["curveRes"] = (8, 5, 3, 1)

        if preset_key == "oak":
            kw["scale"] = 7.5
            kw["baseSplits"] = 2
            kw["branches"] = (0, 28, 10, 8)
            kw["leaves"] = 22
            kw["leafScale"] = 0.36
            kw["leafScaleX"] = 0.55
            kw["leafShape"] = "hex"
            bark_col = (0.24, 0.16, 0.10, 1.0)
            leaf_col = (0.16, 0.38, 0.11, 1.0)
        elif preset_key == "pine":
            kw["scale"] = 9.0
            kw["baseSplits"] = 0
            kw["branches"] = (0, 32, 8, 8)
            kw["leaves"] = 24
            kw["leafScale"] = 0.32
            kw["leafScaleX"] = 0.18
            kw["leafShape"] = "rect"
            bark_col = (0.28, 0.17, 0.11, 1.0)
            leaf_col = (0.09, 0.27, 0.10, 1.0)
        else:  # willow
            kw["scale"] = 8.0
            kw["baseSplits"] = 2
            kw["branches"] = (0, 24, 12, 10)
            kw["leaves"] = 26
            kw["leafScale"] = 0.38
            kw["leafScaleX"] = 0.22
            kw["leafShape"] = "hex"
            bark_col = (0.26, 0.20, 0.13, 1.0)
            leaf_col = (0.22, 0.44, 0.14, 1.0)

        bpy.ops.curve.tree_add(**kw)

        bark_mat = make_pbr_mat("bark_pbr", bark_col, roughness=0.88, metallic=0.0)
        leaf_mat = make_pbr_mat(
            "leaf_canopy_pbr", leaf_col, roughness=0.58, metallic=0.0
        )

        # Convert Sapling curve ("tree") into mesh ("trunk_main")
        tree_curve = bpy.data.objects.get("tree")
        if tree_curve:
            bpy.ops.object.select_all(action="DESELECT")
            tree_curve.select_set(True)
            bpy.context.view_layer.objects.active = tree_curve
            bpy.ops.object.convert(target="MESH")
            tree_curve.name = "trunk_main"
            assign_mat(tree_curve, bark_mat)

        leaves_obj = bpy.data.objects.get("leaves")
        if leaves_obj:
            leaves_obj.name = "leaf_canopy_clusters"
            assign_mat(leaves_obj, leaf_mat)

        # Add anatomical root_flare collar at base
        bpy.ops.mesh.primitive_cone_add(
            vertices=12,
            radius1=0.62,
            radius2=0.28,
            depth=0.75,
            location=(0.0, 0.0, 0.35),
        )
        root_flare = bpy.context.active_object
        root_flare.name = "root_flare"
        assign_mat(root_flare, bark_mat)

    # ========================================================================
    # 2. ARCHIMESH + PARTNET ARCHITECTURAL BUILDING (arch_building)
    # ========================================================================
    elif args.type == "arch_building":
        floors = max(1, args.floors)
        w = max(4.0, float(args.width))
        d = max(4.0, float(args.depth))
        floor_h = 3.2
        total_h = floors * floor_h
        plinth_h = 0.45

        mat_plinth = make_pbr_mat(
            "foundation_stone_pbr", (0.34, 0.34, 0.36, 1.0), roughness=0.85
        )
        mat_facade = make_pbr_mat(
            "wall_facade_brick_pbr", (0.64, 0.36, 0.26, 1.0), roughness=0.78
        )
        mat_trim = make_pbr_mat(
            "cornice_trim_pbr", (0.82, 0.79, 0.73, 1.0), roughness=0.65
        )
        mat_frame = make_pbr_mat(
            "window_frame_metal_pbr",
            (0.16, 0.17, 0.19, 1.0),
            roughness=0.35,
            metallic=0.8,
        )
        mat_glass = make_pbr_mat(
            "glass_pane_reflective_pbr",
            (0.18, 0.28, 0.38, 1.0),
            roughness=0.08,
            metallic=0.1,
            alpha=0.65,
        )
        mat_door = make_pbr_mat(
            "door_wood_pbr", (0.28, 0.16, 0.09, 1.0), roughness=0.52
        )
        mat_roof = make_pbr_mat(
            "roof_slates_terracotta_pbr", (0.58, 0.24, 0.16, 1.0), roughness=0.72
        )
        mat_hvac = make_pbr_mat(
            "rooftop_hvac_metal_pbr",
            (0.52, 0.55, 0.58, 1.0),
            roughness=0.42,
            metallic=0.75,
        )

        # Part 1: foundation_plinth
        create_box_part(
            "foundation_plinth",
            (w + 0.4, d + 0.4, plinth_h),
            (0.0, 0.0, plinth_h * 0.5),
            mat_plinth,
            bevel_width=0.02,
        )

        # Part 2: Archimesh Room Perimeter + Multi-Floor Wall Facade
        bpy.ops.mesh.archimesh_room()
        room_obj = bpy.data.objects.get("Room")
        if room_obj and hasattr(room_obj, "RoomGenerator") and room_obj.RoomGenerator:
            rg = room_obj.RoomGenerator[0]
            rg.room_height = total_h
            rg.wall_width = 0.24
            rg.wall_num = 4
            rg.walls[0].w = w
            rg.walls[1].w = d
            rg.walls[2].w = w
            rg.walls[3].w = d
            rg.merge = True
            rg.floor = True
            rg.ceiling = True
            room_obj.location = (-w * 0.5, -d * 0.5, plinth_h)
            room_obj.name = "wall_facade"
            assign_mat(room_obj, mat_facade)

        # Clean up Archimesh helper baseboard control empties if present
        for helper_name in ("Baseboard", "CTRL_Baseboard"):
            h_obj = bpy.data.objects.get(helper_name)
            if h_obj:
                h_obj.location = (-w * 0.5, -d * 0.5, plinth_h)
                if h_obj.type == "MESH":
                    assign_mat(h_obj, mat_trim)

        # Part 3: Archimesh Entrance Door + Columns + Canopy
        bpy.ops.mesh.archimesh_door()
        door_grp = bpy.data.objects.get("Door_Group")
        if door_grp:
            door_grp.location = (-0.5, -d * 0.5 - 0.05, plinth_h)
            door_grp.name = "door_entrance_group"
        for d_part, d_mat in (
            ("Door", mat_door),
            ("DoorFrame", mat_trim),
            ("Handle_Front", mat_frame),
            ("Handle_Back", mat_frame),
        ):
            obj = bpy.data.objects.get(d_part)
            if obj:
                obj.name = "door_entrance" if d_part == "Door" else f"door_{d_part.lower()}"
                assign_mat(obj, d_mat)

        # Entrance columns via Archimesh column generator
        for side_idx, col_x in enumerate((-1.35, 1.35)):
            bpy.ops.mesh.archimesh_column(
                col_height=floor_h * 0.88,
                rad_bottom=0.16,
                rad_top=0.14,
                box_base=True,
                box_base_x=0.38,
                box_base_y=0.38,
                box_base_z=0.22,
                box_top=True,
                box_top_x=0.38,
                box_top_y=0.38,
                box_top_z=0.18,
            )
            col_obj = bpy.context.active_object
            if col_obj:
                col_obj.name = f"entrance_column_{side_idx}"
                col_obj.location = (col_x, -d * 0.5 - 0.55, plinth_h)
                assign_mat(col_obj, mat_trim)

        # Entrance Canopy
        create_box_part(
            "canopy",
            (3.2, 1.25, 0.22),
            (0.0, -d * 0.5 - 0.55, plinth_h + floor_h * 0.88),
            mat_trim,
            bevel_width=0.02,
        )

        # Part 4: Archimesh Window Panel + Multi-bay Window Frames & Glass Panes
        bpy.ops.mesh.archimesh_winpanel()
        win_obj = bpy.data.objects.get("Window")
        win_grp = bpy.data.objects.get("Window_Group")
        if win_grp:
            win_grp.location = (-w * 0.3, -d * 0.5 - 0.06, plinth_h + floor_h + 0.8)
            win_grp.name = "archimesh_window_group"
        if win_obj:
            win_obj.name = "archimesh_window_panel"
            assign_mat(win_obj, mat_frame)

        # Build modular window_frames and glass_panes across all floors & facades
        bays_x = max(2, int(w // 2.6))
        spacing_x = (w - 1.6) / max(1, bays_x - 1) if bays_x > 1 else 0.0
        frame_objs = []
        glass_objs = []

        for fl in range(floors):
            z_center = plinth_h + fl * floor_h + 1.65
            for bx in range(bays_x):
                x_pos = -((bays_x - 1) * spacing_x) * 0.5 + bx * spacing_x
                for side_sign in (-1.0, 1.0):
                    # Skip ground-floor center bay on front facade where entrance door sits
                    if fl == 0 and side_sign < 0 and abs(x_pos) < 1.3:
                        continue
                    y_pos = side_sign * (d * 0.5 + 0.03)
                    f_obj = create_box_part(
                        f"window_frame_f{fl}_b{bx}_{'S' if side_sign<0 else 'N'}",
                        (1.25, 0.14, 1.45),
                        (x_pos, y_pos, z_center),
                        mat_frame,
                        bevel_width=0.01,
                    )
                    g_obj = create_box_part(
                        f"glass_pane_f{fl}_b{bx}_{'S' if side_sign<0 else 'N'}",
                        (1.05, 0.06, 1.25),
                        (x_pos, y_pos + side_sign * 0.02, z_center),
                        mat_glass,
                        bevel_width=0.0,
                    )
                    frame_objs.append(f_obj)
                    glass_objs.append(g_obj)

        # Join window frames into `window_frames` and glass panes into `glass_panes`
        if frame_objs:
            bpy.ops.object.select_all(action="DESELECT")
            for o in frame_objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = frame_objs[0]
            bpy.ops.object.join()
            frame_objs[0].name = "window_frames"

        if glass_objs:
            bpy.ops.object.select_all(action="DESELECT")
            for o in glass_objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = glass_objs[0]
            bpy.ops.object.join()
            glass_objs[0].name = "glass_panes"

        # Part 5: balcony_railings on upper floors
        balcony_objs = []
        for fl in range(1, floors):
            bz = plinth_h + fl * floor_h
            slab = create_box_part(
                f"balcony_slab_{fl}",
                (3.4, 0.9, 0.14),
                (0.0, -d * 0.5 - 0.45, bz),
                mat_trim,
                bevel_width=0.01,
            )
            rail_top = create_box_part(
                f"balcony_rail_top_{fl}",
                (3.4, 0.06, 0.06),
                (0.0, -d * 0.5 - 0.85, bz + 0.95),
                mat_frame,
                bevel_width=0.005,
            )
            balcony_objs.extend([slab, rail_top])
            for rx in (-1.6, -0.8, 0.0, 0.8, 1.6):
                post = create_box_part(
                    f"balcony_post_{fl}_{rx}",
                    (0.05, 0.05, 0.9),
                    (rx, -d * 0.5 - 0.85, bz + 0.48),
                    mat_frame,
                    bevel_width=0.0,
                )
                balcony_objs.append(post)

        if balcony_objs:
            bpy.ops.object.select_all(action="DESELECT")
            for o in balcony_objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = balcony_objs[0]
            bpy.ops.object.join()
            balcony_objs[0].name = "balcony_railings"

        # Part 6: cornice_ledge (floor belt courses + crowning parapet cornice)
        cornice_objs = []
        for fl in range(1, floors + 1):
            cz = plinth_h + fl * floor_h
            overhang = 0.55 if fl == floors else 0.25
            ch = 0.32 if fl == floors else 0.16
            c_obj = create_box_part(
                f"cornice_tier_{fl}",
                (w + overhang, d + overhang, ch),
                (0.0, 0.0, cz),
                mat_trim,
                bevel_width=0.02,
            )
            cornice_objs.append(c_obj)
        if cornice_objs:
            bpy.ops.object.select_all(action="DESELECT")
            for o in cornice_objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = cornice_objs[0]
            bpy.ops.object.join()
            cornice_objs[0].name = "cornice_ledge"

        # Part 7: roof_slates via Archimesh Roof Generator (`bpy.ops.mesh.archimesh_roof`)
        roof_z = plinth_h + total_h + 0.18
        bpy.ops.mesh.archimesh_roof(
            model="1",
            roof_width=max(4, int(w * 0.7)),
            roof_height=max(3, int(d * 0.5)),
            roof_thick=0.025,
            roof_angle=10.0,
            roof_scale=1.4,
            crt_mat=False,
        )
        roof_obj = bpy.data.objects.get("Roof")
        if roof_obj:
            roof_obj.name = "roof_slates"
            roof_obj.location = (-w * 0.48, -d * 0.48, roof_z)
            assign_mat(roof_obj, mat_roof)
            dec = roof_obj.modifiers.new(name="RoofOptimize", type="DECIMATE")
            dec.ratio = 0.25

        # Part 8: rooftop_hvac (mechanical unit + dual condenser fans + duct)
        hvac_base = create_box_part(
            "rooftop_hvac_body",
            (2.1, 1.4, 1.1),
            (w * 0.22, d * 0.18, roof_z + 0.55),
            mat_hvac,
            bevel_width=0.02,
        )
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=16,
            radius=0.38,
            depth=0.25,
            location=(w * 0.22 - 0.45, d * 0.18, roof_z + 1.18),
        )
        fan1 = bpy.context.active_object
        assign_mat(fan1, mat_frame)
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=16,
            radius=0.38,
            depth=0.25,
            location=(w * 0.22 + 0.45, d * 0.18, roof_z + 1.18),
        )
        fan2 = bpy.context.active_object
        assign_mat(fan2, mat_frame)
        bpy.ops.object.select_all(action="DESELECT")
        for o in (hvac_base, fan1, fan2):
            o.select_set(True)
        bpy.context.view_layer.objects.active = hvac_base
        bpy.ops.object.join()
        hvac_base.name = "rooftop_hvac"

        # Remove boolean helper boxes ("CTRL_Hole*") before glTF export
        for o in list(bpy.data.objects):
            if o.name.startswith("CTRL_Hole"):
                bpy.data.objects.remove(o, do_unlink=True)

    # ========================================================================
    # 3. A.N.T. LANDSCAPE PROCEDURAL TERRAIN (ant_landscape)
    # ========================================================================
    elif args.type == "landscape":
        preset_key = args.preset.lower()
        if preset_key == "canyon":
            ant_kw = dict(
                refresh=True,
                ant_terrain_name="canyon_terrain",
                mesh_size_x=80.0,
                mesh_size_y=80.0,
                subdivision_x=96,
                subdivision_y=96,
                noise_type="strata_hterrain",
                noise_size=1.8,
                noise_depth=8,
                height=14.0,
                strata=6.0,
                strata_type="2",
                edge_falloff="0",
                smooth_mesh=True,
            )
            terrain_col = (0.68, 0.36, 0.21, 1.0)
            terrain_rough = 0.86
        elif preset_key == "mountain":
            ant_kw = dict(
                refresh=True,
                ant_terrain_name="mountain_terrain",
                mesh_size_x=80.0,
                mesh_size_y=80.0,
                subdivision_x=96,
                subdivision_y=96,
                noise_type="ridged_multi_fractal",
                noise_size=2.2,
                noise_depth=9,
                height=18.0,
                lacunarity=2.1,
                gain=1.2,
                 offset=0.9,
                edge_falloff="3",
                smooth_mesh=True,
            )
            terrain_col = (0.38, 0.39, 0.42, 1.0)
            terrain_rough = 0.82
        else:  # hills
            ant_kw = dict(
                refresh=True,
                ant_terrain_name="hills_terrain",
                mesh_size_x=80.0,
                mesh_size_y=80.0,
                subdivision_x=96,
                subdivision_y=96,
                noise_type="hetero_terrain",
                noise_size=2.6,
                noise_depth=7,
                height=7.0,
                edge_falloff="0",
                smooth_mesh=True,
            )
            terrain_col = (0.24, 0.42, 0.18, 1.0)
            terrain_rough = 0.88

        bpy.ops.mesh.landscape_add(**ant_kw)
        land_obj = bpy.context.active_object
        if land_obj and land_obj.type == "MESH":
            land_obj.name = f"landscape_{preset_key}"
            mat_land = make_pbr_mat(
                f"terrain_{preset_key}_pbr",
                terrain_col,
                roughness=terrain_rough,
                metallic=0.0,
            )
            assign_mat(land_obj, mat_land)

    # Export to binary glTF (.glb)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_apply=True,
        export_materials="EXPORT",
    )

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    total_verts = sum(len(o.data.vertices) for o in mesh_objs)
    total_faces = sum(len(o.data.polygons) for o in mesh_objs)

    summary = {
        "type": args.type,
        "preset": args.preset,
        "out": str(out_path),
        "bytes": out_path.stat().st_size if out_path.exists() else 0,
        "enabledAddons": enabled_addons,
        "meshCount": len(mesh_objs),
        "meshParts": [o.name for o in mesh_objs],
        "totalVertices": total_verts,
        "totalFaces": total_faces,
    }
    print("BLENDER_PRO_JSON:" + json.dumps(summary))


if __name__ == "__main__":
    try:
        import bpy  # noqa: F401

        IN_BLENDER = True
    except ImportError:
        IN_BLENDER = False

    if IN_BLENDER:
        run_inside_blender()
    else:
        run_outside_blender()
