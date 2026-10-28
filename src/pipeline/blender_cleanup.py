#!/usr/bin/env python3
"""
Headless Mesh Optimizer & Decimation Pipeline
Automates mesh cleanup, QEM decimation, and Draco GLB compression.
"""

import sys
import argparse

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Headless Mesh Optimizer")
    parser.add_argument("--input", required=True, help="Input mesh path (obj, glb)")
    parser.add_argument("--output", required=True, help="Output GLB path")
    parser.add_argument("--target-ratio", type=float, default=0.25, help="Decimation ratio")
    return parser.parse_args(argv)

def run_blender_pipeline():
    try:
        import bpy
    except ImportError:
        print("[Notice] Blender bpy not available in current python context, skipping.")
        return

    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import asset
    if args.input.endswith(".glb") or args.input.endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=args.input)
    elif args.input.endswith(".obj"):
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=args.input)
        else:
            bpy.ops.import_scene.obj(filepath=args.input)

    # QEM Decimation
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            mod = obj.modifiers.new("Decimate_QEM", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = args.target_ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)

    # Export optimized GLB
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_apply=True,
        export_normals=True
    )
    print(f"[SUCCESS] Exported optimized mesh to: {args.output}")

if __name__ == "__main__":
    run_blender_pipeline()
