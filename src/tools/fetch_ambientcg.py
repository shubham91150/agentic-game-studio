#!/usr/bin/env python3
"""
ambientCG CC0 PBR Texture Fetcher (src/tools/fetch_ambientcg.py)

Queries the official free ambientCG CC0 API:
  https://ambientcg.com/api/v2/full_json?q=<search>&type=Material&limit=5&include=downloadData

Downloads the 1K-JPG PBR zip (Color, NormalGL, Roughness, Metalness, AmbientOcclusion)
and extracts the maps into:
  public/assets/ambientcg/<asset_id>/

Usage:
  python3 src/tools/fetch_ambientcg.py Metal032
  python3 src/tools/fetch_ambientcg.py Bricks075
  python3 src/tools/fetch_ambientcg.py --query "Asphalt012" --limit 5
"""

import argparse
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
AMBIENTCG_OUT_DIR = ROOT_DIR / "public" / "assets" / "ambientcg"
USER_AGENT = "Mozilla/5.0 (compatible; AgenticGameStudio/1.0; +https://ambientcg.com)"

PBR_MAP_TYPES = (
    "Color",
    "NormalGL",
    "Roughness",
    "Metalness",
    "AmbientOcclusion",
    "Displacement",
    "Opacity",
    "Emission",
)


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def query_ambientcg_materials(search: str, limit: int = 5) -> list[dict]:
    encoded_q = urllib.parse.quote(search)
    api_url = (
        f"https://ambientcg.com/api/v2/full_json"
        f"?q={encoded_q}&type=Material&limit={limit}&include=downloadData"
    )
    data = fetch_json(api_url)
    found = data.get("foundAssets", [])

    # If exact ID like Bricks075, Asphalt012, Metal032 was passed as `q`,
    # ambientCG's `q` searches tags/keywords rather than numeric assetIds.
    # Fallback to querying the base material keyword and matching the ID prefix.
    if not found:
        m = re.match(r"^([A-Za-z]+)", search.strip())
        if m:
            base_kw = m.group(1)
            fallback_url = (
                f"https://ambientcg.com/api/v2/full_json"
                f"?q={urllib.parse.quote(base_kw)}&type=Material&limit=250&include=downloadData"
            )
            fb_data = fetch_json(fallback_url)
            all_assets = fb_data.get("foundAssets", [])
            target_low = search.strip().lower()
            exact_or_prefix = [
                a
                for a in all_assets
                if a.get("assetId", "").lower() == target_low
                or a.get("assetId", "").lower().startswith(target_low)
            ]
            found = exact_or_prefix[:limit] if exact_or_prefix else all_assets[:limit]

    return found


def pick_1k_jpg_download(asset: dict, res_attr: str = "1K-JPG") -> dict | None:
    dl_folders = asset.get("downloadFolders", {})
    default_folder = dl_folders.get("default", {})
    cats = default_folder.get("downloadFiletypeCategories", {})
    zip_cat = cats.get("zip", {})
    downloads = zip_cat.get("downloads", [])
    for d in downloads:
        if d.get("attribute", "").upper() == res_attr.upper():
            return d
    for d in downloads:
        if "1K" in d.get("attribute", "").upper():
            return d
    return downloads[0] if downloads else None


def classify_pbr_map(filename: str) -> str | None:
    low = filename.lower()
    if not low.endswith((".jpg", ".jpeg", ".png")):
        return None
    for map_type in PBR_MAP_TYPES:
        if f"_{map_type.lower()}" in low:
            return map_type
    return None


def fetch_ambientcg(search: str, limit: int = 5, res_attr: str = "1K-JPG") -> dict:
    found = query_ambientcg_materials(search, limit=limit)
    if not found:
        raise ValueError(f"No ambientCG materials found for query: {search}")

    # Prefer exact/prefix match if present in `found`
    target_low = search.strip().lower()
    chosen = found[0]
    for a in found:
        aid = a.get("assetId", "").lower()
        if aid == target_low or aid.startswith(target_low):
            chosen = a
            break

    asset_id = chosen["assetId"]
    dl_info = pick_1k_jpg_download(chosen, res_attr=res_attr)
    if not dl_info:
        raise ValueError(f"No 1K ZIP download found for ambientCG asset: {asset_id}")

    dl_url = dl_info.get("fullDownloadPath") or dl_info.get("downloadLink")
    raw_zip = download_bytes(dl_url)

    out_dir = AMBIENTCG_OUT_DIR / asset_id
    out_dir.mkdir(parents=True, exist_ok=True)

    extracted_files = []
    maps_by_type = {}

    with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue
            fname = Path(member.filename).name
            map_type = classify_pbr_map(fname)
            if not map_type:
                continue
            content = zf.read(member)
            dest = out_dir / fname
            dest.write_bytes(content)
            rel_url = f"/studio/assets/ambientcg/{asset_id}/{fname}"
            entry = {
                "map": map_type,
                "file": fname,
                "url": rel_url,
                "bytes": len(content),
            }
            extracted_files.append(entry)
            maps_by_type[map_type] = rel_url

    manifest = {
        "query": search,
        "assetId": asset_id,
        "attribute": dl_info.get("attribute", res_attr),
        "license": "CC0 1.0 Universal (ambientCG)",
        "matchingCandidates": [a.get("assetId") for a in found[:limit]],
        "maps": maps_by_type,
        "files": extracted_files,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Fetch CC0 1K-JPG PBR materials from ambientCG."
    )
    parser.add_argument(
        "query_pos",
        nargs="?",
        default=None,
        help="Search term or material ID (e.g. Bricks075, Asphalt012, Metal032)",
    )
    parser.add_argument(
        "--query",
        "-q",
        default=None,
        help="Search term or material ID (e.g. Bricks075, Asphalt012, Metal032)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Max search candidates to query from ambientCG API (default: 5)",
    )
    parser.add_argument(
        "--res",
        default="1K-JPG",
        help="Download resolution attribute (default: 1K-JPG)",
    )
    args = parser.parse_args()

    search_term = args.query or args.query_pos
    if not search_term:
        parser.error("Provide a material query/ID (positional or --query)")

    result = fetch_ambientcg(search_term, limit=args.limit, res_attr=args.res)
    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
