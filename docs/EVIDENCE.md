# Evidence — verifiable artifacts from live runs

All items below were produced by the pipeline and tools in this repo and can be
re-checked against the live VM (`https://spurcode.duckdns.org`) or via local CLI commands.

## 1. Backend health & capabilities (live)

`GET https://spurcode.duckdns.org/api/studio/health` returns:

```json
{
  "ok": true,
  "service": "agentic-game-studio-backend",
  "components": {
    "museCodeCLI": true,
    "cliModel": "muse-spark-1.3",
    "cliProvider": "meta-model-api",
    "metaKeyPresent": true,
    "plannerModel": "meta-models/muse-spark-open-1026",
    "plannerProvider": "baseten",
    "basetenKeyPresent": true,
    "terrain": "procedural elevation grid",
    "engines": ["threejs-webgl", "unity-csharp"]
  }
}
```

`GET https://spurcode.duckdns.org/api/studio/capabilities` returns **26 validated agent skills** in `.agents/skills/` (including `game-system-design`, `obra-subagent-driven-development`, `obra-dispatching-parallel-agents`, `threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting`, `game-feel`, `unity-build`, `godot-web`), registered MCP servers (`studio-3d-tools`, `context7`), and the allowlisted Meta CLI models (`muse-spark-1.3`, `muse-wonder-1.0`, `muse-spark-1.2`, `muse-spark-1.1`).

## 2. Full public SSE run (unedited summary)

Prompt: `"Signal garden exploration with scattered beacons"`

Event counts over `POST /api/studio/generate` (public gateway):
`start 1 · spec 1 · reasoning 5 · cli 5 · phase 16 · proof 3 · artifact 1 · log 12 · done 1`

Final event:

```json
{
  "type": "done",
  "ok": true,
  "gameId": "game_1793194475264_81152d",
  "playUrl": "/studio/games/game_1793194475264_81152d/index.html",
  "title": "Signal Garden Exploration With",
  "unitySource": "muse-cli",
  "elapsedMs": 19113
}
```

`unitySource: "muse-cli"` means the stored `AgenticPlayerController.cs`
was written by the Muse Code CLI on the VM in that run (not the template).

Play it: https://spurcode.duckdns.org/studio/games/game_1793194475264_81152d/index.html

## 3. Muse Wonder design output (structured JSON, real call)

Prompt: `"Low gravity lunar rover with slow floaty jumps"` →

```json
{
  "title": "Lunar Rover Orb Run",
  "biome": "cyber-orbital",
  "gravity": -6,
  "playerSpeed": 11,
  "jumpVelocity": 8,
  "objective": "Drive the lunar rover with WASD or touch joystick to collect all glowing orbs across the orbital moon base."
}
```

These numbers flow into the generated game's physics and the QA gate.

## 4. Cache proof (zero credits on repeat)

A repeated prompt logs:

```
Design cache hit: Wonder/Baseten skipped, zero credits used.
Concept art cache hit: image API skipped, zero credits used.
Unity code cache hit: Muse CLI skipped, zero credits used.
```

Verified end-to-end in 26 ms with all QA proofs passing.

## 5. Tests & QA Gates

- **Unit & Physics QA Suite (`npm test`)** — **9/9 passing**: CLI JSONL reducer (4), deterministic layout, BFS reachability (including a winnable-layout assertion), safety shield, runtime spec embedding.
- **Hard Visual QA Gate (`node src/verifier/visual_qa_gate.js public/live-preview`)** — **PASS**: verifies zero primitive box/cone fakes, active `GLTFLoader` `.glb` usage, 3D wind-swaying grass blades, CSP compliance, and `ACESFilmicToneMapping`.

## 6. Complete Meta AI Stack (10 Verified Models & Tools — One-Line Proof Each)

1. **Safety screen** — `SafetyShieldValidator` in `src/pipeline/safety_shield.js` is a local banned-keyword list; it makes zero network calls (covered by `npm test`: `"safety shield flags restricted terms and sanitizes"`).
2. **Muse Wonder 1.0 (`muse-wonder-1.0`)** — `MetaWonderClient` in `src/agent/meta_wonder.js` POSTs `muse-wonder-1.0` to `https://api.meta.ai/v1/responses`; repeat prompts hit `storage/cache/spec_<hash>.json`.
3. **Muse Spark Open 1026 (`meta-models/muse-spark-open-1026`)** — `BasetenMuseClient` in `src/agent/baseten_muse.js` and `src/tools/npc_dialogue.js` POSTs `meta-models/muse-spark-open-1026` to `https://inference.baseten.co/v1/chat/completions`.
4. **Muse Image 1.0 (`muse-image-1.0`)** — `MetaImageClient` in `src/pipeline/meta_image.js` and `src/tools/make-image.js` POSTs `muse-image-1.0` to `https://api.meta.ai/v1/images/generations` (and `/v1/images/edits`).
5. **Muse Spark 1.3 via Muse Code CLI (`muse-spark-1.3`)** — `AgentRunner.runMuseCLI` in `src/agent/agent_runner.js` spawns `muse exec --provider meta --model muse-spark-1.3 --json`, and `src/server.js` hosts the live interactive `muse` session with `.agents/memory/` and 26 skills.
6. **Muse Voice Transcribe 1.0 (`muse-voice-transcribe-1.0`)** — `src/tools/meta_voice_transcribe.js` POSTs mono 16 kHz s16le WAV to `https://api.meta.ai/v1/asr/transcribe` (and supports `~/.local/bin/muse voice transcribe <FILE>`). Verified live response:
   ```json
   {
     "ok": true,
     "backend": "meta-asr-api",
     "model": "muse-voice-transcribe-1.0",
     "sessionId": "voyager/transcribe/26BFCD904BDE4E75BAB56DA3DD7E778A",
     "transcript": "zero.",
     "audioDurationMs": 720,
     "turns": []
   }
   ```
