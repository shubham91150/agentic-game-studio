#!/usr/bin/env python3
"""
BlenderKit Free Assets Search & Downloader (src/tools/fetch_blenderkit.py)

Queries the public BlenderKit REST API:
  https://www.blenderkit.com/api/v1/search/?query=<q>+asset_type:<model|material|hdr>+is_free:true&page_size=10

Extracts full CAD/PBR asset specifications:
  - id, assetBaseId, name, author, license, category, score
  - Exact metric dimensions: dimensionX, dimensionY, dimensionZ, boundingBox
  - Topology & shader specs: faceCount, faceCountRender, meshPolyType, objectCount,
    materials, shaders, modifiers, pbrType, procedural, textureResolutionMax
  - Downloads high-res thumbnail to public/assets/blenderkit/<assetBaseId>/
  - Downloads .glb (via gltf / gltf_godot) and/or .blend (via resolution_0_5K / resolution_1K / blend)
    using BLENDERKIT_API_KEY (from env or ~/.muse/vault.json) or free scene_uuid session token,
    and automatically converts model .blend -> .glb via headless Blender 3.4 when no direct glTF is present.

Usage:
  python3 src/tools/fetch_blenderkit.py --query "sports car" --type model --limit 3
  python3 src/tools/fetch_blenderkit.py --query "brick wall" --type material --limit 3
  python3 src/tools/fetch_blenderkit.py --query "studio" --type hdr --limit 2
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BLENDERKIT_OUT_DIR = ROOT_DIR / "public" / "assets" / "blenderkit"
USER_AGENT = "BlenderKit-Addon/3.4 (AgenticGameStudio/1.0)"


def get_blenderkit_api_key() -> str | None:
    """
    Checks environment variables, local .env, and ~/.muse/vault.json for BLENDERKIT_API_KEY.
    """
    env_key = os.environ.get("BLENDERKIT_API_KEY", "").strip()
    if env_key:
        return env_key

    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("BLENDERKIT_API_KEY="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val

    vault_file = Path.home() / ".muse" / "vault.json"
    if vault_file.exists():
        try:
            vault = json.loads(vault_file.read_text(encoding="utf-8"))
            val = (
                vault.get("BLENDERKIT_API_KEY")
                or vault.get("blenderkit_api_key")
                or vault.get("blenderkit", {}).get("apiKey")
            )
            if val and isinstance(val, str) and val.strip():
                return val.strip()
        except Exception:
            pass

    return None


def build_headers(api_key: str | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def fetch_json(url: str, api_key: str | None = None, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers=build_headers(api_key))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_binary(url: str, dest: Path, api_key: str | None = None, timeout: int = 45) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": USER_AGENT}
    # Only attach Bearer token to blenderkit.com API endpoints, not presigned S3/CloudFront URLs
    if api_key and "blenderkit.com/api/" in url:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def resolve_download_url(download_api_url: str, api_key: str | None = None) -> str | None:
    """
    Resolves a BlenderKit /api/v1/downloads/<uuid>/ endpoint into a signed CDN URL.
    Supports both authenticated (BLENDERKIT_API_KEY) and free anonymous (?scene_uuid=...) resolution.
    """
    scene_id = str(uuid.uuid4())
    sep = "&" if "?" in download_api_url else "?"
    url_with_scene = f"{download_api_url}{sep}scene_uuid={scene_id}"

    for candidate_key in ([api_key, None] if api_key else [None]):
        try:
            data = fetch_json(url_with_scene, api_key=candidate_key, timeout=15)
            if isinstance(data, dict):
                if data.get("filePath"):
                    return data["filePath"]
                fps = data.get("filePaths")
                if isinstance(fps, list) and fps:
                    first = fps[0]
                    if isinstance(first, dict) and first.get("url"):
                        return first["url"]
                    if isinstance(first, str):
                        return first
        except Exception:
            continue
    return None


def convert_blend_to_glb(blend_path: Path, glb_path: Path) -> bool:
    """
    Uses headless Blender 3.4 to convert a downloaded .blend model file into a game-ready .glb.
    """
    expr = (
        "import bpy; "
        f"bpy.ops.export_scene.gltf(filepath={repr(str(glb_path))}, "
        "export_format='GLB', export_apply=True, export_materials='EXPORT')"
    )
    cmd = [
        "blender",
        "--background",
        str(blend_path),
        "--python-expr",
        expr,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
    return proc.returncode == 0 and glb_path.exists() and glb_path.stat().st_size > 0


def parse_parameters(item: dict) -> dict:
    """
    Extracts structured parameters from both `dictParameters` and `parameters` array.
    """
    dp = dict(item.get("dictParameters") or {})
    for p in item.get("parameters") or []:
        ptype = p.get("parameterType")
        if ptype and ptype not in dp:
            dp[ptype] = p.get("value")

    dim_x = dp.get("dimensionX")
    dim_y = dp.get("dimensionY")
    dim_z = dp.get("dimensionZ")

    bbox = None
    if dp.get("boundBoxMinX") is not None and dp.get("boundBoxMaxX") is not None:
        bbox = {
            "min": [
                dp.get("boundBoxMinX", 0.0),
                dp.get("boundBoxMinY", 0.0),
                dp.get("boundBoxMinZ", 0.0),
            ],
            "max": [
                dp.get("boundBoxMaxX", 0.0),
                dp.get("boundBoxMaxY", 0.0),
                dp.get("boundBoxMaxZ", 0.0),
            ],
        }

    return {
        "dimensionX": dim_x,
        "dimensionY": dim_y,
        "dimensionZ": dim_z,
        "dimensionsMeters": {
            "width": dim_x,
            "depth": dim_y,
            "height": dim_z,
        }
        if (dim_x is not None or dim_y is not None or dim_z is not None)
        else None,
        "boundingBox": bbox,
        "faceCount": dp.get("faceCount"),
        "faceCountRender": dp.get("faceCountRender"),
        "objectCount": dp.get("objectCount"),
        "nodeCount": dp.get("nodeCount"),
        "meshPolyType": dp.get("meshPolyType"),
        "materials": dp.get("materials") or [],
        "shaders": dp.get("shaders") or [],
        "modifiers": dp.get("modifiers") or [],
        "pbrType": dp.get("pbrType"),
        "purePbr": dp.get("purePbr"),
        "procedural": dp.get("procedural"),
        "uv": dp.get("uv"),
        "animated": dp.get("animated"),
        "rig": dp.get("rig"),
        "modelStyle": dp.get("modelStyle"),
        "condition": dp.get("condition"),
        "designVariant": dp.get("designVariant"),
        "textureResolutionMax": dp.get("textureResolutionMax"),
        "engines": dp.get("engines") or [],
    }


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", text.strip().lower()).strip("_")
    return s[:48] or "asset"


def search_and_fetch_blenderkit(
    query: str,
    asset_type: str = "model",
    limit: int = 3,
    download_assets: bool = True,
    convert_glb: bool = True,
) -> dict:
    api_key = get_blenderkit_api_key()
    q_enc = urllib.parse.quote_plus(query.strip())
    page_size = max(limit * 3, 10)
    search_url = (
        f"https://www.blenderkit.com/api/v1/search/"
        f"?query={q_enc}+asset_type:{asset_type}+is_free:true&page_size={page_size}"
    )

    raw_data = fetch_json(search_url, api_key=api_key)
    raw_results = raw_data.get("results") or []

    # Rank results: prioritize whole models/assets that match query tokens closely and have reasonable download sizes
    q_tokens = [t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) >= 2]

    def rank_item(r: dict) -> tuple:
        name = (r.get("name") or r.get("displayName") or "").lower()
        ftypes = {f.get("fileType") for f in (r.get("files") or [])}
        has_gltf = 1 if ("gltf" in ftypes or "gltf_godot" in ftypes) else 0
        exact_phrase = 1 if query.lower() in name else 0
        token_hits = sum(1 for t in q_tokens if t in name)
        score = float(r.get("score") or 0.0)
        return (exact_phrase, has_gltf, token_hits, score)

    sorted_results = sorted(raw_results, key=rank_item, reverse=True)[:limit]

    processed_results = []
    for idx, item in enumerate(sorted_results):
        asset_id = item.get("id") or ""
        asset_base_id = item.get("assetBaseId") or asset_id
        name = item.get("displayName") or item.get("name") or f"blenderkit_{idx}"
        slug = f"{slugify(name)}_{asset_base_id[:8]}"
        out_dir = BLENDERKIT_OUT_DIR / slug
        out_dir.mkdir(parents=True, exist_ok=True)

        author_info = item.get("author") or {}
        author_name = (
            author_info.get("fullName")
            or f"{author_info.get('firstName', '')} {author_info.get('lastName', '')}".strip()
            or "BlenderKit Creator"
        )

        params = parse_parameters(item)

        files_meta = []
        file_map = {}
        for f in item.get("files") or []:
            ft = f.get("fileType")
            dl_url = f.get("downloadUrl")
            files_meta.append(
                {
                    "fileType": ft,
                    "uuid": f.get("uuid"),
                    "downloadUrl": dl_url,
                    "fileUploadSize": f.get("fileUploadSize"),
                }
            )
            if ft and dl_url:
                file_map[ft] = f

        downloaded_files = {}

        # 1. Always download high-res thumbnail
        thumb_url = (
            item.get("thumbnailLargeUrl")
            or item.get("thumbnailMiddleUrl")
            or item.get("thumbnailSmallUrl")
        )
        if thumb_url:
            ext = ".webp" if thumb_url.lower().endswith(".webp") else ".png"
            if ".jpg" in thumb_url.lower() or ".jpeg" in thumb_url.lower():
                ext = ".jpg"
            thumb_dest = out_dir / f"thumbnail{ext}"
            try:
                sz = download_binary(thumb_url, thumb_dest, api_key=None, timeout=20)
                downloaded_files["thumbnail"] = {
                    "file": str(thumb_dest.relative_to(ROOT_DIR)),
                    "url": f"/studio/assets/blenderkit/{slug}/{thumb_dest.name}",
                    "bytes": sz,
                    "sourceUrl": thumb_url,
                }
            except Exception as exc:
                downloaded_files["thumbnailError"] = str(exc)

        # 2. Download .glb and/or .blend when accessible
        if download_assets:
            # 2a. Check direct glTF / glTF_godot first
            for gltf_key in ("gltf", "gltf_godot"):
                if gltf_key in file_map:
                    dl_api_url = file_map[gltf_key]["downloadUrl"]
                    signed_url = resolve_download_url(dl_api_url, api_key=api_key)
                    if signed_url:
                        glb_dest = out_dir / f"{slug}.glb"
                        try:
                            sz = download_binary(signed_url, glb_dest, api_key=None, timeout=45)
                            downloaded_files["glb"] = {
                                "file": str(glb_dest.relative_to(ROOT_DIR)),
                                "url": f"/studio/assets/blenderkit/{slug}/{glb_dest.name}",
                                "bytes": sz,
                                "fileType": gltf_key,
                            }
                            break
                        except Exception:
                            pass

            # 2b. Download compact .blend (prefer resolution_0_5K -> resolution_1K -> resolution_2K -> blend)
            # so materials, HDRs, and models without pre-built glTF all get real native files
            preferred_blend_types = (
                "resolution_0_5K",
                "resolution_1K",
                "resolution_2K",
                "blend",
            )
            for b_key in preferred_blend_types:
                if b_key in file_map:
                    f_entry = file_map[b_key]
                    f_size = f_entry.get("fileUploadSize") or 0
                    # Avoid downloading >35MB raw .blend if we already have a .glb
                    if "glb" in downloaded_files and f_size > 15_000_000:
                        continue
                    if f_size > 50_000_000:
                        continue
                    signed_url = resolve_download_url(f_entry["downloadUrl"], api_key=api_key)
                    if signed_url:
                        ext = ".hdr" if asset_type == "hdr" and signed_url.split("?")[0].endswith(".hdr") else ".blend"
                        blend_dest = out_dir / f"{slug}_{b_key}{ext}"
                        try:
                            sz = download_binary(signed_url, blend_dest, api_key=None, timeout=45)
                            downloaded_files["blend"] = {
                                "file": str(blend_dest.relative_to(ROOT_DIR)),
                                "url": f"/studio/assets/blenderkit/{slug}/{blend_dest.name}",
                                "bytes": sz,
                                "fileType": b_key,
                            }
                            # If model asset didn't have a direct glTF, convert the .blend -> .glb via headless Blender!
                            if (
                                asset_type == "model"
                                and "glb" not in downloaded_files
                                and convert_glb
                                and ext == ".blend"
                            ):
                                glb_dest = out_dir / f"{slug}.glb"
                                if convert_blend_to_glb(blend_dest, glb_dest):
                                    downloaded_files["glb"] = {
                                        "file": str(glb_dest.relative_to(ROOT_DIR)),
                                        "url": f"/studio/assets/blenderkit/{slug}/{glb_dest.name}",
                                        "bytes": glb_dest.stat().st_size,
                                        "fileType": f"converted_from_{b_key}",
                                    }
                            break
                        except Exception:
                            continue

        asset_record = {
            "id": asset_id,
            "assetBaseId": asset_base_id,
            "slug": slug,
            "name": name,
            "assetType": item.get("assetType") or asset_type,
            "category": item.get("category"),
            "author": author_name,
            "license": item.get("license") or "royalty_free",
            "isFree": item.get("isFree", True),
            "score": item.get("score"),
            "ratingsAverage": item.get("ratingsAverage"),
            "description": item.get("description") or "",
            "tags": item.get("tags") or [],
            "parameters": params,
            "availableFiles": files_meta,
            "downloaded": downloaded_files,
        }

        # Save blueprint.json alongside downloaded files
        (out_dir / "blueprint.json").write_text(
            json.dumps(asset_record, indent=2), encoding="utf-8"
        )
        processed_results.append(asset_record)

    return {
        "query": query,
        "assetType": asset_type,
        "totalMatches": raw_data.get("count", len(processed_results)),
        "returnedCount": len(processed_results),
        "authenticated": bool(api_key),
        "outputDirectory": str(BLENDERKIT_OUT_DIR.relative_to(ROOT_DIR)),
        "results": processed_results,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Search and download free BlenderKit 3D models, PBR materials, and HDRs with full CAD/PBR specs."
    )
    parser.add_argument(
        "--query",
        required=True,
        help='Search query (e.g. "sports car", "brick wall", "street lamp")',
    )
    parser.add_argument(
        "--type",
        choices=["model", "material", "hdr", "brush", "scene"],
        default="model",
        help="BlenderKit asset_type (default: model)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=3,
        help="Maximum number of assets to fetch (default: 3)",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Fetch metadata + thumbnails only without downloading .glb/.blend files",
    )
    args = parser.parse_args()

    result = search_and_fetch_blenderkit(
        query=args.query,
        asset_type=args.type,
        limit=args.limit,
        download_assets=not args.no_download,
    )
    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
