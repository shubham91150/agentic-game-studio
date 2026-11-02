#!/usr/bin/env python3
"""
2D Image + Depth Anything V2 -> 3D Gaussian Splatting (.splat / .ply) Converter
(src/tools/depth_to_gaussian_splat.py)

Chat requirement:
  "Depth Anything + Gaussian Splatting -> Full 3D World (.splat) -> Three.js/Unity"

Back-projects 2D RGB image pixels using a Depth Anything V2 monocular depth map
(or automatically runs Depth Anything V2 if `--depth` does not exist yet) into
metric 3D world space `(x, y, z)`, estimates local anisotropic surface scale
`(sx, sy, sz)` and surface normal rotation quaternion `(qx, qy, qz, qw)` from
local depth gradients, and packs RGB color + opacity into:
  - Standard 32-byte `.splat` binary format:
      position: float32 x 3 (12 bytes)
      scale:    float32 x 3 (12 bytes)
      color:    uint8 x 4   (4 bytes: R, G, B, A)
      rot:      uint8 x 4   (4 bytes: qw, qx, qy, qz encoded as (q * 128 + 128))
  - Optional standard 3DGS `.ply` format (`--ply scene.ply`).

Usage:
  python3 src/tools/depth_to_gaussian_splat.py \
      --image storage/.uploads/sunrise_valley.jpg \
      --depth /tmp/opencode/sunrise_depth.png \
      --out public/assets/custom/sunrise_valley.splat \
      [--ply public/assets/custom/sunrise_valley.ply] \
      [--max-splats 40000]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def ensure_depth_map(image_path: Path, depth_path: Path | None) -> Image.Image:
    if depth_path and depth_path.exists():
        return Image.open(depth_path).convert("L")

    # Automatically compute depth map via Depth Anything V2 helper if missing
    from depth_map import load_image, run_depth, to_nearer_brighter

    img = load_image(str(image_path), max_side=512)
    raw_depth = run_depth(img)
    depth_u8 = to_nearer_brighter(raw_depth)
    depth_img = Image.fromarray(depth_u8, mode="L")
    if depth_path:
        depth_path.parent.mkdir(parents=True, exist_ok=True)
        depth_img.save(depth_path)
    return depth_img


def normals_to_quaternions(normals: np.ndarray) -> np.ndarray:
    """
    Vectorized conversion of unit surface normals (N, 3) to unit quaternions
    (qw, qx, qy, qz) rotating local +Z (0, 0, 1) onto n = (nx, ny, nz).
    """
    nx = normals[:, 0]
    ny = normals[:, 1]
    nz = normals[:, 2]

    # q = [1 + dot(z, n), cross(z, n)] = [1 + nz, -ny, nx, 0]
    qw = 1.0 + nz
    qx = -ny
    qy = nx
    qz = np.zeros_like(nz)

    norm = np.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    anti = norm < 1e-5
    qw = np.where(anti, 0.0, qw)
    qx = np.where(anti, 1.0, qx)
    qy = np.where(anti, 0.0, qy)
    qz = np.where(anti, 0.0, qz)
    norm = np.where(anti, 1.0, norm)

    quat = np.stack([qw / norm, qx / norm, qy / norm, qz / norm], axis=-1)
    return quat.astype(np.float32)


def write_splat_binary(
    out_path: Path,
    positions: np.ndarray,
    scales: np.ndarray,
    rgba: np.ndarray,
    quats: np.ndarray,
) -> int:
    """
    Writes standard 32-byte per-splat binary buffer:
      - float32[3] position (x, y, z)
      - float32[3] scale    (sx, sy, sz)
      - uint8[4]   color    (r, g, b, a)
      - uint8[4]   rot      (qw, qx, qy, qz mapped via clip(q*128 + 128, 0, 255))
    """
    n = positions.shape[0]
    splat_dtype = np.dtype(
        [
            ("pos", "<f4", (3,)),
            ("scale", "<f4", (3,)),
            ("color", "u1", (4,)),
            ("rot", "u1", (4,)),
        ]
    )
    assert splat_dtype.itemsize == 32
    buf = np.empty(n, dtype=splat_dtype)
    buf["pos"] = positions.astype(np.float32)
    buf["scale"] = scales.astype(np.float32)
    buf["color"] = np.clip(rgba, 0, 255).astype(np.uint8)
    rot_u8 = np.clip(np.rint(quats * 128.0 + 128.0), 0, 255).astype(np.uint8)
    buf["rot"] = rot_u8

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(buf.tobytes())
    return out_path.stat().st_size


def write_3dgs_ply(
    ply_path: Path,
    positions: np.ndarray,
    scales: np.ndarray,
    normals: np.ndarray,
    rgba: np.ndarray,
    quats: np.ndarray,
) -> int:
    """Writes a standard 3D Gaussian Splatting binary little-endian .ply file."""
    n = positions.shape[0]
    C0 = 0.28209479177387814
    rgb_f = rgba[:, :3].astype(np.float32) / 255.0
    f_dc = (rgb_f - 0.5) / C0
    alpha_f = np.clip(rgba[:, 3].astype(np.float32) / 255.0, 1e-3, 1.0 - 1e-3)
    opacity_logit = np.log(alpha_f / (1.0 - alpha_f)).astype(np.float32)
    log_scale = np.log(np.maximum(scales, 1e-5)).astype(np.float32)

    ply_dtype = np.dtype(
        [
            ("x", "<f4"),
            ("y", "<f4"),
            ("z", "<f4"),
            ("nx", "<f4"),
            ("ny", "<f4"),
            ("nz", "<f4"),
            ("f_dc_0", "<f4"),
            ("f_dc_1", "<f4"),
            ("f_dc_2", "<f4"),
            ("opacity", "<f4"),
            ("scale_0", "<f4"),
            ("scale_1", "<f4"),
            ("scale_2", "<f4"),
            ("rot_0", "<f4"),
            ("rot_1", "<f4"),
            ("rot_2", "<f4"),
            ("rot_3", "<f4"),
        ]
    )
    arr = np.empty(n, dtype=ply_dtype)
    arr["x"], arr["y"], arr["z"] = positions[:, 0], positions[:, 1], positions[:, 2]
    arr["nx"], arr["ny"], arr["nz"] = normals[:, 0], normals[:, 1], normals[:, 2]
    arr["f_dc_0"], arr["f_dc_1"], arr["f_dc_2"] = f_dc[:, 0], f_dc[:, 1], f_dc[:, 2]
    arr["opacity"] = opacity_logit
    arr["scale_0"], arr["scale_1"], arr["scale_2"] = (
        log_scale[:, 0],
        log_scale[:, 1],
        log_scale[:, 2],
    )
    arr["rot_0"], arr["rot_1"], arr["rot_2"], arr["rot_3"] = (
        quats[:, 0],
        quats[:, 1],
        quats[:, 2],
        quats[:, 3],
    )

    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {n}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property float nx\n"
        "property float ny\n"
        "property float nz\n"
        "property float f_dc_0\n"
        "property float f_dc_1\n"
        "property float f_dc_2\n"
        "property float opacity\n"
        "property float scale_0\n"
        "property float scale_1\n"
        "property float scale_2\n"
        "property float rot_0\n"
        "property float rot_1\n"
        "property float rot_2\n"
        "property float rot_3\n"
        "end_header\n"
    ).encode("ascii")

    ply_path.parent.mkdir(parents=True, exist_ok=True)
    with open(ply_path, "wb") as f:
        f.write(header)
        f.write(arr.tobytes())
    return ply_path.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert 2D image + Depth Anything V2 depth map into 3D Gaussian Splatting (.splat / .ply)."
    )
    parser.add_argument("--image", required=True, help="Input RGB image (.jpg/.png)")
    parser.add_argument(
        "--depth",
        required=True,
        help="Input depth map (.png, brighter=nearer). Auto-generated if missing.",
    )
    parser.add_argument("--out", required=True, help="Output 32-byte .splat binary path")
    parser.add_argument("--ply", default=None, help="Optional output 3DGS .ply path")
    parser.add_argument(
        "--max-splats",
        type=int,
        default=40000,
        help="Maximum number of 3D Gaussian splats to emit (default: 40000)",
    )
    parser.add_argument(
        "--scene-width",
        type=float,
        default=48.0,
        help="Horizontal world span in meters (default: 48.0)",
    )
    parser.add_argument(
        "--depth-range",
        type=float,
        default=36.0,
        help="Depth relief span in meters (default: 36.0)",
    )
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    depth_path = Path(args.depth).resolve() if args.depth else None
    out_path = Path(args.out).resolve()
    ply_path = Path(args.ply).resolve() if args.ply else None

    rgb_orig = Image.open(image_path).convert("RGB")
    depth_orig = ensure_depth_map(image_path, depth_path)

    orig_w, orig_h = rgb_orig.size
    aspect = orig_w / max(1.0, float(orig_h))
    max_splats = max(1000, int(args.max_splats))

    # Choose sampling grid dimensions (grid_w * grid_h <= max_splats)
    grid_h = int(math.floor(math.sqrt(max_splats / aspect)))
    grid_w = int(math.floor(max_splats / max(1, grid_h)))
    while grid_w * grid_h > max_splats:
        if grid_w >= grid_h:
            grid_w -= 1
        else:
            grid_h -= 1

    rgb_img = rgb_orig.resize((grid_w, grid_h), Image.LANCZOS)
    depth_img = depth_orig.resize((grid_w, grid_h), Image.BILINEAR)

    rgb_arr = np.asarray(rgb_img, dtype=np.uint8)  # (H, W, 3)
    disp = np.asarray(depth_img, dtype=np.float32) / 255.0  # (H, W) in [0, 1], 1=near, 0=far

    # Perspective back-projection into 3D space (x, y, z)
    # Nearer pixels (disp -> 1.0) sit closer to camera; farther pixels (disp -> 0.0) sit deeper in -Z
    z_near = 6.0
    z_depth = z_near + (1.0 - disp) * float(args.depth_range)  # positive distance [6 .. 42]

    u_grid, v_grid = np.meshgrid(
        np.linspace(-0.5, 0.5, grid_w, dtype=np.float32),
        np.linspace(0.5, -0.5, grid_h, dtype=np.float32),
    )

    fov_scale = float(args.scene_width) / (z_near + 0.45 * float(args.depth_range))
    x_world = u_grid * z_depth * fov_scale
    y_world = (v_grid / aspect) * z_depth * fov_scale
    # Shift Y so lowest foreground point rests at y = 0, and center Z around origin
    y_world = y_world - float(np.min(y_world))
    z_world = -(z_depth - float(np.mean(z_depth)))

    # Estimate local surface normals & anisotropic scale from depth gradients
    dz_dy, dz_dx = np.gradient(z_world)
    dx_step = max(1e-3, float(args.scene_width) / grid_w)
    dy_step = max(1e-3, (float(args.scene_width) / aspect) / grid_h)

    nx = -dz_dx / dx_step
    ny = -dz_dy / dy_step
    nz = np.ones_like(z_world)
    n_len = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    normals_grid = np.stack([nx / n_len, ny / n_len, nz / n_len], axis=-1)

    grad_mag = np.sqrt(dz_dx * dz_dx + dz_dy * dz_dy)
    pixel_footprint = (z_depth * fov_scale / grid_w) * 1.35
    sx = pixel_footprint * (1.0 + np.clip(np.abs(dz_dx), 0.0, 1.5) * 0.45)
    sy = pixel_footprint * (1.0 + np.clip(np.abs(dz_dy), 0.0, 1.5) * 0.45)
    sz = pixel_footprint * 0.35

    # Opacity attenuation across steep depth discontinuities to avoid flying-pixel curtains
    edge_penalty = np.clip(1.0 - (grad_mag / 2.2), 0.35, 1.0)
    alpha_u8 = np.clip(np.rint(edge_penalty * 248.0), 64, 255).astype(np.uint8)

    # Sort back-to-front by Z for clean alpha blending in Three.js
    positions = np.stack([x_world, y_world, z_world], axis=-1).reshape(-1, 3)
    scales = np.stack([sx, sy, sz], axis=-1).reshape(-1, 3)
    normals = normals_grid.reshape(-1, 3)
    quats = normals_to_quaternions(normals)
    rgba = np.concatenate(
        [rgb_arr.reshape(-1, 3), alpha_u8.reshape(-1, 1)], axis=-1
    )

    sort_idx = np.argsort(positions[:, 2])  # ascending Z (farthest negative Z first)
    positions = positions[sort_idx]
    scales = scales[sort_idx]
    normals = normals[sort_idx]
    quats = quats[sort_idx]
    rgba = rgba[sort_idx]

    splat_bytes = write_splat_binary(out_path, positions, scales, rgba, quats)
    ply_bytes = 0
    if ply_path:
        ply_bytes = write_3dgs_ply(ply_path, positions, scales, normals, rgba, quats)

    summary = {
        "image": str(image_path),
        "depth": str(depth_path) if depth_path else None,
        "out": str(out_path),
        "splatCount": int(positions.shape[0]),
        "bytesPerSplat": 32,
        "splatBytes": int(splat_bytes),
        "gridResolution": f"{grid_w}x{grid_h}",
        "bounds": {
            "min": [round(float(v), 3) for v in positions.min(axis=0)],
            "max": [round(float(v), 3) for v in positions.max(axis=0)],
        },
    }
    if ply_path:
        summary["plyOut"] = str(ply_path)
        summary["plyBytes"] = int(ply_bytes)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