7. **SAM 3.1 (`sam-3.1`)** — `src/tools/segment_image.py` POSTs model `sam-3.1` to `https://api.meta.ai/v1/responses` (SSE stream) and caches wire output at `storage/.uploads/<stem>_wire_<concept>.txt` (`--reuse-wire` replays with zero API calls).
8. **SAM 3D Objects (`SAM3DObjects.reconstruct`)** — `src/tools/modal_call_3d.py --backend sam3d` calls Modal GPU app `spurcode-sam3d-objects` (verified in `docs/evidence-sam3d/`: `trial3` & `trial4` exit 0 with valid `.glb` outputs).
9. **Meta VGGT-1B (Visual Geometry Grounded Transformer)** — `src/tools/meta_vggt_scene.py --backend modal` runs `facebook/VGGT-1B` on Modal GPU (`spurcode-vggt-3d`) to reconstruct a metric 3D surface mesh with UV colors (`public/assets/custom/vggt_modal_gpu_scene.glb`, 11,264 vertices, 22,020 faces), with automatic local Depth-Anything-V2 + Delaunay 3D mesh fallback (`--backend local`).
10. **Meta MusicGen (`facebook/musicgen-small`) & Meta SceneScript DSL** — `src/tools/meta_musicgen_audio.py` runs Meta's 300M-parameter neural AudioCraft model (`facebook/musicgen-small`) to generate 32 kHz `.wav` soundtracks (`public/assets/audio/musicgen_theme.wav`), and `src/tools/scenescript_wfc_world.py` compiles Meta SceneScript architectural commands (`make_wall`, `make_door`, `make_window`) with real `manifold3d` CSG boolean cutouts into `public/assets/custom/scenescript_bazaar.glb`.

## 7. 15 Native MCP Tools (`src/tools/studio_3d_mcp_server.py`)

Sending JSON-RPC `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` to `python3 src/tools/studio_3d_mcp_server.py` returns **15 tools**:

1. `partnet_shapenet_build` (`src/tools/partnet_shapenet_blueprint.py`)
2. `blender_pro_generate` (`src/tools/blender_pro_builder.py` — Sapling Tree, Archimesh, A.N.T. Landscape, Sverchok Jalebi Spiral Stack, Erindale Carved Brick Arch)
3. `blender_autorig_animate` (`src/tools/blender_autorig_animate.py` — 7-bone Blender Armature + `Idle`/`Walk`/`Wave` NLA clips in `public/assets/custom/npc_shopkeeper_animated.glb`)
4. `depth_to_gaussian_splat` (`src/tools/depth_to_gaussian_splat.py` — 32-byte `.splat` in `public/assets/custom/sunrise_valley.splat`)
5. `generate_game_audio` (`src/tools/generate_game_audio.py` — 5 PCM `.wav` stems in `public/assets/audio/`)
6. `meta_musicgen_generate` (`src/tools/meta_musicgen_audio.py` — `facebook/musicgen-small` 32 kHz `.wav`)
7. `osm_real_world_city_3d` (`src/tools/osm_city_3d.py` — OpenStreetMap 3D city extruder)
8. `objaverse_inspect_3d` (`src/tools/search_objaverse.py` — Objaverse-XL / LVIS hierarchy inspector)
9. `blenderkit_search_free` (`src/tools/fetch_blenderkit.py` — BlenderKit free 3D/PBR/HDRI search)
10. `fetch_cc0_pbr_or_model` (`src/tools/fetch_polyhaven.py` & `src/tools/fetch_ambientcg.py`)
11. `scenescript_wfc_build` (`src/tools/scenescript_wfc_world.py` — Meta SceneScript CSG + WFC 3D world builder)
12. `meta_vggt_reconstruct` (`src/tools/meta_vggt_scene.py` — Meta VGGT-1B Modal GPU + local fallback)
13. `gltf_transform_optimize` (`src/tools/gltf_optimize.js` — `@gltf-transform` dedup/weld/prune/center)
14. `run_visual_qa_gate` (`src/verifier/visual_qa_gate.js`)
15. `meta_voice_transcribe` (`src/tools/meta_voice_transcribe.js` — `muse-voice-transcribe-1.0` `/v1/asr/transcribe` & `muse voice transcribe`)
