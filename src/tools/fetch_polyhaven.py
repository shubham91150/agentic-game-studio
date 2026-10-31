#!/usr/bin/env python3
"""
Polyhaven CC0 Asset Fetcher (src/tools/fetch_polyhaven.py)

Queries the official free Polyhaven CC0 API (https://api.polyhaven.com/files/<asset_id>)
and downloads:
  - 1K .glb model (repacks .gltf + .bin + 1k textures into a self-contained .glb, plus keeps raw files)
  - 1K .hdr sky / environment map
  - 1K PBR texture set (diff, nor_gl, arm)

Saves all downloaded files into:
  public/assets/polyhaven/<asset_id>/

Usage:
  python3 src/tools/fetch_polyhaven.py <asset_id> [--type auto|model|hdr|textures] [--res 1k]
  python3 src/tools/fetch_polyhaven.py boulder_01 --type model
  python3 src/tools/fetch_polyhaven.py aerial_rocks_02 --type textures
  python3 src/tools/fetch_polyhaven.py kloppenheim_06_puresky --type hdr
"""

import argparse
import json
import os
import struct
import sys
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
POLYHAVEN_OUT_DIR = ROOT_DIR / "public" / "assets" / "polyhaven"
USER_AGENT = "AgenticGameStudio/1.0 (https://polyhaven.com)"


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_file(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def pack_gltf_to_glb(gltf_path: Path, glb_path: Path) -> int:
    """
    Packs a Polyhaven .gltf + external .bin + external .jpg/.png textures
    into a single self-contained binary .glb file.
    """
    gltf_dir = gltf_path.parent
    gltf = json.loads(gltf_path.read_text(encoding="utf-8"))

    bin_chunks = bytearray()

    def append_to_bin(raw_bytes: bytes) -> tuple[int, int]:
        # Align start to 4 bytes
        pad = (4 - (len(bin_chunks) % 4)) % 4
        if pad:
            bin_chunks.extend(b"\x00" * pad)
        offset = len(bin_chunks)
        bin_chunks.extend(raw_bytes)
        return offset, len(raw_bytes)

    # 1. Load existing buffer(s)
    buffers = gltf.get("buffers", [])
    for buf in buffers:
        uri = buf.get("uri")
        if uri and not uri.startswith("data:"):
            bin_file = gltf_dir / uri
            if bin_file.exists():
                raw = bin_file.read_bytes()
                append_to_bin(raw)
            buf.pop("uri", None)

    buffer_views = gltf.get("bufferViews", [])

    # 2. Embed external images into bufferViews so the .glb is 100% self-contained
    for img in gltf.get("images", []):
        uri = img.get("uri")
        if uri and not uri.startswith("data:"):
            img_file = gltf_dir / uri
            if img_file.exists():
                raw_img = img_file.read_bytes()
                offset, length = append_to_bin(raw_img)
                bv_idx = len(buffer_views)
                buffer_views.append(
                    {
                        "buffer": 0,
                        "byteOffset": offset,
                        "byteLength": length,
                    }
                )
                img.pop("uri", None)
                img["bufferView"] = bv_idx
                ext = img_file.suffix.lower()
                img["mimeType"] = (
                    "image/png" if ext == ".png" else "image/jpeg"
                )

    for mat in gltf.get("materials", []):
        if "alpha" in mat.get("name", "").lower() or "leaves" in mat.get("name", "").lower():
            if mat.get("alphaMode") == "BLEND":
                mat["alphaMode"] = "MASK"
                mat["alphaCutoff"] = 0.5

    gltf["bufferViews"] = buffer_views
    if buffers:
        buffers[0]["byteLength"] = len(bin_chunks)
    else:
        gltf["buffers"] = [{"byteLength": len(bin_chunks)}]

    # Pad binary chunk to 4-byte boundary
    bin_pad = (4 - (len(bin_chunks) % 4)) % 4
    if bin_pad:
        bin_chunks.extend(b"\x00" * bin_pad)

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    if json_pad:
        json_bytes += b" " * json_pad

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_chunks)

    with open(glb_path, "wb") as f:
        # GLB Header: magic 'glTF', version 2, total_len
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        # Chunk 0: JSON (0x4E4F534A)
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        # Chunk 1: BIN (0x004E4942)
        f.write(struct.pack("<II", len(bin_chunks), 0x004E4942))
        f.write(bin_chunks)

    return total_len


