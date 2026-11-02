#!/usr/bin/env python3
"""Studio 3D & World Generation MCP Server (stdio JSON-RPC 2.0).

Exposes Agentic Game Studio's PartNet/ShapeNet builder, Blender Pro generators
(Sapling Tree Gen, Archimesh Building, A.N.T. Landscape), OpenStreetMap 3D City
Extruder, Objaverse structure inspector, BlenderKit/PolyHaven/ambientCG CC0
fetchers, and Visual QA Gate as first-class MCP tools inside Muse Code CLI.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TOOLS = [
    {
        "name": "partnet_shapenet_build",
        "description": "Inspect or build a multi-part CAD-accurate 3D asset (.glb) using PartNet anatomical part hierarchies & ShapeNet metric dimensions (bazaar_stall, sports_car, commercial_building, streetlamp).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Asset category or ShapeNet synset (e.g. 'bazaar stall', 'sports car', 'commercial building', 'streetlamp')"},
                "generate_glb": {"type": "boolean", "description": "If true, exports a multi-part .glb file"},
                "out": {"type": "string", "description": "Output .glb path relative to repo root"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "blender_pro_generate",
        "description": "Generate high-detail 3D assets via Blender 3.4 built-in generators: sapling_tree (oak/pine/willow), arch_building (multi-floor Archimesh building), or landscape (canyon/mountain/hills).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "asset_type": {"type": "string", "enum": ["sapling_tree", "arch_building", "landscape"]},
                "preset": {"type": "string", "description": "oak | pine | willow | canyon | mountain | hills"},
                "floors": {"type": "integer", "description": "Number of floors for arch_building (default 3)"},
                "out": {"type": "string", "description": "Output .glb path relative to repo root"},
            },
            "required": ["asset_type", "out"],
        },
    },
    {
        "name": "osm_real_world_city_3d",
        "description": "Extrude a real-world 3D city/bazaar district (.glb) from OpenStreetMap building footprints, road networks, parks, and waterways (presets: lucknow_hazratganj, monaco_harbor, tokyo_shibuya, nyc_times_square).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "preset": {"type": "string", "description": "lucknow_hazratganj | monaco_harbor | tokyo_shibuya | nyc_times_square"},
                "radius": {"type": "integer", "description": "Radius in meters (default 200)"},
                "out": {"type": "string", "description": "Output .glb path relative to repo root"},
            },
            "required": ["preset", "out"],
        },
    },
    {
        "name": "objaverse_inspect_3d",
        "description": "Search Objaverse-XL / LVIS 3D object dataset and inspect multi-part mesh hierarchy, vertex counts, and material slots.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "3D object search term (e.g. 'car', 'stall', 'lantern', 'tree')"},
                "limit": {"type": "integer", "description": "Max results (default 3)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "blenderkit_search_free",
        "description": "Search BlenderKit's free 3D models, PBR materials, and HDRIs with exact dimensions, face counts, and material parameters.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query (e.g. 'sports car', 'brick wall', 'street lamp')"},
                "asset_type": {"type": "string", "enum": ["model", "material", "hdr"]},
                "limit": {"type": "integer", "description": "Max results (default 3)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "fetch_cc0_pbr_or_model",
        "description": "Download 100% free CC0 photogrammetry 3D models or 1K PBR texture sets from Poly Haven or ambientCG.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["polyhaven", "ambientcg"]},
                "asset_id": {"type": "string", "description": "Asset ID or search term (e.g. 'boulder_01', 'asphalt_02', 'Bricks075', 'Metal032')"},
            },
            "required": ["source", "asset_id"],
        },
    },
    {
        "name": "run_visual_qa_gate",
        "description": "Run the hard Visual QA Gate on a game directory (default public/live-preview) to verify zero primitive box/cone fakes, active GLTFLoader .glb usage, 3D wind-swaying grass blades, CSP compliance, and ACESFilmicToneMapping.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target_dir": {"type": "string", "description": "Directory to verify (default 'public/live-preview')"},
            },
        },
    },
]


def run_cmd(cmd: list[str], timeout: int = 120) -> str:
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        return out.strip()[:4000] or f"Command exited with {proc.returncode}"
    except Exception as exc:
        return f"Error running tool: {exc}"


def handle_call(name: str, args: dict) -> str:
    if name == "partnet_shapenet_build":
        cmd = ["python3", "src/tools/partnet_shapenet_blueprint.py", "--query", str(args.get("query", "bazaar stall"))]
        if args.get("generate_glb"):
            cmd += ["--generate-bpy", "--out", str(args.get("out", "storage/cache/pro_builder/partnet_asset.glb"))]
        return run_cmd(cmd)
    if name == "blender_pro_generate":
        cmd = [
            "python3",
            "src/tools/blender_pro_builder.py",
            "--type",
            str(args.get("asset_type", "sapling_tree")),
            "--out",
            str(args.get("out", "storage/cache/pro_builder/pro_asset.glb")),
        ]
        if args.get("preset"):
            cmd += ["--preset", str(args["preset"])]
        if args.get("floors"):
            cmd += ["--floors", str(args["floors"])]
        return run_cmd(cmd, timeout=180)
    if name == "osm_real_world_city_3d":
        cmd = [
            "python3",
            "src/tools/osm_city_3d.py",
            "--preset",
            str(args.get("preset", "lucknow_hazratganj")),
            "--radius",
            str(args.get("radius", 200)),
            "--out",
            str(args.get("out", "storage/cache/pro_builder/osm_city.glb")),
        ]
        return run_cmd(cmd, timeout=120)
    if name == "objaverse_inspect_3d":
        cmd = [
            "python3",
            "src/tools/search_objaverse.py",
            "--query",
            str(args.get("query", "car")),
            "--limit",
            str(args.get("limit", 3)),
        ]
        return run_cmd(cmd, timeout=120)
    if name == "blenderkit_search_free":
        cmd = [
            "python3",
            "src/tools/fetch_blenderkit.py",
            "--query",
            str(args.get("query", "sports car")),
            "--type",
            str(args.get("asset_type", "model")),
            "--limit",
            str(args.get("limit", 3)),
        ]
        return run_cmd(cmd, timeout=90)
    if name == "fetch_cc0_pbr_or_model":
        src = args.get("source", "polyhaven")
        aid = str(args.get("asset_id", "Bricks075"))
        if src == "ambientcg":
            return run_cmd(["python3", "src/tools/fetch_ambientcg.py", "--query", aid, "--limit", "1"])
        return run_cmd(["python3", "src/tools/fetch_polyhaven.py", aid, "--type", "auto", "--res", "1k"])
    if name == "run_visual_qa_gate":
        target = str(args.get("target_dir", "public/live-preview"))
        return run_cmd(["node", "src/verifier/visual_qa_gate.js", target], timeout=30)
    return f"Unknown tool: {name}"


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line or line.startswith("Content-Length:"):
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        method = msg.get("method", "")
        msg_id = msg.get("id")
        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "studio-3d-tools", "version": "1.0.0"},
                },
            }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif method == "tools/call":
            params = msg.get("params") or {}
            text = handle_call(params.get("name", ""), params.get("arguments") or {})
            resp = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"content": [{"type": "text", "text": text}]},
            }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif msg_id is not None:
            resp = {"jsonrpc": "2.0", "id": msg_id, "result": {}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
