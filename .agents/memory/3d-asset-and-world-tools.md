---
name: 3d-asset-and-world-tools
description: Native studio-3d-tools MCP (18 tools) and CLI tools for MetaWorld 2.0 (4-stage 3D world pipeline), PartNet/ShapeNet, Blender Pro/AutoRig, 3DGS, OSM 3D City, SceneScript+WFC, VGGT, MusicGen, Muse Voice Transcribe, Mega 3D Hub, Elite Imagination Engine, and Visual QA.
type: project
---

# 3D Asset, World, Audio & Voice Generation Tools (Full Potential Reference)

## 1. First-Class MCP Server (`studio-3d-tools`)

Registered in `~/.config/muse/settings.json` (`src/tools/studio_3d_mcp_server.py`), exposing **18 native MCP tools**:

- `partnet_shapenet_build`: Inspect or synthesize multi-part CAD-accurate `.glb` assets from PartNet part-hierarchies & ShapeNet metric dimensions (`bazaar_stall`, `sports_car`, `commercial_building`, `streetlamp`).
- `blender_pro_generate`: Run Blender 3.4 built-in & procedural generators (`sapling_tree` oak/pine/willow, `arch_building` multi-floor Archimesh building, `landscape` canyon/mountain/hills, `jalebi_spiral_stack` Sverchok/Sorcar parametric coiled pyramid on brass platter, `carved_brick_arch` Erindale-style Lucknow/Mughal brick arch).
- `blender_autorig_animate`: Auto-rig a 3D mesh (`--in`) or synthesize an articulated humanoid NPC (`shopkeeper`, `runner`, `guard`) with a 7-bone Blender `Armature` skeleton (`root`, `spine`, `head`, `arm_L`, `arm_R`, `leg_L`, `leg_R`) and bake 3 keyframe NLA animation clips (`Idle`, `Walk`, `Wave`) ready for `THREE.AnimationMixer`.
- `depth_to_gaussian_splat`: Back-project a 2D image + Depth Anything V2 depth map into 3D space and export a 32-byte binary `.splat` (and optional `.ply`) for `WorldRealism.loadGaussianSplat(url, onLoaded, options)`.
- `generate_game_audio`: Synthesize 44.1 kHz 16-bit PCM `.wav` game audio stems (`bazaar_ambience.wav`, `jalebi_sizzle.wav`, `footstep_stone.wav`, `collect_chime.wav`, `impact_crash.wav`) into `public/assets/audio/`.
- `meta_musicgen_generate`: Generate real 32 kHz AI music & soundscapes from a text prompt using Meta's official AudioCraft `facebook/musicgen-small` (300M parameter neural model).
- `osm_real_world_city_3d`: Extrude a real-world 3D city/bazaar district `.glb` from OpenStreetMap building footprints, heights, roads, parks, and waterways (`lucknow_hazratganj`, `monaco_harbor`, `tokyo_shibuya`, `nyc_times_square`).
- `objaverse_inspect_3d`: Search Objaverse-XL / LVIS 10M+ 3D models and inspect real artist mesh/node/material hierarchies.
- `blenderkit_search_free`: Search BlenderKit's free 3D models, PBR materials, and HDRIs with exact metric dimensions and face counts.
- `fetch_cc0_pbr_or_model`: Download 100% free CC0 photogrammetry 3D models or 1K PBR texture sets from Poly Haven (`fetch_polyhaven.py`) or ambientCG (`fetch_ambientcg.py`).
- `scenescript_wfc_build`: Compile Meta SceneScript architectural DSL (with real `manifold3d` CSG boolean door/window openings) or Wave Function Collapse (WFC) 3D courtyard/city grids into a multi-material `.glb`.
- `meta_vggt_reconstruct`: Reconstruct a 3D metric surface mesh (`.glb`) from an image using Meta VGGT-1B on Modal GPU (`--backend modal`) with automatic local Depth-Anything-V2 + Delaunay 3D mesh fallback (`--backend local`).
- `gltf_transform_optimize`: Optimize any `.glb` 3D model using `@gltf-transform/core` + `@gltf-transform/functions` (dedup, weld, prune, center pivot).
- `run_visual_qa_gate`: Run `node src/verifier/visual_qa_gate.js` on `public/live-preview`.
- `meta_voice_transcribe`: Transcribe spoken voice prompts or game audio clips into text using Meta's official `muse-voice-transcribe-1.0` model (`POST /v1/asr/transcribe` and `muse voice transcribe`).
- `mega_3d_hub_search_and_fetch`: Search & download CC0/free `.glb` 3D models across 825,000+ assets (Smithsonian Open Access 3D Laser Scans, Khronos Official glTF Showcase, Polyhaven, BlenderKit).
- `elite_imagination_engine`: Generate Hitman clockwork stealth/distraction + Resident Evil multi-step puzzle + Hello Neighbor 2 adaptive AI & 12 micro-detail layer blueprints via Meta Muse Spark Open.
- `meta_world_2_generate`: Run the **MetaWorld 2.0 — 4-Stage Navigable 3D World Pipeline** (`src/tools/meta_world_2_pipeline.py`): Stage I Panorama/Seed (`muse-image-1.0`) -> Stage II `WorldNav` (`sam-3.1` landmarks `objects.json` + BFS-verified NavMesh `navmesh.json` + 5 collision-checked trajectory modes: `Regular`, `Surrounding`, `Reconstruct-Aware`, `Wandering` via Dijkstra farthest-node, and `Aerial`) -> Stage III `WorldStereo` depth + 6D Plücker rays + stereo novel views -> Stage IV `WorldMirror` (`facebook/VGGT-1B` surface `.glb` + MaskGaussian-pruned 3DGS `.splat` + SceneScript/WFC watertight collision `.glb` + `metaworld2_manifest.json` for `WorldRealism.enableMasterpieceRendering`).

