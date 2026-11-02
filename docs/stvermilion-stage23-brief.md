# Ashes of St. Vermilion — Stage 2 + 3 Build Brief (Agent Directive)

> **Status:** Stage 1 (world blockout + player + torch + key→chapel door) is LIVE in `public/live-preview/` and verified. Build Stage 2 + Stage 3 ON TOP of it. Do NOT rewrite Stage 1 files from scratch — extend them.

## Goal

"Ashes of St. Vermilion" ko ek COMPLETE khelne-layak horror game banao:

- **Stage 2:** Mother Agatha — ek AI-driven enemy nun jo player ko hunt karti hai (pathfinding + line-of-sight + hearing), uski gun-gunahat (NPC dialogue tool se generated voice lines) corridors me goonjti hai, aur uska real 3D model (SAM 3D Objects / VGGT / Blender Pro se).
- **Stage 3:** Lose state — agar Agatha player ko pakad le to GAME OVER. Full game loop: menu → playing (survive + find key + escape) → stageclear (chapel door khola) OR gameover (caught). Restart without page reload.

## Use EVERYTHING you have (judge ne bola: "tooling score = what's IN the app")

1. **Meta Model API (5 lines):**
   - `muse-wonder-1.0` — high-reasoning game design (Agatha ke behaviour tree, level pacing, horror beats) via `src/agent/muse_wonder.js`.
   - `muse-image-1.0` — Agatha ki concept art / texture (ref-stvermilion-nun.webp se inspired) via `src/pipeline/meta_image.js`.
   - `sam-3.1` — Agatha model ke liye reference image segmentation (`src/tools/segment_image.py`).
   - `muse-voice-transcribe-1.0` — Agatha ki gun-gunahat ke liye ASR-driven ambient voice layer (`src/tools/meta_voice_transcribe.js`).
   - `muse-spark-1.3-contributor` — tum khud (code generation) — already running.
2. **Meta Open-Weight Models:**
   - `meta-models/muse-spark-open-1026` (Baseten) — Agatha ke dialogue/whisper lines generate karo via `src/agent/baseten_muse.js` + NPC dialogue tool.
   - `facebook/sam-3d-objects` (Modal `spurcode-sam3d-objects`) — Agatha ka hero 3D `.glb` model reference image se (`src/tools/modal_call_3d.py --backend sam3d`). Hero asset hai, GPU queue ~87min, sirf Agatha ke liye use karo.
   - `facebook/VGGT-1B` (Modal `spurcode-meta-vggt`) — fast fallback 3D reconstruction agar SAM 3D queue lamba ho.
   - `facebook/musicgen-small` (local) — tension/stalker music stem via `src/tools/meta_musicgen_audio.py`.
3. **15 Native MCP Tools (`studio-3d-tools`):** NPC dialogue, SAM 3D, VGGT, MusicGen, Voice Transcribe, Blender Pro builder, PartNet/ShapeNet, OSM, Objaverse, BlenderKit, etc. — sab already tumhare settings.json me registered hain.
4. **26 Skills:** `game-pipeline`, `game-logic`, `game-system-design`, `obra-subagent-driven-development`, `3d-web-experience`, `threejs-*`, `game-feel`, `ui-taste`, `frontend-design` — sab load hain.
5. **Reference images:** `storage/.uploads/ref-stvermilion-world.webp`, `ref-stvermilion-nun.webp`, `ref-stvermilion-material.webp` (teal shadows + amber lantern glow, cartoon-horror + semi-realistic).
6. **Existing arch doc:** `docs/stvermilion-arch.md` (topology, interfaces, light budget, props, state machine) — READ it first, interfaces (`window.StV_*`) KOPI rakhna.

## Hard Rules (game-pipeline skill + AGENTS.md)

- `public/live-preview/` me SIRF yeh game. Multi-file: `levels.js`, `game.js`, `player.js`, `audio.js`, `ui.js`, `story.js`, `vfx.js`, `save.js`, + naya `enemy.js` (Agatha).
- CSP: ZERO inline `<script>`, ZERO `onclick=`. Sab JS external + `defer`. Vendor: `/studio/vendor/three.min.js`, `GLTFLoader.js`, `world_realism.js`.
- QA gate (`node src/verifier/visual_qa_gate.js public/live-preview`) MUST PASS 100%: (1) GLTFLoader + ≥1 `.glb` URL; (2) ≤3 TOTAL `BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry` across ALL game JS — PlaneGeometry + PBR only for architecture; (3) NO `MeshLambertMaterial`; (4) NO `function box(`; (5) ACESFilmicToneMapping; (6) word `grass` MUST NOT appear (interior stage).
- Physics QA gate (`node src/verifier/physics_qa_gate.js`) — Agatha ka pathfinding BFS-reachable hona chahiye, CCD for player.
- `node --check` clean on EVERY JS file.
- `?debug=1` overlay (FPS + XYZ + Agatha state) + `window.game = {scene, player, enemy, warp, win, giveAll}`.
- Stage-by-stage build — har stage preview me visible ho, phir agla stage.
- NO commits (auto-commit watcher handles it). NO dev server runs.

