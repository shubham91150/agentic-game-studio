#!/usr/bin/env python3
"""Monocular depth map (CPU tool, NOT part of shipped Meta-models path).

Uses Depth Anything V2 SMALLEST HF checkpoint (MIT-licensed tool weights,
local geometry helper only -- never in the hackathon submission path).

Usage:
    python3 src/tools/depth_map.py --image storage/.uploads/sunrise_valley.jpg \
        --out /tmp/depth.png [--npy /tmp/depth.npy] [--max-side 768]

Notes:
- VM has no GPU: input is downscaled so the longest side <= --max-side.
- Output PNG: uint8, brighter = nearer (inverted relative depth normalized).
- Optional --npy saves raw float32 relative-depth array (model output units).
"""

from __future__ import annotations

import argparse
import time

import numpy as np
from PIL import Image

MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"


def load_image(path: str, max_side: int) -> Image.Image:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    s = max(w, h)
    if s > max_side:
        scale = max_side / s
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return img


def run_depth(img: Image.Image) -> np.ndarray:
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    import torch

    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForDepthEstimation.from_pretrained(MODEL_ID)
    model.eval()
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    pred = outputs.predicted_depth.squeeze().cpu().numpy().astype(np.float32)
    # Resize back to input size (model output is lower-res).
    depth_img = Image.fromarray(pred).resize(img.size, Image.BICUBIC)
    return np.asarray(depth_img, dtype=np.float32)


def to_nearer_brighter(depth: np.ndarray) -> np.ndarray:
    # Depth-Anything V2 HF predicted_depth is disparity-like: larger = nearer.
    # Normalize so brighter = nearer, no inversion.
    dmin, dmax = float(depth.min()), float(depth.max())
    if dmax - dmin < 1e-9:
        return np.full(depth.shape, 128, dtype=np.uint8)
    norm = (depth - dmin) / (dmax - dmin)
    return (norm * 255.0 + 0.5).astype(np.uint8)


def sanity_stats(arr: np.ndarray) -> dict:
    h, w = arr.shape
    center = arr[h // 3 : 2 * h // 3, w // 3 : 2 * w // 3]
    sky = arr[0 : h // 5, :]  # top band ~ sky
    fg = arr[4 * h // 5 :, :]  # bottom band ~ foreground ground
    return {
        "mean_all": float(arr.mean()),
        "mean_center": float(center.mean()),
        "mean_sky": float(sky.mean()),
        "mean_fg": float(fg.mean()),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Depth Anything V2 (small, CPU) depth map tool")
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--npy", default=None, help="optional path to save raw float32 depth")
    ap.add_argument("--max-side", type=int, default=768)
    args = ap.parse_args()

    t0 = time.time()
    img = load_image(args.image, args.max_side)
    t1 = time.time()
    depth = run_depth(img)
    t2 = time.time()
    out = to_nearer_brighter(depth)
    Image.fromarray(out).save(args.out)
    if args.npy:
        np.save(args.npy, depth)
    t3 = time.time()

    px = to_nearer_brighter(depth)
    stats = sanity_stats(px)
    print(f"model: {MODEL_ID}")
    print(f"input_size: {img.size[0]}x{img.size[1]}")
    print(f"load_resize_s: {t1 - t0:.1f}")
    print(f"infer_s: {t2 - t1:.1f}")
    print(f"save_s: {t3 - t2:.1f}")
    print(f"total_s: {t3 - t0:.1f}")
    print(f"out: {args.out} ({out.shape[1]}x{out.shape[0]})")
    print(f"mean_all: {stats['mean_all']:.1f}")
    print(f"mean_center: {stats['mean_center']:.1f}")
    print(f"mean_sky: {stats['mean_sky']:.1f}")
    print(f"mean_fg: {stats['mean_fg']:.1f}")
    print(f"sanity_fg_brighter_than_sky: {stats['mean_fg'] > stats['mean_sky']}")
    print("note: TOOL ONLY - not part of shipped Meta-models path")


if __name__ == "__main__":
    main()
