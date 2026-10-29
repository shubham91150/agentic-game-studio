#!/usr/bin/env python3
"""Call a deployed Modal image-to-3D backend and save the GLB locally.

Usage:
  python3 src/tools/modal_call_3d.py --backend trellis --image in.png --out out.glb
  python3 src/tools/modal_call_3d.py --backend sam3d --image in.png --mask mask.png --out out.glb

Backends:
  trellis = Microsoft TRELLIS (dev/testing only, NOT hackathon-compliant)
  sam3d   = Meta SAM 3D Objects (hackathon submission backend)
"""
import argparse
import os
import sys

import modal

BACKENDS = {
    "trellis": (
        "spurcode-microsoft-trellis-pipeline",
        "MicrosoftTrellisGenerator",
        "generate_3d_glb",
    ),
    "sam3d": ("spurcode-sam3d-objects", "SAM3DObjects", "reconstruct"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True, choices=list(BACKENDS))
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
