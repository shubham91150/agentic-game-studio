#!/usr/bin/env python3
"""Mesh cleanup for SAM 3D / generated meshes -> game-ready .glb (TOOL ONLY).

Runs headless inside Blender:

    PYTHONPATH=/home/opencode/.local/lib/python3.11/site-packages \
    blender --background --python src/tools/blender_cleanup.py -- \
        --in storage/.uploads/drone.glb --out /tmp/drone_clean.glb \
        [--ratio 0.5] [--scale 1.0]

Steps (own code + Blender tool, zero ML weights):
- import .glb;
- decimate all meshes (COLLAPSE modifier, ratio default 0.5);
- merge doubles by small distance + delete loose verts/edges/faces;
- apply rotation/scale transforms, normalize root scale;
- export to glTF binary (.glb).
"""

from __future__ import annotations

import argparse
import os
import sys


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    ap = argparse.ArgumentParser(description="Blender mesh cleanup to glb")
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ratio", type=float, default=0.5)
    ap.add_argument("--scale", type=float, default=1.0)
    return ap.parse_args(argv)


def main() -> None:
    import bmesh
    import bpy

    args = parse_args()
    ratio = min(1.0, max(0.01, args.ratio))
    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out)

    # Clean scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    print("scene cleared")

    bpy.ops.import_scene.gltf(filepath=src)
    print("glb imported")

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print("meshes collected")

    # Decimate (COLLAPSE) each mesh.
    if ratio < 1.0:
        for obj in meshes:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="OBJECT")
            mod = obj.modifiers.new("CleanupDecimate", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = ratio
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:
                obj.modifiers.remove(mod)
        print("decimate applied")
    else:
        print("decimate skipped")

    # Merge doubles + delete loose geometry via bmesh (context-free).
    for obj in meshes:
        me = obj.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
        loose_verts = [v for v in bm.verts if not v.link_faces]
        if loose_verts:
            bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")
        loose_edges = [e for e in bm.edges if not e.link_faces]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")
        bm.to_mesh(me)
        bm.free()
        me.update()
    print("doubles merged and loose geometry removed")

    # Normalize root scale, then apply rotation + scale on all meshes.
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.scale.x *= args.scale
            obj.scale.y *= args.scale
            obj.scale.z *= args.scale
    print("root scale normalized")
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.transform_apply(rotation=True, scale=True)
    print("transforms applied")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=False,
    )
    print("glb exported")
    print("note: TOOL ONLY - not part of shipped Meta-models path")


main()
