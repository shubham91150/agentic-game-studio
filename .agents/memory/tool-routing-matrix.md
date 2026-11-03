---
name: tool-routing-matrix
description: WHEN -> WHICH POWER -> EXACT COMMAND routing table for game builds (research, Blender kits, PBR, rigging, audio, verification). Auto-appended to build prompts by enrichStudioPrompt.
type: project
---

# Tool Routing Matrix (WHEN → WHICH POWER → EXACT COMMAND)

Every build/create/upgrade/fix request routes through these stages IN ORDER.
Never skip a stage that applies. `studio.js` sends `scope` + `skills` with
every prompt; the server appends the matching directive automatically.

| WHEN | WHICH POWER | EXACT COMMAND / PATH |
|---|---|---|
| Stage 0 — any new game/feature request: deep research first | Gameplay research + Muse Wonder 1.0 design + Muse Image 1.0 reference art + system-design corpus | `src/agent/muse_wonder.js` (Wonder architect) · `node src/tools/make-image.js --prompt "..."` (reference art) · `docs/game-system-design/01-architecture-patterns.md` … `05-genre-system-blueprints.md` |
| Stage 1 — world / architecture / city / dungeon | Custom Blender 3.4 `.glb` kit + 1K PBR textures + PolyHaven scans | `blender -b --factory-startup --python-exit-code 1 -P src/tools/<kit>.py` · `python3 src/tools/blender_pro_builder.py --type <sapling_tree\|arch_building\|landscape>` · `python3 src/tools/scenescript_wfc_world.py` · `python3 src/tools/osm_city_3d.py` (real cities) · `python3 src/tools/fetch_ambientcg.py <Bricks075\|Wood096\|…>` · `python3 src/tools/fetch_polyhaven.py <id> --type model --res 1k` |
| Stage 2 — props / furniture / vehicles | PartNet anatomy + free 3D libraries + local model index | `python3 src/tools/partnet_shapenet_blueprint.py --generate-bpy` · `python3 src/tools/fetch_blenderkit.py` · `python3 src/tools/search_objaverse.py --query "<asset>"` · `/studio/assets/models/index.json` (`WorldRealism.loadGlbModel`) |
| Stage 3 — characters / enemies / NPCs | SAM 3.1 segmentation + 20-bone Armature rig + baked cycles + mixer playback | `python3 src/tools/segment_image.py` (SAM 3.1 quadrants) · `python3 src/tools/blender_autorig_animate.py` (20-bone Armature + SkinnedMesh + baked Idle/Walk) · `THREE.AnimationMixer` in `enemy.js` / viewer |
| Stage 4 — audio & dialogue | MusicGen AI stems + NPC dialogue lines | `python3 src/tools/meta_musicgen_audio.py` (stems → `public/assets/audio/`) · `node src/tools/npc_dialogue.js --character "<npc>" --world "<place>" --lines 5` (Baseten `muse-spark-open-1026`) |
| Stage 5 — verification | Parallel critics + QA gates + headless browser proof | `subagent_spawn` + `subagent_wait` (fresh critic) · `node --check <file>` · `node src/verifier/visual_qa_gate.js public/live-preview` (MUST PASS) · `node src/verifier/physics_qa_gate.js` · headless Chromium (`~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome --headless=new --no-sandbox --disable-dev-shm-usage --screenshot=...`) |

## Rules

1. Research (Stage 0) runs BEFORE any code or asset on every new request.
2. One consistent art lane per game (all photoreal PBR or all stylized) —
   check `.agents/memory/` + reference images before fetching assets.
3. Licensed sources only (CC0/MIT/Apache); credit each asset in one line.
4. No terminal/pipeline step is "done" until Stage 5 gates print PASS.
