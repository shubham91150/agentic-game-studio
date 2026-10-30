#!/usr/bin/env python3
"""Novel-view warp (own code, zero ML -- TOOL ONLY, not shipped Meta path).

Forward-warps an image horizontally by disparity derived from a depth PNG
(brighter = nearer, as produced by src/tools/depth_map.py), then fills
disocclusion holes (cv2 Telea inpaint if opencv is installed, else a
PIL blur-fill fallback).

Usage:
    python3 src/tools/novel_view.py --image storage/.uploads/sunrise_valley.jpg \
        --depth /tmp/depth.png --px 24 --out /tmp/novel.png
"""

from __future__ import annotations

import argparse
import time

import numpy as np
from PIL import Image, ImageFilter


def warp(image: Image.Image, near: np.ndarray, px: float) -> tuple[np.ndarray, np.ndarray]:
    """Forward warp. Returns (warped_rgb float array, filled bool mask)."""
    img = np.asarray(image, dtype=np.float32)
    h, w, _ = img.shape
    disp = (near * px).round().astype(np.int32)  # near in [0,1]
    xs = np.tile(np.arange(w, dtype=np.int32)[None, :], (h, 1))
    dest_x = np.clip(xs - disp, 0, w - 1)
    flat_dest = (np.arange(h, dtype=np.int64)[:, None] * w + dest_x).ravel()
    flat_disp = disp.ravel().astype(np.float32)
    order = np.argsort(flat_disp, kind="stable")  # nearest (largest disp) applied last -> wins
    warped = np.zeros((h * w, 3), dtype=np.float32)
    filled = np.zeros(h * w, dtype=bool)
    warped[flat_dest[order]] = img.reshape(-1, 3)[order]
    filled[flat_dest[order]] = True
    return warped.reshape(h, w, 3), filled.reshape(h, w)


def fill_holes(warped: np.ndarray, filled: np.ndarray) -> tuple[np.ndarray, str]:
    hole = ~filled
    if not hole.any():
        return warped, "none (no holes)"
    try:
        import cv2  # type: ignore

        mask = hole.astype(np.uint8) * 255
        out = cv2.inpaint(warped.astype(np.uint8), mask, 3, cv2.INPAINT_TELEA)
        return out.astype(np.float32), "cv2-telea"
    except Exception:
        blur = np.asarray(
            Image.fromarray(warped.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
        ).astype(np.float32)
        out = warped.copy()
        out[hole] = blur[hole]
        return out, "pil-blur-fallback"


def main() -> None:
    ap = argparse.ArgumentParser(description="Depth-based novel view warp (zero ML)")
    ap.add_argument("--image", required=True)
    ap.add_argument("--depth", required=True, help="grayscale depth PNG, brighter = nearer")
    ap.add_argument("--px", type=float, default=24.0, help="max horizontal shift in px")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    t0 = time.time()
    depth = Image.open(args.depth).convert("L")
    img = Image.open(args.image).convert("RGB").resize(depth.size, Image.LANCZOS)
    near = np.asarray(depth, dtype=np.float32) / 255.0
    warped, filled = warp(img, near, args.px)
    filled_img, method = fill_holes(warped, filled)
    Image.fromarray(np.clip(filled_img, 0, 255).astype(np.uint8)).save(args.out)
    t1 = time.time()

    hole_frac = 100.0 * float((~filled).sum()) / filled.size
    print(f"input_size: {img.size[0]}x{img.size[1]}")
    print(f"px: {args.px}")
    print(f"hole_frac_pct: {hole_frac:.2f}")
    print(f"fill_method: {method}")
    print(f"same_size: True")
    print(f"warp_s: {t1 - t0:.1f}")
    print(f"out: {args.out}")
    print("note: TOOL ONLY - not part of shipped Meta-models path")


if __name__ == "__main__":
    main()
