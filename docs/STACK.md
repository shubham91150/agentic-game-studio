# STACK — What We Use, What We Skip, and Why

Honest, judge-readable, Hinglish-friendly inventory. Har claim repo me verified hai —
proof ke saath exact file path aur command diya hai.

## USE (har ek live & verified in repo, proof ke saath)

### A. Complete Meta AI Stack (10 Official Models & Research Pipelines)

- **Muse Wonder 1.0 (design)** — high-reasoning game architect JSON: `src/agent/muse_wonder.js`, `src/agent/meta_wonder.js` (model `muse-wonder-1.0`, `POST https://api.meta.ai/v1/responses`).
- **Muse Spark 1.3 + Muse Code CLI (code & orchestration)** — writes `SPEC.md`, Unity C#, and full Three.js games with multi-subagent (`subagent_spawn`) & `.agents/memory/`: `src/agent/agent_runner.js`, `src/server.js` (model `muse-spark-1.3`).
- **Muse Spark Open 1026 on Baseten (open weights)** — asset-prompt enrichment + NPC dialogue: `src/agent/baseten_muse.js`, `src/tools/npc_dialogue.js` (model `meta-models/muse-spark-open-1026`).
- **Muse Image 1.0 (art + edit)** — concept/key-art + edits: `src/pipeline/meta_image.js` (model `muse-image-1.0`, `/v1/images/generations` & `/v1/images/edits`), CLI via `src/tools/make-image.js`.
- **Muse Voice Transcribe 1.0 (speech-to-text ASR)** — Meta's 5th official Model API product line (`muse-voice-transcribe-1.0`): `src/tools/meta_voice_transcribe.js` (`POST https://api.meta.ai/v1/asr/transcribe` + `~/.local/bin/muse voice transcribe`), auto-resamples WAV to 16 kHz mono s16le.
- **SAM 3.1 (segmentation masks)** — concept-aware segmentation cutouts: `src/tools/segment_image.py` (model `sam-3.1`, SSE `/v1/responses`).
- **SAM 3D Objects on Modal GPU (hero 3D `.glb`)** — single-image to 3D `.glb`, 2 green trials: `src/tools/modal_call_3d.py --backend sam3d` (Modal app `spurcode-sam3d-objects`), evidence in `docs/evidence-sam3d/` (`trial3` + `trial4` EXIT 0, 2 valid `.glb`).
- **Meta VGGT-1B on Modal GPU (`facebook/VGGT-1B`)** — Visual Geometry Grounded Transformer feed-forward 3D surface mesh reconstruction: `src/tools/meta_vggt_scene.py --backend modal` (committed GPU artifact: `public/assets/custom/vggt_modal_gpu_scene.glb`, 11,264 verts / 22,020 faces) + local Depth-Anything-V2 Delaunay fallback (`--backend local`).
- **Meta MusicGen (`facebook/musicgen-small`)** — 300M-parameter AudioCraft neural text-to-music generator (32 kHz `.wav`): `src/tools/meta_musicgen_audio.py`, output at `public/assets/audio/musicgen_theme.wav`.
- **Meta SceneScript DSL + Wave Function Collapse (WFC)** — architectural language (`make_wall`, `make_door`, `make_window`, `make_pillar`) compiled with real `manifold3d` CSG boolean cutouts into watertight `.glb`: `src/tools/scenescript_wfc_world.py` (`public/assets/custom/scenescript_bazaar.glb` & `wfc_courtyard.glb`).

### B. 15 Native MCP Tools (`studio-3d-tools`) & Pro 3D Pipeline

