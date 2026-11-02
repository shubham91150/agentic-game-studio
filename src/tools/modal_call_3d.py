#!/usr/bin/env python3
"""Call a deployed Meta 3D Modal backend (SAM 3D Objects or Meta VGGT-1B) and save the GLB locally.

Usage:
  python3 src/tools/modal_call_3d.py --backend sam3d --image in.png --mask mask.png --out out.glb
  python3 src/tools/modal_call_3d.py --backend vggt --image in.png --out out.glb

Backends (100% Meta open-weight models):
  sam3d = Meta SAM 3D Objects (facebook/sam-3d-objects)
  vggt  = Meta VGGT-1B (facebook/VGGT-1B)
"""
import argparse
import os
import sys

import modal

BACKENDS = {
    "sam3d": ("spurcode-sam3d-objects", "SAM3DObjects", "reconstruct"),
    "vggt": ("spurcode-meta-vggt", "MetaVGGT", "reconstruct_glb"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="sam3d", choices=list(BACKENDS))
    ap.add_argument("--image", required=True)
    ap.add_argument("--mask", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    app_name, cls_name, method_name = BACKENDS[args.backend]
    with open(args.image, "rb") as f:
        image_bytes = f.read()
    mask_bytes = None
    if args.mask:
        with open(args.mask, "rb") as f:
            mask_bytes = f.read()

    cls = modal.Cls.from_name(app_name, cls_name)
    obj = cls()
    method = getattr(obj, method_name)
    if args.backend == "sam3d":
        glb = method.remote(image_bytes, mask_bytes)
    else:
        glb = method.remote(image_bytes)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(glb)
    print(f"[{args.backend}] saved {args.out} ({len(glb)} bytes)")


if __name__ == "__main__":
    sys.exit(main())
