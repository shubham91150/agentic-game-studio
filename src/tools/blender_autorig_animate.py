#!/usr/bin/env python3
"""
Blender In-House Armature Auto-Rig + Walk/Idle/Wave Keyframe Animation Baker
(src/tools/blender_autorig_animate.py)

Chat requirement:
  "Tere 3D mesh pe auto skeleton + walk/idle animation — bina iske 3D model murti jaisa khada rahega."

Can be invoked directly with python3 (automatically spawns headless Blender)
or inside `blender --background --python src/tools/blender_autorig_animate.py -- ...`.

Usage:
  python3 src/tools/blender_autorig_animate.py --preset shopkeeper --out public/assets/custom/npc_animated.glb
  python3 src/tools/blender_autorig_animate.py --preset runner --out public/assets/custom/runner_animated.glb
  python3 src/tools/blender_autorig_animate.py --in model.glb --out public/assets/custom/rigged.glb
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path


def parse_cli_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Auto-rig a 3D mesh or humanoid NPC preset with a Blender Armature skeleton and bake Idle, Walk, and Wave animations."
    )
    parser.add_argument(
        "--in",
        dest="in_glb",
        default=None,
        help="Optional input .glb file to auto-rig and animate",
    )
    parser.add_argument(
        "--preset",
        default="shopkeeper",
        choices=["shopkeeper", "runner", "guard"],
        help="Procedural humanoid character preset if --in is not supplied (default: shopkeeper)",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output animated .glb path (e.g. public/assets/custom/npc_animated.glb)",
    )
    return parser.parse_args(argv)


def run_outside_blender():
    parse_cli_args(sys.argv[1:])
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

    summary = None
    for line in reversed(proc.stdout.splitlines()):
        if line.startswith("BLENDER_AUTORIG_JSON:"):
            summary = json.loads(line[len("BLENDER_AUTORIG_JSON:") :])
            break
    if summary:
        sys.stdout.write(json.dumps(summary, indent=2) + "\n")
    else:
        sys.stdout.write(proc.stdout)


def run_inside_blender():
    import bpy
    from mathutils import Vector

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parse_cli_args(argv)
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Clear default scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    def make_pbr_mat(name, color, roughness=0.65, metallic=0.0):
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = metallic
        return mat

    def assign_mat(obj, mat):
        if obj.type != "MESH" or obj.data is None:
            return
        obj.data.materials.clear()
        obj.data.materials.append(mat)

    preset = (args.preset or "shopkeeper").lower()
    if preset == "shopkeeper":
        skin_col = (0.76, 0.54, 0.38, 1.0)
        tunic_col = (0.82, 0.42, 0.14, 1.0)  # Warm saffron/ochre kurta
        pants_col = (0.90, 0.87, 0.80, 1.0)  # Off-white dhoti/pyjama
        accent_col = (0.64, 0.14, 0.16, 1.0)  # Crimson turban/cap & vest
        shoe_col = (0.28, 0.16, 0.08, 1.0)
    elif preset == "runner":
        skin_col = (0.74, 0.52, 0.36, 1.0)
        tunic_col = (0.14, 0.48, 0.86, 1.0)  # Athletic cobalt jersey
        pants_col = (0.16, 0.18, 0.22, 1.0)  # Dark track shorts/leggings
        accent_col = (0.95, 0.78, 0.15, 1.0)  # Neon headband/stripes
        shoe_col = (0.88, 0.22, 0.18, 1.0)
    else:  # guard
        skin_col = (0.72, 0.50, 0.35, 1.0)
        tunic_col = (0.22, 0.28, 0.20, 1.0)  # Olive/khaki uniform
        pants_col = (0.18, 0.22, 0.16, 1.0)
        accent_col = (0.72, 0.58, 0.22, 1.0)  # Brass shoulder/belt trim
        shoe_col = (0.12, 0.12, 0.12, 1.0)

    mat_skin = make_pbr_mat("npc_skin_pbr", skin_col, roughness=0.58)
    mat_tunic = make_pbr_mat("npc_tunic_pbr", tunic_col, roughness=0.72)
    mat_pants = make_pbr_mat("npc_pants_pbr", pants_col, roughness=0.76)
    mat_accent = make_pbr_mat(
        "npc_accent_pbr",
        accent_col,
        roughness=0.45,
        metallic=0.35 if preset == "guard" else 0.05,
    )
    mat_shoe = make_pbr_mat("npc_shoe_pbr", shoe_col, roughness=0.52)

    # 1. Build Armature Skeleton (`root`, `spine`, `head`, `arm_L`, `arm_R`, `leg_L`, `leg_R`)
    arm_data = bpy.data.armatures.new("NPCArmatureData")
    arm_obj = bpy.data.objects.new("NPCArmature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones

    b_root = eb.new("root")
    b_root.head = (0.0, 0.0, 0.0)
    b_root.tail = (0.0, 0.0, 0.88)

    b_spine = eb.new("spine")
    b_spine.head = (0.0, 0.0, 0.88)
    b_spine.tail = (0.0, 0.0, 1.44)
    b_spine.parent = b_root
    b_spine.use_connect = True

    b_head = eb.new("head")
    b_head.head = (0.0, 0.0, 1.44)
    b_head.tail = (0.0, 0.0, 1.78)
    b_head.parent = b_spine
    b_head.use_connect = True

    b_arm_l = eb.new("arm_L")
    b_arm_l.head = (0.24, 0.0, 1.38)
    b_arm_l.tail = (0.28, 0.0, 0.78)
    b_arm_l.parent = b_spine
    b_arm_l.use_connect = False

    b_arm_r = eb.new("arm_R")
    b_arm_r.head = (-0.24, 0.0, 1.38)
    b_arm_r.tail = (-0.28, 0.0, 0.78)
    b_arm_r.parent = b_spine
    b_arm_r.use_connect = False

    b_leg_l = eb.new("leg_L")
    b_leg_l.head = (0.12, 0.0, 0.88)
    b_leg_l.tail = (0.12, 0.0, 0.04)
    b_leg_l.parent = b_root
    b_leg_l.use_connect = False

    b_leg_r = eb.new("leg_R")
    b_leg_r.head = (-0.12, 0.0, 0.88)
    b_leg_r.tail = (-0.12, 0.0, 0.04)
    b_leg_r.parent = b_root
    b_leg_r.use_connect = False

    bpy.ops.object.mode_set(mode="OBJECT")

    bone_names = ["root", "spine", "head", "arm_L", "arm_R", "leg_L", "leg_R"]
    created_meshes = []

    def add_mesh_with_bone_group(obj, bone_name: str):
        for bn in bone_names:
            if bn not in obj.vertex_groups:
                obj.vertex_groups.new(name=bn)
        vg = obj.vertex_groups[bone_name]
        all_indices = [v.index for v in obj.data.vertices]
        vg.add(all_indices, 1.0, "REPLACE")
        created_meshes.append(obj)

    if args.in_glb and Path(args.in_glb).exists():
        in_path = Path(args.in_glb).resolve()
        bpy.ops.import_scene.gltf(filepath=str(in_path))
        imported = [
            o for o in bpy.data.objects if o.type == "MESH" and o not in created_meshes
        ]
        # Auto-assign vertices of imported mesh(es) to nearest bone in world space
        bone_segments = {
            "root": (Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.88))),
            "spine": (Vector((0.0, 0.0, 0.88)), Vector((0.0, 0.0, 1.44))),
            "head": (Vector((0.0, 0.0, 1.44)), Vector((0.0, 0.0, 1.78))),
            "arm_L": (Vector((0.24, 0.0, 1.38)), Vector((0.28, 0.0, 0.78))),
            "arm_R": (Vector((-0.24, 0.0, 1.38)), Vector((-0.28, 0.0, 0.78))),
            "leg_L": (Vector((0.12, 0.0, 0.88)), Vector((0.12, 0.0, 0.04))),
            "leg_R": (Vector((-0.12, 0.0, 0.88)), Vector((-0.12, 0.0, 0.04))),
        }
        for obj in imported:
            for bn in bone_names:
                if bn not in obj.vertex_groups:
                    obj.vertex_groups.new(name=bn)
            mw = obj.matrix_world
            for v in obj.data.vertices:
                wp = mw @ v.co
                best_b = "spine"
                best_d = 1e9
                for bn, (p0, p1) in bone_segments.items():
                    mid = (p0 + p1) * 0.5
                    d = (wp - mid).length
                    if d < best_d:
                        best_d = d
                        best_b = bn
                obj.vertex_groups[best_b].add([v.index], 1.0, "REPLACE")
            created_meshes.append(obj)
    else:
        # 2. Generate articulated humanoid character parts (head, torso, upper/lower arms, hands, upper/lower legs, feet)
        def make_part(
            name, primitive, location, scale, mat, bone_name, rotation=(0.0, 0.0, 0.0)
        ):
            if primitive == "sphere":
                bpy.ops.mesh.primitive_uv_sphere_add(
                    segments=16, ring_count=12, radius=0.5, location=location
                )
            elif primitive == "cylinder":
                bpy.ops.mesh.primitive_cylinder_add(
                    vertices=14, radius=0.5, depth=1.0, location=location
                )
            else:
                bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
            obj = bpy.context.active_object
            obj.name = name
            obj.scale = scale
            obj.rotation_euler = rotation
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            assign_mat(obj, mat)
            bev = obj.modifiers.new(name="Bevel", type="BEVEL")
            bev.width = 0.012
            bev.segments = 2
            bpy.ops.object.modifier_apply(modifier=bev.name)
            add_mesh_with_bone_group(obj, bone_name)
            return obj

        # Pelvis / waist (root)
        make_part(
            "pelvis_waist",
            "cylinder",
            (0.0, 0.0, 0.88),
            (0.34, 0.24, 0.16),
            mat_pants,
            "root",
        )

        # Torso & vest/collar (spine)
        make_part(
            "torso_chest",
            "cube",
            (0.0, 0.0, 1.17),
            (0.40, 0.24, 0.50),
            mat_tunic,
            "spine",
        )
        make_part(
            "torso_vest_trim",
            "cube",
            (0.0, -0.01, 1.20),
            (0.42, 0.25, 0.36),
            mat_accent,
            "spine",
        )
        make_part(
            "neck_collar",
            "cylinder",
            (0.0, 0.0, 1.45),
            (0.14, 0.14, 0.10),
            mat_skin,
            "spine",
        )

        # Head + headgear/hair + nose (head)
        make_part(
            "head_cranium",
            "sphere",
            (0.0, 0.0, 1.60),
            (0.24, 0.25, 0.27),
            mat_skin,
            "head",
        )
        make_part(
            "head_turban_cap",
            "cylinder",
            (0.0, 0.01, 1.71),
            (0.27, 0.28, 0.13),
            mat_accent,
            "head",
        )
        make_part(
            "head_nose",
            "cube",
            (0.0, -0.13, 1.59),
            (0.04, 0.05, 0.05),
            mat_skin,
            "head",
        )

        # Left Arm: upper arm, lower forearm, hand (arm_L)
        make_part(
            "upper_arm_L",
            "cylinder",
            (0.26, 0.0, 1.24),
            (0.11, 0.11, 0.28),
            mat_tunic,
            "arm_L",
        )
        make_part(
            "lower_arm_L",
            "cylinder",
            (0.27, 0.0, 0.96),
            (0.095, 0.095, 0.26),
            mat_skin,
            "arm_L",
        )
        make_part(
            "hand_L",
            "sphere",
            (0.28, 0.0, 0.79),
            (0.09, 0.07, 0.11),
            mat_skin,
            "arm_L",
        )

        # Right Arm: upper arm, lower forearm, hand (arm_R)
        make_part(
            "upper_arm_R",
            "cylinder",
            (-0.26, 0.0, 1.24),
            (0.11, 0.11, 0.28),
            mat_tunic,
            "arm_R",
        )
        make_part(
            "lower_arm_R",
            "cylinder",
            (-0.27, 0.0, 0.96),
            (0.095, 0.095, 0.26),
            mat_skin,
            "arm_R",
        )
        make_part(
            "hand_R",
            "sphere",
            (-0.28, 0.0, 0.79),
            (0.09, 0.07, 0.11),
            mat_skin,
            "arm_R",
        )

        # Left Leg: upper thigh, lower shin, foot (leg_L)
        make_part(
            "upper_leg_L",
            "cylinder",
            (0.12, 0.0, 0.65),
            (0.14, 0.14, 0.42),
            mat_pants,
            "leg_L",
        )
        make_part(
            "lower_leg_L",
            "cylinder",
            (0.12, 0.0, 0.27),
            (0.11, 0.11, 0.38),
            mat_pants,
            "leg_L",
        )
        make_part(
            "foot_L",
            "cube",
            (0.12, -0.05, 0.05),
            (0.12, 0.22, 0.09),
            mat_shoe,
            "leg_L",
        )

        # Right Leg: upper thigh, lower shin, foot (leg_R)
        make_part(
            "upper_leg_R",
            "cylinder",
            (-0.12, 0.0, 0.65),
            (0.14, 0.14, 0.42),
            mat_pants,
            "leg_R",
        )
        make_part(
            "lower_leg_R",
            "cylinder",
            (-0.12, 0.0, 0.27),
            (0.11, 0.11, 0.38),
            mat_pants,
            "leg_R",
        )
        make_part(
            "foot_R",
            "cube",
            (-0.12, -0.05, 0.05),
            (0.12, 0.22, 0.09),
            mat_shoe,
            "leg_R",
        )

    part_names = [o.name for o in created_meshes]

    # Join mesh parts into one unified skinned mesh (`npc_skinned_mesh`) so vertex groups drive a clean glTF skin
    bpy.ops.object.select_all(action="DESELECT")
    for o in created_meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = created_meshes[0]
    if len(created_meshes) > 1:
        bpy.ops.object.join()
    skinned_mesh = bpy.context.active_object
    skinned_mesh.name = f"npc_{preset}_mesh"
    skinned_mesh.data.name = f"npc_{preset}_mesh"
    bpy.ops.object.shade_smooth()
    skinned_mesh.data.use_auto_smooth = True
    skinned_mesh.data.auto_smooth_angle = math.radians(40)

    # Parent mesh to Armature with Armature modifier
    skinned_mesh.parent = arm_obj
    arm_mod = skinned_mesh.modifiers.new(name="Armature", type="ARMATURE")
    arm_mod.object = arm_obj
    arm_mod.use_vertex_groups = True

    # 3. Bake 3 NLA / Action animation clips (`Idle`, `Walk`, `Wave`) across frames 1..48 using sine/cosine curves
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 48

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    pose_bones = arm_obj.pose.bones
    for pb in pose_bones:
        pb.rotation_mode = "XYZ"

    if not arm_obj.animation_data:
        arm_obj.animation_data_create()

    sample_frames = list(range(1, 49, 2))
    if 48 not in sample_frames:
        sample_frames.append(48)

    def reset_pose():
        for pb in pose_bones:
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)

    def bake_clip(action_name: str, pose_fn):
        act = bpy.data.actions.new(name=action_name)
        act.use_fake_user = True
        arm_obj.animation_data.action = act
        for f in sample_frames:
            bpy.context.scene.frame_set(f)
            reset_pose()
            theta = ((f - 1) / 47.0) * 2.0 * math.pi
            pose_fn(theta)
            for bn in bone_names:
                pb = pose_bones[bn]
                pb.keyframe_insert(data_path="location", frame=f)
                pb.keyframe_insert(data_path="rotation_euler", frame=f)

        # Push action into an NLA track so Blender's glTF 2.0 exporter writes all 3 named animations
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = action_name
        strip = track.strips.new(action_name, 1, act)
        strip.name = action_name
        track.mute = False
        return act

    def pose_idle(theta: float):
        # Gentle breathing + subtle head look + relaxed arm sway
        pose_bones["root"].location = (0.0, 0.0, 0.015 * math.sin(theta))
        pose_bones["spine"].rotation_euler = (
            0.045 * math.sin(theta),
            0.0,
            0.025 * math.cos(theta),
        )
        pose_bones["head"].rotation_euler = (
            0.035 * math.cos(theta),
            0.0,
            0.08 * math.sin(theta),
        )
        pose_bones["arm_L"].rotation_euler = (
            0.06 * math.sin(theta),
            0.04 * (1.0 + math.cos(theta)),
            0.0,
        )
        pose_bones["arm_R"].rotation_euler = (
            -0.06 * math.sin(theta),
            -0.04 * (1.0 + math.cos(theta)),
            0.0,
        )

    def pose_walk(theta: float):
        # Full two-cycle stride over 48 frames (2 * theta)
        w = 2.0 * theta
        stride = 0.52 * math.sin(w)
        arm_swing = 0.44 * math.sin(w)
        bob = 0.035 * abs(math.cos(w))
        pose_bones["root"].location = (0.0, 0.0, bob)
        pose_bones["spine"].rotation_euler = (0.08, 0.04 * math.cos(w), -0.06 * math.sin(w))
        pose_bones["head"].rotation_euler = (-0.04, 0.0, 0.05 * math.sin(w))
        pose_bones["leg_L"].rotation_euler = (stride, 0.0, 0.0)
        pose_bones["leg_R"].rotation_euler = (-stride, 0.0, 0.0)
        pose_bones["arm_L"].rotation_euler = (-arm_swing, 0.05, 0.0)
        pose_bones["arm_R"].rotation_euler = (arm_swing, -0.05, 0.0)

    def pose_wave(theta: float):
        # Enthusiastic shopkeeper/NPC greeting wave with raised right arm
        w = 2.0 * theta
        pose_bones["root"].location = (0.0, 0.0, 0.018 * math.sin(theta))
        pose_bones["spine"].rotation_euler = (
            0.03 * math.sin(theta),
            0.06 * math.sin(theta),
            0.04,
        )
        pose_bones["head"].rotation_euler = (
            0.06 * math.sin(w),
            -0.05,
            0.10 * math.cos(theta),
        )
        # Raise right arm high and oscillate side-to-side
        pose_bones["arm_R"].rotation_euler = (
            0.25 * math.cos(w),
            -2.45 + 0.32 * math.sin(w),
            0.18 * math.sin(w),
        )
        pose_bones["arm_L"].rotation_euler = (0.08 * math.sin(theta), 0.06, 0.0)

    bake_clip("Idle", pose_idle)
    bake_clip("Walk", pose_walk)
    bake_clip("Wave", pose_wave)

    # Clear active action so NLA tracks control exported clips cleanly
    arm_obj.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_materials="EXPORT",
    )

    summary = {
        "preset": preset,
        "in": args.in_glb,
        "out": str(out_path),
        "bytes": out_path.stat().st_size if out_path.exists() else 0,
        "bones": bone_names,
        "animations": ["Idle", "Walk", "Wave"],
        "frameRange": [1, 48],
        "bodyParts": part_names,
        "totalVertices": len(skinned_mesh.data.vertices),
        "totalFaces": len(skinned_mesh.data.polygons),
    }
    print("BLENDER_AUTORIG_JSON:" + json.dumps(summary))


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