- **MCP Server (`src/tools/studio_3d_mcp_server.py`)** — registered in `~/.config/muse/settings.json`, exposing **15 native MCP tools** to the Muse Code CLI:
  1. `partnet_shapenet_build` (`src/tools/partnet_shapenet_blueprint.py` — 60+ categories from PartNet anatomical part hierarchies & ShapeNet metric dimensions)
  2. `blender_pro_generate` (`src/tools/blender_pro_builder.py` — Blender 3.4 Sapling Tree, Archimesh multi-floor buildings, A.N.T. Landscape, Sverchok jalebi spiral stack, Erindale carved brick arch)
  3. `blender_autorig_animate` (`src/tools/blender_autorig_animate.py` — 7-bone Blender `Armature` auto-rigger + `Idle`/`Walk`/`Wave` NLA keyframe clips for `THREE.AnimationMixer`, `public/assets/custom/npc_shopkeeper_animated.glb`)
  4. `depth_to_gaussian_splat` (`src/tools/depth_to_gaussian_splat.py` — 2D RGB + Depth Anything V2 → 32-byte `.splat` binary `public/assets/custom/sunrise_valley.splat`, loaded via `WorldRealism.loadGaussianSplat`)
  5. `generate_game_audio` (`src/tools/generate_game_audio.py` — 5 procedural 44.1 kHz PCM `.wav` stems in `public/assets/audio/`)
  6. `meta_musicgen_generate` (`src/tools/meta_musicgen_audio.py` — `facebook/musicgen-small`)
  7. `osm_real_world_city_3d` (`src/tools/osm_city_3d.py` — real-world 3D city extruder from OpenStreetMap footprints: `lucknow_hazratganj`, `monaco_harbor`, `tokyo_shibuya`, `nyc_times_square`)
  8. `objaverse_inspect_3d` (`src/tools/search_objaverse.py` — Objaverse-XL / LVIS 10M+ hierarchy inspector)
  9. `blenderkit_search_free` (`src/tools/fetch_blenderkit.py` — BlenderKit free 3D models, PBR materials & HDRIs)
  10. `fetch_cc0_pbr_or_model` (`src/tools/fetch_polyhaven.py` & `src/tools/fetch_ambientcg.py` — Poly Haven & ambientCG CC0 3D/PBR fetchers)
  11. `scenescript_wfc_build` (`src/tools/scenescript_wfc_world.py`)
  12. `meta_vggt_reconstruct` (`src/tools/meta_vggt_scene.py`)
  13. `gltf_transform_optimize` (`src/tools/gltf_optimize.js` — `@gltf-transform` dedup, weld, prune, center pivot)
  14. `run_visual_qa_gate` (`src/verifier/visual_qa_gate.js` — hard ban on box/cone fakes, verifies `GLTFLoader`, 3D grass blades, CSP, `ACESFilmicToneMapping`)
  15. `meta_voice_transcribe` (`src/tools/meta_voice_transcribe.js` — `muse-voice-transcribe-1.0`)
- **11 Auto-Enabled Blender 3.4 Precision Addons** — `/home/opencode/.config/blender/3.4/scripts/startup/enable_pro_addons.py` (`add_curve_sapling`, `archimesh`, `ant_landscape`, `add_mesh_BoltFactory`, `mesh_tiny_cad`, `object_boolean_tools` BoolTool, `mesh_looptools`, `mesh_f2`, `measureit`, `node_wrangler`, `io_scene_gltf2`).
- **26 Agent Skills (`.agents/skills/`)** — includes `game-system-design` (`docs/game-system-design/01..05.md`: ECS, HFSM, Marco Monster Car Physics, Quake/Celeste Controller, Red Blob / SceneScript World Algorithms, 6 Genre Blueprints), `obra-*` parallel subagent skills, `threejs-*`, `game-feel`, `unity-build`, and `godot-web`.
- **Rapier 3D Physics & QA Gates** — self-hosted `@dimforge/rapier3d-compat` 0.21.0 in `src/engine/vendor/`, BFS reachability & CCD zero-tunneling math in `src/verifier/physics_qa_gate.js`, and Visual QA Gate in `src/verifier/visual_qa_gate.js`.

## SKIP + WHY (resource discipline, one line each)

- **Trellis in submission path** — non-Meta (Microsoft), sirf dev-only fallback (`src/pipeline/assets_3d.js`); primary submission 3D backends **SAM 3D Objects** aur **Meta VGGT-1B** (both Meta) hain.
- **Unbounded open-world scale** — bounded high-density zones (`worldBound:72` in `src/pipeline/layout.js` or 200m OSM city blocks in `osm_city_3d.py`) ensure 60 FPS browser performance and deterministic BFS verification.
- **Multi-hour per-scene NeRF training** — instead of slow iterative NeRF optimization, we use feed-forward **Meta VGGT-1B** (`meta_vggt_scene.py`) and instant **Depth-Anything-V2 → 3D Gaussian Splatting** (`depth_to_gaussian_splat.py`, 40,000 splats in <2s).
- **Mixamo external dependency** — removed by design (`commit 2458344`); character rigging and `Idle`/`Walk`/`Wave` NLA keyframe animation baking run 100% in-house via `src/tools/blender_autorig_animate.py`.

## VISION

Har layer — game design (`muse-wonder-1.0`), code orchestration (`muse-spark-1.3` + 26 skills + 15 MCP tools), open-weight enrichment (`muse-spark-open-1026`), concept art (`muse-image-1.0`), voice transcription (`muse-voice-transcribe-1.0`), segmentation (`sam-3.1`), 3D reconstruction (`SAM 3D Objects` + `Meta VGGT-1B`), procedural architecture (`Meta SceneScript` + PartNet/ShapeNet + Blender 3.4), aur neural audio (`Meta MusicGen`) — ek unified, verifiable pipeline me wired hai.
