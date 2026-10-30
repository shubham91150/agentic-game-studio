#!/usr/bin/env python3
"""Depth-displaced plane + texture projection -> .glb (TOOL ONLY, not shipped Meta path).

Runs headless inside Blender (needs PIL/numpy visible to Blender's Python):

    PYTHONPATH=/home/opencode/.local/lib/python3.11/site-packages \
    blender --background --python src/tools/blender_project.py -- \
        --image storage/.uploads/sunrise_valley.jpg \
        --depth /tmp/depth.png --out /tmp/scene.glb [--grid 191x127] [--strength 0.35]

Method (own code + Blender tool, zero ML weights):
- subdivided plane sized to image aspect, vertices displaced along Z by
  normalized depth (brighter = nearer -> higher), sampled with PIL;
- original image applied as base-color texture via default plane UVs;
- exported to glTF binary (.glb).
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
    ap = argparse.ArgumentParser(description="Blender depth-projection to glb")
    ap.add_argument("--image", required=True)
    ap.add_argument("--depth", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--grid", default="191x127")
    ap.add_argument("--strength", type=float, default=0.35)
    return ap.parse_args(argv)


def main() -> None:
    import bpy  # noqa: F401  # provided by Blender
    from mathutils import Vector  # noqa: F401

    args = parse_args()
    gw, gh = (int(v) for v in args.grid.lower().split("x"))

    from PIL import Image

    img = Image.open(args.image).convert("RGB")
    depth = Image.open(args.depth).convert("L").resize((gw + 1, gh + 1), Image.BICUBIC)
    import numpy as np

    near = np.asarray(depth, dtype=np.float32) / 255.0
    aspect = img.size[0] / img.size[1]

    # Clean scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Plane with (gw x gh) quads.
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    plane = bpy.context.active_object
    # Scale x by aspect so texture is undistorted.
    plane.scale.x = aspect
    bpy.ops.object.transform_apply(scale=True)
    # Subdivide: plane starts as 1 quad; each cut doubles resolution per axis.
    import math

    def cuts(n: int) -> int:
        return math.ceil(math.log2(n)) if n > 1 else 0

    for _ in range(cuts(gw)):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.subdivide(number_cuts=1)
        bpy.ops.object.mode_set(mode="OBJECT")

    mesh = plane.data
    # After subdivision the grid may exceed target; displace by nearest depth sample.
    # Map vertex (x,y) in [-aspect,aspect]x[-1,1] to depth pixel.
    for v in mesh.vertices:
        u = (v.co.x / aspect + 1.0) / 2.0
        vv = (v.co.y + 1.0) / 2.0
        ix = min(gw, max(0, round(u * gw)))
        iy = min(gh, max(0, round((1.0 - vv) * gh)))
        v.co.z = float(near[iy, ix]) * args.strength

    # Material with projected image texture.
    mat = bpy.data.materials.new("Projected")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.abspath(args.image))
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(mat)

    # Default plane UVs already span 0..1; ensure a UV layer exists.
    if not mesh.uv_layers:
        mesh.uv_layers.new()

    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(args.out),
        export_format="GLB",
        use_selection=False,
    )
    print(f"out: {args.out}")
    print("note: TOOL ONLY - not part of shipped Meta-models path")


main()
