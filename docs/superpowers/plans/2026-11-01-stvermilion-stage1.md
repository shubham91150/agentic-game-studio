# Ashes of St. Vermilion — Stage 1 (World Blockout + Player + Torch) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use obra-subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ek khelne-layak horror Stage 1: jali-hui convent school ka ek floor (corridors + classrooms + chapel door teaser), first-person ghoomna, torch, Chapel Key pickup = stage-complete.

**Architecture:** Three.js r128 global (`/studio/vendor/three.min.js`) + `GLTFLoader` + `WorldRealism` helpers. Architecture = `PlaneGeometry` walls/floors (gate-allowed) with procedural PBR materials; props = real `.glb` (Polyhaven `Lantern_01`, catalog `barrel/crate/key/chest`). Player = pointer-lock FPS + touch fallback, circle-vs-AABB collision, fixed-timestep loop.

**Tech Stack:** Three.js r128 (global script, NO modules), WebAudio synth, `localStorage`, headless-Chromium/`node --check` verification.

**Spec:** AGENTS.md + `.agents/skills/game-pipeline/SKILL.md` + `.agents/skills/game-logic/SKILL.md`; art refs `storage/.uploads/ref-stvermilion-*.webp` (teal shadows + amber lantern glow, cartoon-horror + semi-realistic light).

## Global Constraints

- `public/live-preview/` holds ONLY this game (old racing WIP stashed in git, library copy safe). Overwrite all old racing files; delete `model_data.js` + stale files.
- CSP: NO inline `<script>`, NO `onclick=`/inline handlers in `index.html`. All JS in external `.js` with `defer`, loaded at end of `<body>`: `/studio/vendor/three.min.js`, `/studio/vendor/GLTFLoader.js`, `/studio/vendor/world_realism.js`, then game files.
- QA gate (`node src/verifier/visual_qa_gate.js public/live-preview`) MUST PASS: (1) `GLTFLoader`/`loadGlbModel` + ≥1 `.glb` URL string in code; (2) ≤3 TOTAL `BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry` occurrences across ALL game JS — build architecture from `PlaneGeometry` + PBR only; (3) NO `MeshLambertMaterial`; (4) NO `function box(`; (5) `ACESFilmicToneMapping` (or `createRealisticSkyAndLighting`) present; (6) word `grass` MUST NOT appear anywhere (no outdoor grass in this interior stage).
- Verify vendor API by READING `src/engine/vendor/world_realism.js` header + `src/engine/vendor/GLTFLoader.js` header first (r128 global style, `THREE.*` globals) — never assume module imports.
- Perf: `min(devicePixelRatio,2)` desktop / `≤1.5` mobile; ONE shadow light (torch spotlight 1024); ≤6 point lights, rest emissive/unlit-impostor; shared geometries/materials; zero `new` in frame loop; 60fps desktop target.
- Look: near-dark corridors, `FogExp2`, lightning flashes through broken windows, amber lantern pools. NO flat colors — every surface PBR (albedo+normal+roughness via `createProceduralPBRMaterial` or `.glb` materials).
- State machine `menu → playing ⇄ paused → stageclear`; ESC/P pause; restart resets state, never reloads page.
- Controls desktop: WASD/arrows move, mouse-look (pointer lock), Shift run (loud), C crouch (quiet), T/F torch, E interact. Touch: left joystick + right-half drag-look + TORCH/CROUCH/INTERACT buttons (44px+).
- `?debug=1` overlay (FPS + XYZ) + `window.game = {scene, player, warp(x,z), win(), giveAll()}`.
- `node --check` clean on every JS file. No commits (user ne commit ko bola nahi).

## Review Focus

- Pointer-lock reject karne par (iframe permissions) game phir bhi khelne-layak rahe (drag-look fallback) — Task 3 test karega.
- `.glb` fail ho (offline/slow) to game toote nahi — fallback emissive impostor + game chalti rahe — Task 2 test karega.
- Mobile par joystick + look-drag ek saath chale, buttons 44px+ — Task 3 test karega.
- Pause → resume → restart do baar clean — Task 3 test karega.
- Quality Low par shadows off + pixelRatio ≤1 — Task 4 test karega.

---

### Task 1: Architecture + Level Topology Spec (Subagent A)

**Files:**
- Create: `docs/stvermilion-arch.md`
- Test: `node -e` structural check (doc contains topology map + interface table + light budget table)

**Interfaces:**
- Consumes: this plan's Global Constraints + art refs.
- Produces: `docs/stvermilion-arch.md` — (1) ASCII/grid topology map with meter dimensions (entrance hall, corridor loop, 2 classrooms, chapel door, hiding spots, key spawn, player spawn); (2) final module interface table (exact `window.StV_*` names from Tasks 2–3); (3) light budget (positions, colors, shadow flags); (4) prop placement list (exact `.glb` URLs); (5) state machine diagram.

- [ ] **Step 1: Read vendor headers** (`src/engine/vendor/world_realism.js` kinds list, `GLTFLoader.js` global name), catalog `public/assets/models/index.json`, polyhaven dir list.
- [ ] **Step 2: Write `docs/stvermilion-arch.md`** (§1 topology map + dims, §2 interfaces, §3 lights, §4 props, §5 states).
- [ ] **Step 3: Verify** — `grep -c` section headers = 5; every `.glb` URL `curl -s -o /dev/null -w` local file exists check.
- [ ] **Step 4: Report** — topology summary + any interface change vs plan (B/C consume final names from this doc).