def fetch_polyhaven_asset(
    asset_id: str, asset_type: str = "auto", res: str = "1k"
) -> dict:
    api_url = f"https://api.polyhaven.com/files/{asset_id}"
    data = fetch_json(api_url)
    out_dir = POLYHAVEN_OUT_DIR / asset_id
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded = []

    # Auto-detect asset type if requested
    if asset_type == "auto":
        if "hdri" in data:
            asset_type = "hdr"
        elif "gltf" in data and ("fbx" in data or "usd" in data):
            asset_type = "model"
        elif "Diffuse" in data or "nor_gl" in data or "arm" in data:
            asset_type = "textures"
        elif "gltf" in data:
            asset_type = "model"
        else:
            raise ValueError("Unable to auto-detect Polyhaven asset type")

    if asset_type == "hdr":
        hdri_res = data.get("hdri", {}).get(res, {})
        hdr_info = hdri_res.get("hdr") or hdri_res.get("exr")
        if not hdr_info or "url" not in hdr_info:
            raise ValueError("Requested resolution HDR not found")
        ext = ".hdr" if "hdr" in hdri_res else ".exr"
        dest = out_dir / f"{asset_id}_{res}{ext}"
        sz = download_file(hdr_info["url"], dest)
        downloaded.append(
            {
                "file": dest.name,
                "url": f"/studio/assets/polyhaven/{asset_id}/{dest.name}",
                "bytes": sz,
            }
        )

    elif asset_type == "textures":
        tex_map = {
            "diff": ["Diffuse", "col", "diff"],
            "nor_gl": ["nor_gl"],
            "arm": ["arm"],
        }
        for short_name, keys in tex_map.items():
            entry = None
            for k in keys:
                if k in data and res in data[k]:
                    entry = data[k][res]
                    break
            if not entry:
                continue
            fmt_info = entry.get("jpg") or entry.get("png")
            if not fmt_info or "url" not in fmt_info:
                continue
            ext = ".jpg" if "jpg" in entry else ".png"
            dest = out_dir / f"{asset_id}_{short_name}_{res}{ext}"
            sz = download_file(fmt_info["url"], dest)
            downloaded.append(
                {
                    "map": short_name,
                    "file": dest.name,
                    "url": f"/studio/assets/polyhaven/{asset_id}/{dest.name}",
                    "bytes": sz,
                }
            )

    elif asset_type == "model":
        gltf_res = data.get("gltf", {}).get(res, {})
        glb_info = gltf_res.get("glb")
        if glb_info and "url" in glb_info:
            dest = out_dir / f"{asset_id}_{res}.glb"
            sz = download_file(glb_info["url"], dest)
            downloaded.append(
                {
                    "file": dest.name,
                    "url": f"/studio/assets/polyhaven/{asset_id}/{dest.name}",
                    "bytes": sz,
                }
            )
        else:
            gltf_info = gltf_res.get("gltf")
            if not gltf_info or "url" not in gltf_info:
                raise ValueError("No glTF or GLB found for asset")
            gltf_path = out_dir / f"{asset_id}_{res}.gltf"
            download_file(gltf_info["url"], gltf_path)
            includes = gltf_info.get("include", {})
            for rel_path, inc_meta in includes.items():
                inc_dest = out_dir / rel_path
                download_file(inc_meta["url"], inc_dest)

            # Bake alpha maps into PNG diffuse textures for MASK/BLEND materials
            try:
                from PIL import Image
                gltf_obj = json.loads(gltf_path.read_text(encoding="utf-8"))
                changed_gltf = False
                for alpha_key in [k for k in data.keys() if k.lower().endswith("alpha")]:
                    alpha_res = data.get(alpha_key, {}).get(res, {})
                    alpha_info = alpha_res.get("jpg") or alpha_res.get("png")
                    if not alpha_info or "url" not in alpha_info:
                        continue
                    alpha_tmp = out_dir / "textures" / f"_tmp_{alpha_key}.jpg"
                    download_file(alpha_info["url"], alpha_tmp)
                    prefix = alpha_key[:-5].rstrip("_")  # e.g. 'leaves' or ''
                    for img_entry in gltf_obj.get("images", []):
                        uri = img_entry.get("uri", "")
                        if "diff" in uri and (not prefix or prefix in uri):
                            diff_file = out_dir / uri
                            if diff_file.exists():
                                rgb = Image.open(diff_file).convert("RGB")
                                a = Image.open(alpha_tmp).convert("L").resize(rgb.size)
                                rgb.putalpha(a)
                                png_rel = uri.rsplit(".", 1)[0] + ".png"
                                rgb.save(out_dir / png_rel, "PNG")
                                img_entry["uri"] = png_rel
                                img_entry["mimeType"] = "image/png"
                                changed_gltf = True
                    alpha_tmp.unlink(missing_ok=True)
                if changed_gltf:
                    gltf_path.write_text(json.dumps(gltf_obj, indent=2), encoding="utf-8")
            except Exception:
                pass

            glb_path = out_dir / f"{asset_id}_{res}.glb"
            # If the raw .bin is > 50MB (e.g. multi-million-poly scan like jacaranda_tree),
            # optimize vertex/leaf density for real-time WebGL while keeping ~139k photogrammetry triangles
            try:
                import numpy as np
                bin_files = list(out_dir.glob("*.bin"))
                if bin_files and bin_files[0].stat().st_size > 50_000_000:
                    gltf_d = json.loads(gltf_path.read_text(encoding="utf-8"))
                    raw_b = bin_files[0].read_bytes()
                    bvs = gltf_d["bufferViews"]
                    accs = gltf_d["accessors"]
                    def _get_arr(acc_idx):
                        acc = accs[acc_idx]
                        bv = bvs[acc["bufferView"]]
                        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
                        cnt = acc["count"]
                        nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
                        dt = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc["componentType"]]
                        a = np.frombuffer(raw_b, dtype=dt, count=cnt * nc, offset=off)
                        return a.reshape((cnt, nc)).copy() if nc > 1 else a.copy()
                    new_bvs, new_accs, new_bin = [], [], bytearray()
                    def _add_acc(arr, ctype, t, target, is_pos=False):
                        pad = (4 - (len(new_bin) % 4)) % 4
                        if pad: new_bin.extend(b"\x00" * pad)
                        b = arr.tobytes()
                        off = len(new_bin)
                        new_bin.extend(b)
                        bv_i = len(new_bvs)
                        new_bvs.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": target})
                        ac = {"bufferView": bv_i, "componentType": ctype, "count": int(len(arr)), "type": t}
                        if is_pos:
                            ac["min"] = [float(x) for x in arr.min(axis=0)]
                            ac["max"] = [float(x) for x in arr.max(axis=0)]
                        new_accs.append(ac)
                        return len(new_accs) - 1
                    new_prims = []
                    for pi, prim in enumerate(gltf_d["meshes"][0]["primitives"]):
                        pos = _get_arr(prim["attributes"]["POSITION"])
                        nor = _get_arr(prim["attributes"]["NORMAL"])
                        uv = _get_arr(prim["attributes"]["TEXCOORD_0"])
                        mat_name = gltf_d["materials"][prim["material"]].get("name", "").lower()
                        if "leaves" in mat_name:
                            idx2 = _get_arr(prim["indices"]).reshape((-1, 6))
                            kept_q = idx2[::50]
                            uv_v, re_i = np.unique(kept_q, return_inverse=True)
                            pos_c, nor_c, uv_c = pos[uv_v].astype(np.float32), nor[uv_v].astype(np.float32), uv[uv_v].astype(np.float32)
                            idx_c = re_i.reshape(-1).astype(np.uint32)
                            qi = idx_c.reshape((-1, 6))
                            qp = pos_c[qi]
                            ctr = qp.mean(axis=1, keepdims=True)
                            pos_c[qi] = ctr + (qp - ctr) * 2.85
                        else:
                            cell = 0.14 if pi == 0 else 0.08
                            idx = _get_arr(prim["indices"]).reshape((-1, 3))
                            q = np.floor(pos / cell).astype(np.int64)
                            keys = q[:,0] * 73856093 ^ q[:,1] * 19349663 ^ q[:,2] * 83492791
                            _, first_i, inv = np.unique(keys, return_index=True, return_inverse=True)
                            ni = inv[idx]
                            msk = (ni[:,0] != ni[:,1]) & (ni[:,1] != ni[:,2]) & (ni[:,0] != ni[:,2])
                            uv_v, re_i = np.unique(ni[msk], return_inverse=True)
                            ov = first_i[uv_v]
                            pos_c, nor_c, uv_c = pos[ov].astype(np.float32), nor[ov].astype(np.float32), uv[ov].astype(np.float32)
                            idx_c = re_i.reshape(-1).astype(np.uint32)
                        pa = _add_acc(pos_c, 5126, "VEC3", 34962, is_pos=True)
                        na = _add_acc(nor_c, 5126, "VEC3", 34962)
                        ua = _add_acc(uv_c, 5126, "VEC2", 34962)
                        ia = _add_acc(idx_c, 5125, "SCALAR", 34963)
                        new_prims.append({"attributes": {"POSITION": pa, "NORMAL": na, "TEXCOORD_0": ua}, "indices": ia, "material": prim["material"]})
                    gltf_d["meshes"][0]["primitives"] = new_prims
                    gltf_d["bufferViews"] = new_bvs
                    gltf_d["accessors"] = new_accs
                    gltf_d["buffers"] = [{"byteLength": len(new_bin), "uri": bin_files[0].name}]
                    bin_files[0].write_bytes(new_bin)
                    gltf_path.write_text(json.dumps(gltf_d, indent=2), encoding="utf-8")
            except Exception:
                pass
            sz = pack_gltf_to_glb(gltf_path, glb_path)
            downloaded.append(
                {
                    "file": glb_path.name,
                    "url": f"/studio/assets/polyhaven/{asset_id}/{glb_path.name}",
                    "bytes": sz,
                }
            )
    else:
        raise ValueError("Unsupported type")

    manifest = {
        "assetId": asset_id,
        "type": asset_type,
        "resolution": res,
        "license": "CC0 1.0 Universal (Polyhaven)",
        "files": downloaded,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Fetch CC0 1K models, HDR skies, or PBR textures from Polyhaven."
    )
    parser.add_argument(
        "asset_id",
        help="Polyhaven asset ID (e.g. boulder_01, aerial_rocks_02, kloppenheim_06_puresky)",
    )
    parser.add_argument(
        "--type",
        choices=["auto", "model", "hdr", "textures"],
        default="auto",
        help="Asset type to fetch (default: auto)",
    )
    parser.add_argument(
        "--res",
        default="1k",
        help="Resolution to download (default: 1k)",
    )
    args = parser.parse_args()

    result = fetch_polyhaven_asset(args.asset_id, args.type, args.res)
    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