## 2. Direct CLI Commands (Equivalents)

- **PartNet + ShapeNet Blueprint & Builder**:
  `python3 src/tools/partnet_shapenet_blueprint.py --query "bazaar stall" --generate-bpy --out public/assets/custom/bazaar_stall.glb`
- **Blender Pro Generators (Sapling Tree / Archimesh Building / A.N.T. Landscape / Sverchok Jalebi Stack / Erindale Carved Brick Arch)**:
  `python3 src/tools/blender_pro_builder.py --type sapling_tree --preset oak --out public/assets/custom/tree_oak.glb`
  `python3 src/tools/blender_pro_builder.py --type arch_building --floors 3 --width 10 --depth 8 --out public/assets/custom/building_3f.glb`
  `python3 src/tools/blender_pro_builder.py --type landscape --preset canyon --out public/assets/custom/terrain_canyon.glb`
  `python3 src/tools/blender_pro_builder.py --type jalebi_spiral_stack --count 40 --out public/assets/custom/jalebi_stack.glb`
  `python3 src/tools/blender_pro_builder.py --type carved_brick_arch --out public/assets/custom/lucknow_arch.glb`
- **Blender Auto-Rig & Walk/Idle/Wave Keyframe Animation Baker**:
  `python3 src/tools/blender_autorig_animate.py --preset shopkeeper --out public/assets/custom/npc_animated.glb`
- **2D + Depth Anything V2 → 3D Gaussian Splatting (`.splat` / `.ply`)**:
  `python3 src/tools/depth_to_gaussian_splat.py --image storage/.uploads/sunrise_valley.jpg --depth /tmp/opencode/sunrise_depth.png --out public/assets/custom/sunrise_valley.splat`
- **Procedural Game Audio WAV Generator**:
  `python3 src/tools/generate_game_audio.py --all`
- **OpenStreetMap Real-World 3D City/Bazaar Extruder**:
  `python3 src/tools/osm_city_3d.py --preset lucknow_hazratganj --radius 200 --out public/assets/custom/lucknow_bazaar.glb`
- **Objaverse Structure Inspector**:
  `python3 src/tools/search_objaverse.py --query "car" --limit 3`
- **BlenderKit Free Search**:
  `python3 src/tools/fetch_blenderkit.py --query "sports car" --type model --limit 3`
- **Poly Haven & ambientCG CC0 Fetchers**:
  `python3 src/tools/fetch_polyhaven.py boulder_01 --type model --res 1k`
  `python3 src/tools/fetch_ambientcg.py --query Bricks075 --limit 1`

## 3. Auto-Enabled Blender 3.4 Precision & Hard-Surface Addons

Configured in `/home/opencode/.config/blender/3.4/scripts/startup/enable_pro_addons.py`:

- `add_curve_sapling` (Sapling Tree Generator), `archimesh` (Architectural rooms/doors/windows/columns/roofs), `ant_landscape` (A.N.T. Landscape), `add_mesh_BoltFactory` (exact metric screws/bolts), `mesh_tiny_cad` (CAD vertex intersection/circle/bisect), `object_boolean_tools` (BoolTool non-destructive booleans), `mesh_looptools`, `mesh_f2`, `measureit`, `node_wrangler`.
- `scenescript_wfc_build` (`python3 src/tools/scenescript_wfc_world.py --mode scenescript|wfc --out public/assets/custom/world.glb`): Meta SceneScript architectural DSL compiler (with real `manifold3d` CSG boolean door/window cutouts) + Wave Function Collapse (WFC) 3D courtyard/city generator.
- `meta_vggt_reconstruct` (`python3 src/tools/meta_vggt_scene.py --image <img.jpg> --out public/assets/custom/vggt_scene.glb`): Feed-forward 3D surface mesh reconstructor from single/multi-view images + depth.