### Task 2: Shell + World (Subagent B: index.html + levels.js)

**Files:**
- Create (overwrite): `public/live-preview/index.html`, `public/live-preview/levels.js`
- Delete: stale racing leftovers (`model_data.js`, any racing-only JS not owned by Tasks 2–3)
- Test: `node --check public/live-preview/levels.js` + QA gate checks 1,2,4,5 green (check 3 needs all files)

**Interfaces:**
- Consumes: `docs/stvermilion-arch.md` §1/§3/§4 (dims, lights, props); `THREE`, `THREE.GLTFLoader`/`WorldRealism` globals.
- Produces: `window.StV_Levels = { buildWorld(scene): {colliders, spawn{x,z,ry}, bounds, update(dt,t), keyMesh, chapelDoor}, VERSION }` where `colliders` = `[{x0,z0,x1,z1}...]` AABBs, `bounds` = `{x0,z0,x1,z1}`.

- [ ] **Step 1: Write `index.html`** — `#canvas-container`, HUD (`#hud-obj`, `#hud-key`, `#noise-meter`), `#banner`, menus (`#menu`,`#pause`,`#clear`), touch UI (`#joy`,`#btn-torch`,`#btn-crouch`,`#btn-act`), vendor + game scripts `defer` at end of body, dark CSS in `<style>` (allowed — only scripts are CSP-blocked).
- [ ] **Step 2: Write `levels.js`** — PBR corridor/classroom architecture per arch doc, lightning rig, lantern `.glb`s + flicker, key + chapel door, `update(dt,t)` animation, `.glb` failure fallbacks.
- [ ] **Step 3: Verify** — `node --check`; primitive count `grep -cE 'BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry'` = 0 in these files; `.glb` strings ≥3; no `grass` word.
- [ ] **Step 4: Report** — files, draw-call estimate, fallback behavior.

### Task 3: Player + Systems (Subagent C: game/player/audio/ui/story/save/vfx.js)

**Files:**
- Create (overwrite): `public/live-preview/game.js`, `player.js`, `audio.js`, `ui.js`, `story.js`, `save.js`, `vfx.js`
- Test: `node --check` each + headless playtest checklist (boots, moves, torch, pause cycle, key pickup → clear screen)

**Interfaces:**
- Consumes: `window.StV_Levels` (Task 2), arch doc §2/§5, DOM ids from Task 2's `index.html`.
- Produces: `window.StV_Player={create(camera,colliders,bounds):{pos(),update(dt,input),setTorch,setCrouch,noiseLevel}}`; `window.StV_Audio={init(),ambientStart(),thunder(),footstep(run),setVolume,setMuted}`; `window.StV_UI={show(name),setObjective,toast}`; `window.StV_Story={TITLE,INTRO,OBJECTIVES}`; `window.StV_Save={load(),save(s)}`; `window.StV_VFX={create(scene):{addTrauma,flashLightning,update}}`; `window.game` debug handle in `game.js`.

- [ ] **Step 1: Write `story.js` + `save.js`** (content + persistence, smallest first).
- [ ] **Step 2: Write `player.js`** (FPS controller, collision, torch spotlight, noise level, touch input API `setMoveVec/setLookDelta`).
- [ ] **Step 3: Write `audio.js` + `vfx.js`** (rain/thunder synth, footsteps, trauma shake, lightning flash).
- [ ] **Step 4: Write `ui.js` + `game.js`** (screens/HUD wiring, fixed-timestep loop, states, interact key pickup → clear, debug overlay + `window.game`).
- [ ] **Step 5: Verify** — `node --check` all; primitive grep = 0; boot test via headless Chromium screenshot (menu visible, no console errors).
- [ ] **Step 6: Report** — controls table, state transitions verified, known gaps.

### Task 4: Visual QA + Playtest Critic (Subagent D)

**Files:**
- Modify: only small fixes inside `public/live-preview/*.js` (no arch changes; big issues → report back, don't redesign)
- Test: `node src/verifier/visual_qa_gate.js public/live-preview` prints PASS + full playtest (menu → play → key → clear → restart ×2, pause cycle ×2, mobile viewport smoke)

**Interfaces:**
- Consumes: all Task 2–3 files.
- Produces: QA report (gate output, screenshots, fps reading, fix list or REJECT with reasons).

- [ ] **Step 1: Run `node --check` all JS + QA gate; screenshot menu + in-game (desktop + mobile viewport).**
- [ ] **Step 2: Playtest checklist** (move/torch/crouch/run-noise/interact/pause/restart/mute/persist; `?debug=1` FPS+XYZ visible).
- [ ] **Step 3: Fix small fails** (≤30-line edits) or REJECT with file:line reasons.
- [ ] **Step 4: Re-run gate → PASS; report** evidence (gate output, fps, screenshots paths).

## Self-Review

1. Spec coverage: game-pipeline (multi-file, CSP, QA gate, debug) ✓; game-logic (loop, controls, perf, settings, done-gate minus lose — Stage 3) ✓; art refs ✓. Lose/reachable-enemy deferred to Stage 3 (documented).
2. Step scan: each step names one file + one check ✓.
3. Type consistency: `window.StV_*` names identical across tasks ✓ (A confirms final).
4. Review Focus: 5 items mapped to owning tasks ✓.
5. Proportion: plan shorter than the ~1500-line build ✓.
