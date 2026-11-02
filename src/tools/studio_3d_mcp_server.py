#!/usr/bin/env python3
"""Studio 3D & World Generation MCP Server (stdio JSON-RPC 2.0).

Exposes Agentic Game Studio's 15 real 3D, World, Audio, Voice, and QA tools:
  1. partnet_shapenet_build
  2. blender_pro_generate
  3. blender_autorig_animate
  4. depth_to_gaussian_splat
  5. generate_game_audio
  6. meta_musicgen_generate
  7. osm_real_world_city_3d
  8. objaverse_inspect_3d
  9. blenderkit_search_free
  10. fetch_cc0_pbr_or_model
  11. scenescript_wfc_build
  12. meta_vggt_reconstruct
  13. gltf_transform_optimize
  14. run_visual_qa_gate
  15. meta_voice_transcribe
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
        "description": "Generate high-detail 3D assets via Blender 3.4 built-in & procedural generators: sapling_tree (oak/pine/willow), arch_building (multi-floor Archimesh building), landscape (canyon/mountain/hills), jalebi_spiral_stack (Sverchok/Sorcar parametric coiled stack on brass platter), or carved_brick_arch (Erindale-style Lucknow/Mughal brick arch).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "asset_type": {
                    "type": "string",
                    "enum": [
                        "sapling_tree",
                        "arch_building",
                        "landscape",
                        "jalebi_spiral_stack",
                        "carved_brick_arch",
                    ],
                },
                "preset": {"type": "string", "description": "oak | pine | willow | canyon | mountain | hills"},
                "floors": {"type": "integer", "description": "Number of floors for arch_building (default 3)"},
                "count": {"type": "integer", "description": "Number of coils for jalebi_spiral_stack (default 40)"},
                "out": {"type": "string", "description": "Output .glb path relative to repo root"},
            },
            "required": ["asset_type", "out"],
        },
    },
    {
        "name": "blender_autorig_animate",
        "description": "Auto-rig a 3D mesh or generate an articulated humanoid NPC (shopkeeper, runner, guard) with a 7-bone Blender Armature skeleton and bake 3 keyframe NLA animation clips (Idle, Walk, Wave) for THREE.AnimationMixer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "preset": {"type": "string", "enum": ["shopkeeper", "runner", "guard"], "description": "Character preset when in_glb is omitted"},
                "in_glb": {"type": "string", "description": "Optional existing .glb file to auto-rig"},
                "out": {"type": "string", "description": "Output animated .glb path relative to repo root"},
            },
            "required": ["out"],
        },
    },
    {
        "name": "depth_to_gaussian_splat",
        "description": "Convert a 2D RGB image + Depth Anything V2 depth map into a 3D Gaussian Splatting binary (.splat / .ply) ready for WorldRealism.loadGaussianSplat in Three.js.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Input 2D RGB image path"},
                "depth": {"type": "string", "description": "Depth map path (auto-computed via Depth Anything V2 if missing)"},
                "out": {"type": "string", "description": "Output .splat path"},
                "ply": {"type": "string", "description": "Optional output 3DGS .ply path"},
                "max_splats": {"type": "integer", "description": "Max splat count (default 40000)"},
            },
            "required": ["image", "out"],
        },
    },
    {
        "name": "generate_game_audio",
        "description": "Synthesize 44.1kHz 16-bit PCM .wav game audio stems (bazaar_ambience, jalebi_sizzle, footstep_stone, collect_chime, impact_crash) into public/assets/audio/.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "all": {"type": "boolean", "description": "If true, generate all 5 standard audio stems"},
                "stem": {
                    "type": "string",
                    "enum": ["bazaar_ambience", "jalebi_sizzle", "footstep_stone", "collect_chime", "impact_crash"],
                },
                "out_dir": {"type": "string", "description": "Output directory (default public/assets/audio)"},
            },
        },
    },
    {
        "name": "meta_musicgen_generate",
        "description": "Generate real 32kHz AI music & soundscapes from a text prompt using Meta's official AudioCraft `facebook/musicgen-small` (300M parameter neural model).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Text prompt describing the music or audio loop (e.g. 'upbeat electronic racing synthwave loop')"},
                "seconds": {"type": "number", "description": "Duration in seconds (default 4.0)"},
                "out": {"type": "string", "description": "Output .wav path (default public/assets/audio/musicgen_theme.wav)"},
            },
            "required": ["prompt"],
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
        "name": "scenescript_wfc_build",
        "description": "Compile Meta SceneScript architectural DSL (with real manifold3d CSG boolean door/window openings) OR Wave Function Collapse (WFC) 3D bazaar/courtyard/city grid into a multi-material .glb.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["scenescript", "wfc"]},
                "grid": {"type": "integer", "description": "WFC grid size (default 6)"},
                "out": {"type": "string", "description": "Output .glb path"},
            },
            "required": ["mode"],
        },
    },
    {
        "name": "meta_vggt_reconstruct",
        "description": "Reconstruct a 3D metric surface mesh (.glb) from an image using Meta VGGT-1B on Modal GPU (`--backend modal`) with automatic local Depth-Anything-V2 + Delaunay 3D mesh fallback (`--backend local`).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Input image path"},
                "depth": {"type": "string", "description": "Optional depth PNG path"},
                "backend": {"type": "string", "enum": ["modal", "local"], "description": "Backend: 'modal' (Meta VGGT-1B on GPU) or 'local'"},
                "out": {"type": "string", "description": "Output .glb path"},
            },
            "required": ["image"],
        },
    },
    {
        "name": "gltf_transform_optimize",
        "description": "Optimize any .glb 3D model using @gltf-transform/core + @gltf-transform/functions (dedup, weld, prune, center pivot).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "in": {"type": "string", "description": "Input .glb path"},
                "out": {"type": "string", "description": "Output optimized .glb path"},
            },
            "required": ["in"],
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
    {
        "name": "meta_voice_transcribe",
        "description": "Transcribe spoken voice prompts or game audio clips into text using Meta's official `muse-voice-transcribe-1.0` model (`/v1/asr/transcribe` and `muse voice transcribe`).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "audio": {"type": "string", "description": "Input audio file path (.wav/.mp3/.ogg, default 'public/assets/audio/voice_prompt_sample.wav')"},
                "backend": {"type": "string", "enum": ["api", "cli"], "description": "Preferred backend: 'api' (/v1/asr/transcribe) or 'cli' (muse voice transcribe)"},
            },
            "required": ["audio"],
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
        if args.get("count"):
            cmd += ["--count", str(args["count"])]
        return run_cmd(cmd, timeout=180)
    if name == "blender_autorig_animate":
        cmd = [
            "python3",
            "src/tools/blender_autorig_animate.py",
            "--out",
            str(args.get("out", "public/assets/custom/npc_animated.glb")),
        ]
        if args.get("preset"):
            cmd += ["--preset", str(args["preset"])]
        if args.get("in_glb"):
            cmd += ["--in", str(args["in_glb"])]
        return run_cmd(cmd, timeout=180)
    if name == "depth_to_gaussian_splat":
        cmd = [
            "python3",
            "src/tools/depth_to_gaussian_splat.py",
            "--image",
            str(args.get("image", "storage/.uploads/sunrise_valley.jpg")),
            "--depth",
            str(args.get("depth", "/tmp/opencode/sunrise_depth.png")),
            "--out",
            str(args.get("out", "public/assets/custom/scene.splat")),
        ]
        if args.get("ply"):
            cmd += ["--ply", str(args["ply"])]
        if args.get("max_splats"):
            cmd += ["--max-splats", str(args["max_splats"])]
        return run_cmd(cmd, timeout=180)
    if name == "generate_game_audio":
        cmd = ["python3", "src/tools/generate_game_audio.py"]
        if args.get("all") or not args.get("stem"):
            cmd.append("--all")
        else:
            cmd += ["--stem", str(args["stem"])]
        if args.get("out_dir"):
            cmd += ["--out-dir", str(args["out_dir"])]
        return run_cmd(cmd, timeout=60)
    if name == "meta_musicgen_generate":
        cmd = [
            "python3",
            "src/tools/meta_musicgen_audio.py",
            "--prompt",
            str(args.get("prompt", "upbeat electronic racing synthwave loop")),
            "--seconds",
            str(args.get("seconds", 4.0)),
            "--out",
            str(args.get("out", "public/assets/audio/musicgen_theme.wav")),
        ]
        return run_cmd(cmd, timeout=300)
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
    if name == "scenescript_wfc_build":
        mode = str(args.get("mode", "scenescript"))
        out = str(args.get("out", f"public/assets/custom/{mode}_world.glb"))
        cmd = ["python3", "src/tools/scenescript_wfc_world.py", "--mode", mode, "--out", out]
        if args.get("grid"):
            cmd += ["--grid", str(args["grid"])]
        return run_cmd(cmd, timeout=60)
    if name == "meta_vggt_reconstruct":
        cmd = [
            "python3",
            "src/tools/meta_vggt_scene.py",
            "--image",
            str(args.get("image", "storage/.uploads/sunrise_valley.jpg")),
            "--backend",
            str(args.get("backend", "local")),
            "--out",
            str(args.get("out", "public/assets/custom/vggt_scene.glb")),
        ]
        if args.get("depth"):
            cmd += ["--depth", str(args["depth"])]
        return run_cmd(cmd, timeout=180)
    if name == "gltf_transform_optimize":
        in_glb = str(args.get("in", "storage/cache/pro_builder/bazaar_stall.glb"))
        out_glb = str(args.get("out", in_glb))
        return run_cmd(["node", "src/tools/gltf_optimize.js", "--in", in_glb, "--out", out_glb], timeout=60)
    if name == "run_visual_qa_gate":
        target = str(args.get("target_dir", "public/live-preview"))
        return run_cmd(["node", "src/verifier/visual_qa_gate.js", target], timeout=30)
    if name == "meta_voice_transcribe":
        audio = str(args.get("audio", "public/assets/audio/voice_prompt_sample.wav"))
        backend = str(args.get("backend", "api"))
        return run_cmd(["node", "src/tools/meta_voice_transcribe.js", "--audio", audio, "--backend", backend], timeout=60)
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