## Stage 2 — Mother Agatha (Enemy AI)

**File: `public/live-preview/enemy.js`** — `window.StV_Enemy = { create(scene, colliders, bounds, player): { update(dt, t, playerState), getState(), reset(), setAlert(level), onCaught(cb) } }`

1. **3D Model:** Agatha ka `.glb` —
   - Pehla try: SAM 3D Objects (`modal_call_3d.py --backend sam3d --image storage/.uploads/ref-stvermilion-nun.webp --out public/live-preview/assets/agatha.glb`) — hero asset, real Meta model.
   - Fallback: VGGT (`--backend vggt`) ya Blender Pro builder se nun figure rig karo (in-house rigging only, NO Mixamo).
   - Last fallback: emissive impostor (capsule + veil plane + floating) — game tootna nahi chahiye.
2. **Behaviour (use `muse-wonder-1.0` se design karo):**
   - States: `PATROL` (waypoints: H1-H6 hiding spots + corridors) → `SUSPICIOUS` (heard noise) → `CHASE` (line-of-sight OR noise > threshold) → `SEARCH` (lost player, check last known pos) → `PATROL`.
   - Hearing: player ka `noiseLevel()` (run = loud, walk = quiet, crouch = silent) se Agatha alert hoti hai.
   - Sight: raycast line-of-sight (player torch ON = easier to spot, crouch behind prop = hidden).
   - Speed: patrol 2.0 m/s, chase 4.5 m/s (player run 5.2, so escape possible but tense).
   - Pathfinding: BFS/A* on collider grid (physics_qa_gate reachable).
3. **Audio (NPC dialogue + MusicGen + Voice):**
   - `baseten_muse.js` se Agatha ki whisper lines generate karo (Hindi: "Kahan chhupa hai...", "Mujhe mil gaya...", "Ruk jaa beta...") — `audio.js` me looped distant whisper layer.
   - `meta_musicgen_audio.py` se stalker tension stem (low drone + heartbeat) — `audio.js` me alert-level pe fade in.
   - `meta_voice_transcribe.js` se ASR-driven ambient (optional polish).
   - Footsteps: heavy nun footsteps chase me, silent patrol me.
4. **VFX:** Agatha ke aas-paas fog dense, chase me camera trauma (`vfx.js addTrauma`), lightning flash uski silhouette reveal kare.
5. **HUD:** `hud-enemy` indicator — Agatha alert state (patrol=green, suspicious=yellow, chase=red) + distance meter. `noise-meter` already hai.

## Stage 3 — Lose State + Full Loop

1. **GAME OVER:** Agatha player ke 0.8m ke andar → `onCaught` fires → state `gameover` → `#gameover` screen (Agatha ka face close-up + "PAKDA GAYA") → Restart/Quit.
2. **Full state machine:** `menu → playing ⇄ paused → stageclear (key + chapel) OR gameover (caught) → menu/playing (restart)`.
3. **Win condition unchanged:** Chapel Key (Classroom B) + Chapel Door open = stageclear. Agatha sirf Stage 2+ me threat hai.
4. **Difficulty:** Agatha ki speed/hearing scalable (Easy/Normal/Hard save me). Default Normal.
5. **Persistence:** `save.js` me best survival time + difficulty + settings.

## Build Order (subagent-driven, obra-subagent-driven-development skill)

- **Subagent A (Design):** `muse-wonder-1.0` se Agatha behaviour tree + horror beat sheet + Stage 2/3 arch extension. Output: `docs/stvermilion-arch-stage23.md`.
- **Subagent B (Agatha 3D + Audio):** SAM 3D / VGGT / Blender se `.glb`, Baseten se dialogue, MusicGen se music. Assets in `public/live-preview/assets/`.
- **Subagent C (enemy.js + audio.js + vfx.js + ui.js + game.js + story.js):** AI, hearing, sight, pathfinding, lose state, HUD, full loop. Extend existing files.
- **Subagent D (QA + Playtest):** `visual_qa_gate` + `physics_qa_gate` + headless Chromium playtest (menu → play → evade Agatha → key → chapel clear; AND caught → gameover). Fix ≤30-line issues, else REJECT with reasons.

## Deliverable

- Stage-by-stage visible in `public/live-preview/` preview.
- Har stage pe: `node --check` all JS + `visual_qa_gate` PASS + screenshot.
- Final: complete playable horror game, Agatha hunting, lose state, full loop, all 5 Meta Model API lines + 4 open-weight models used IN the app.
- Report: what each Meta model did, subagent split, gate outputs, fps, known gaps.
