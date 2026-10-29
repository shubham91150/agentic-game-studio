#!/usr/bin/env python3
"""Agentic Game Studio - SAM 3.1 segmentation tool.

Sends an image + concept prompt(s) to Meta SAM 3.1 (Meta Model API),
decodes the returned boxes + masks, and saves overlay + cutout PNGs
into storage/.uploads/ (served at /studio/uploads/...).

Usage:
  python3 src/tools/segment_image.py --image storage/.uploads/sunrise_valley.jpg \
    --prompt mountain,tree
"""
import argparse
import base64
import io
import json
import os
import re
import subprocess
import sys

import requests
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meta_sam_parser import SegmentationMask, decode_mask_to_raster

API_URL = "https://api.meta.ai/v1/responses"
VAULT = "/home/opencode/project-data/workspace/.orchestrator/vault.mjs"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BOX_RE = re.compile(r"<\|box;([^|]*)\|>")
ENCODING = {"~": "lossless", "!": "one_bit"}
COLORS = [(56, 189, 248), (74, 222, 128), (250, 204, 21), (248, 113, 113)]


def parse_records(wire):
    """Split wire text into (object_id, box_token, mask_token) records.

    NOTE: the base85 mask payload may itself contain '|' and ',',
    so record boundaries are found via box tokens, and each mask token
    runs from '<|mask;' to the LAST '|>' before the next record/end.
    """
    boxes = list(BOX_RE.finditer(wire))
    # object id = digits immediately before each box token (after <Nf> or ',')
    id_re = re.compile(r"(?:<0f>|,)(\d+)<\|box;")
    ids = [m.group(1) for m in id_re.finditer(wire)]
    records = []
    for i, b in enumerate(boxes):
        seg_end = boxes[i + 1].start() if i + 1 < len(boxes) else len(wire)
        seg = wire[b.end():seg_end]
        mstart = seg.find("<|mask;")
        if mstart == -1:
            continue
        mend = seg.rfind("|>")
        if mend == -1 or mend < mstart:
            continue
        mask_tok = seg[mstart + len("<|mask;"):mend]
        records.append((ids[i] if i < len(ids) else str(i), b.group(1), mask_tok))
    return records


def resolve_key():
    for env in ("MODEL_API_KEY", "META_API_KEY"):
        if os.environ.get(env):
            return os.environ[env]
    out = subprocess.run(
        ["node", VAULT, "get", "Meta_Key"], capture_output=True, text=True
    )
    key = out.stdout.strip()
    if not key:
        raise RuntimeError("Meta Model API key is not available.")
    return key


def parse_fields(token):
    fields = {}
    for part in token.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            fields[k] = v
    return fields


def segment_image(image_b64, concept, api_key):
    body = {
        "model": "sam-3.1",
        "stream": True,
        "metadata": {"mask_encoding": "one_bit"},
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept},
                    {"type": "input_image", "image_url": image_b64},
                ],
            }
        ],
    }
    with requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json=body,
        stream=True,
        timeout=120,
    ) as res:
        if res.status_code != 200:
            raise RuntimeError(
                f"SAM 3.1 HTTP {res.status_code}: {res.text[:200]}"
            )
        text = ""
        for line in res.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                evt = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if evt.get("type") == "response.output_text.delta":
                text += evt.get("delta", "")
            elif evt.get("type") in ("response.failed", "response.error"):
                raise RuntimeError(f"SAM 3.1 failed: {payload[:200]}")
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--prompt", required=True, help="comma-separated concepts")
    ap.add_argument("--outdir", default=os.path.join(ROOT, "storage", ".uploads"))
    args = ap.parse_args()

    img_path = args.image if os.path.isabs(args.image) else os.path.join(ROOT, args.image)
    with open(img_path, "rb") as f:
        raw = f.read()
    mime = "image/png" if img_path.lower().endswith(".png") else "image/jpeg"
    image_b64 = f"data:{mime};base64," + base64.b64encode(raw).decode()

    base = Image.open(img_path).convert("RGB")
    src_w, src_h = base.size
    stem = os.path.splitext(os.path.basename(img_path))[0]
    os.makedirs(args.outdir, exist_ok=True)

    api_key = resolve_key()
    concepts = [c.strip() for c in args.prompt.split(",") if c.strip()]
    saved = []
    for ci, concept in enumerate(concepts):
        print(f"[segment] concept: {concept}", flush=True)
        wire = segment_image(image_b64, concept, api_key)
        records = parse_records(wire)
        if not records:
            print(f"[segment] no matches for '{concept}'")
            continue
        color = COLORS[ci % len(COLORS)]
        overlay = base.copy()
        draw = ImageDraw.Draw(overlay, "RGBA")
        for obj_id, box_tok, mask_tok in records:
            box = parse_fields(box_tok)
            x1, y1, x2, y2 = (int(box[k]) for k in ("x1", "y1", "x2", "y2"))
            # NOTE: the base85 payload may itself contain ';' and ',',
            # so slice data= by position, not by blind splitting.
            data_idx = mask_tok.find("data=")
            if data_idx == -1:
                continue
            data_val = mask_tok[data_idx + len("data="):]
            first_comma = data_val.find(",")
            second_comma = data_val.find(",", first_comma + 1)
            mh, mw = int(data_val[:first_comma]), int(
                data_val[first_comma + 1:second_comma]
            )
            enc_payload = data_val[second_comma + 1:]
            mask = SegmentationMask(
                encoding=ENCODING.get(enc_payload[0], "lossless"),
                payload=enc_payload,
                width=mw,
                height=mh,
            )
            raster = decode_mask_to_raster(mask)
            import array as _arr

            px = _arr.array("B", bytes(raster))
            mimg = Image.new("L", (mw, mh))
            mimg.putdata([255 if v else 0 for v in px])
            mimg = mimg.resize((src_w, src_h), Image.NEAREST)
            tint = Image.new("RGBA", (src_w, src_h), color + (0,))
            alpha = mimg.point(lambda v: 90 if v else 0)
            overlay = Image.composite(
                Image.new("RGBA", (src_w, src_h), color + (255,)),
                overlay.convert("RGBA"),
                alpha,
            )
            draw = ImageDraw.Draw(overlay, "RGBA")
            draw.rectangle([x1, y1, x2, y2], outline=color + (255,), width=3)
            # cutout: object on transparent background
            cut = Image.new("RGBA", (src_w, src_h), (0, 0, 0, 0))
            cut.paste(base.convert("RGBA"), (0, 0), mimg)
            cut_path = os.path.join(
                args.outdir, f"{stem}_seg_{ci}_{obj_id}.png"
            )
            cut.save(cut_path)
            saved.append(cut_path)
            print(
                f"[segment] id={obj_id} box=({x1},{y1},{x2},{y2}) bytes={os.path.getsize(cut_path)}"
            )
        overlay_path = os.path.join(args.outdir, f"{stem}_overlay_{ci}.png")
        overlay.convert("RGB").save(overlay_path)
        saved.append(overlay_path)
        print(f"[segment] overlay: {overlay_path}")

    for p in saved:
        print("SAVED " + os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
