# Horizon Sprint ENHANCE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use obra-subagent-driven-development to implement this plan task-by-task (Subagents B/C/D per AGENTS.md orchestration rule; Subagent A folded into per-stage research passes).

**Goal:** Enhance the existing Horizon Sprint 3D racing game (game feel, audio, HUD, visuals) without breaking 60fps or the visual QA gate.

**Architecture:** Enhance in place under `public/live-preview/` (multi-file: `game.js`, `player.js`, `vfx.js`, `audio.js`, `ui.js`, `index.html`); no rebuild, no new folders; each stage preview-visible before the next starts.

**Tech Stack:** Three.js r128 (`/studio/vendor/three.min.js` + `GLTFLoader.js` + `world_realism.js`), WebAudio synth, CSP-safe external scripts only.

**Spec:** user ENHANCE MISSION message 2026-11-01 (sequential plan + skills + research + per-area plan + staged build + QA gate + max 2 Muse Image calls).

## Global Constraints

- CSP `script-src 'self'`: NO inline `<script>` / `onclick=` in `index.html`; all JS in `.js` files with `defer`.
- Real `.glb` + WorldRealism ONLY: no `Box/Cone/Sphere/PlaneGeometry` cars/trees/buildings/grass; no `MeshLambertMaterial`.
- Art lane LOCKED: ALL realistic (golden-hour circuit + `supercar_highpoly.glb`); never mix stylized.
- Credit budget: MAX 2 Muse Image calls (Stage 4 only); everything else Blender bpy + code.
- 60fps target; REMOVE the emergency pixel-ratio floor latch; keep graceful quality auto-drop.
- `node --check` on every touched JS file + `node src/verifier/visual_qa_gate.js public/live-preview` MUST print PASS.
- Skills applied (commit message must name): game-pipeline, game-logic, game-feel, threejs-materials-lighting, threejs-gltf-loading, obra-writing-plans, ui-taste, threejs, browser-game (Standard).

## Current-State Audit (verified in files, 2026-11-01)

| Requested item | Status | File:line evidence |
|---|---|---|
| Engine RPM follows speed | EXISTS basic — needs gears/wobble | `audio.js:96-112` (`62 + speed01*215` + throttle rev + nitro) |
| Tire screech on drift | EXISTS basic — needs slip-pitch | `audio.js:113-116` (bandpass noise, flat gain) |
| Screen shake on collision | EXISTS — needs smoothing (uses per-frame `Math.random`, game-feel bans this) | `game.js:418,634-640` (trauma +0.4, decay 1.6) |
| FOV kick with speed | EXISTS | `game.js:642-644` (`66 + spd01*10 + nitro 6`) |
| Skid marks + dust puffs | EXISTS | `vfx.js` (160 instanced skids, 36 pooled sprites) |
| Tire SMOKE burst on drift | PARTIAL (grey puff only) — needs white smoke burst + initiation pop | `game.js:547-562` |
| Speed lines at high velocity | MISSING | — (new overlay) |
| Camera lean/lag on turns | MISSING (lean/roll; lag exists via lerp 6.5) | `game.js:624-632` |
| Speedometer needle | MISSING (digital number only) | `ui.js:307`, `index.html` `#hud-speed` |
| Lap timer cur/last/best | EXISTS — needs NEW-BEST flash | `ui.js:303-306` |
| Position indicator | EXISTS (`1ST..4TH`) — gap-to-ahead optional add | `ui.js:301` |
| Emergency floor latch | EXISTS — MUST REMOVE per mission | `game.js:100-107` (`emergencyLowT`) |
| PBR road + car paint | EXISTS procedural — 2 image maps to enrich | `levels.js`, `player.js:73-79` |

## Review Focus

- Drift smoke + speed lines must read at 60fps on a mid laptop; if fps < 45 for 3s the graceful auto-drop (not the removed latch) must engage — verify with `?fps=1`.
- Needle + HUD must stay readable at 56px mobile size and honour `prefers-reduced-motion` (no shake/flash/lines).
- Audio changes must stay silent until first user gesture and fully mute-proof (mute = zero output incl. speech/none).
- Image textures ≤1024px, shared materials, draw calls stay <100; no new per-frame `new`.
- Camera roll must never detach look target or clip through track on hairpins.

---

### Stage 1: Game Feel (juice)

**Files:**
- Modify: `public/live-preview/game.js` (camera block ~590-646, collision trauma ~416-420)
- Modify: `public/live-preview/vfx.js` (smoke burst pool, speed-line driver)
- Modify: `public/live-preview/index.html` (CSS-only `#speedlines` overlay + `#flash` reuse)

**Interfaces:**
- Consumes: `player.speed/drifting/nitroActive/angle`, existing `trauma`, `G.VFX.puff/dropSkid`.
- Produces: `G.VFX.smokeBurst(x,y,z,n)`, `G.VFX.setSpeedLines(0..1)`; camera roll `camera.rotation.z += lean`.

- [ ] **Step 1: Replace random-jitter shake with decaying-trauma sin shake** (game-feel pattern 1: `shake=trauma^2`, `sin(t*1.7/2.3)` offsets + roll; tiers: wall hit 0.25 / car hit 0.45 / big crash 0.7).
- [ ] **Step 2: Drift smoke** — white `smokeBurst` on drift initiation + denser trail while `drifting && speed01>0.25`; pooled sprites only.
- [ ] **Step 3: Speed lines (LOW priority)** — radial-edge streak overlay at `spd01>0.7`, full at nitro; implement LAST in stage, cut if fps dips; disabled under `prefers-reduced-motion`.
- [ ] **Step 4: Camera lean + lag** — roll ∝ lateral velocity (max ~4°), extra rear lag ∝ speed; hood cam (mode 2) gets micro-rumble.
- [ ] **Step 5: Hit-stop on impact** — `timeScale=0.05` for 60-100ms on car/wall hits (once per impact, newest owns restore); input still buffers through.
- [ ] **Step 6: Procedural car anim + subtle squash** — wheel spin `rot.x+=v*dt/r`, front steer `rot.y`, body roll `rot.z=-latAcc*k`, suspension spring dip + ≤2% scale ease on landing/drift (physical, never cartoon).
- [ ] **Step 7: Ground truth check** — confirm arcade grip/ground sampling matches 4-raycast-equivalent behaviour; Rapier stays OUT (no debris/ragdolls).
- [ ] **Step 8: Verify** — `node --check` on touched files; playtest: drift shows smoke, crash shakes smooth + hit-stops, lines appear >~150km/h; `?fps=1` stable.

### Stage 2: Audio (RPM + screech)

**Files:**
- Modify: `public/live-preview/audio.js` (`setEngine`, skid chain)
- Modify: `public/live-preview/game.js` (pass `slip` + `gear` into `setEngine`)

**Interfaces:**
- Consumes: `speed01, throttle, drifting, offroad, nitro, racing` + new `slip01` (lateral slide ratio).
- Produces: `setEngine(speed01, throttle, drifting, offroad, nitro, racing, slip01)` with gear-stepped RPM.

- [ ] **Step 1: Gear-stepped RPM** — 5-gear sawtooth: freq ramps within gear then drops ~25% on upshift; add ±3% vibrato + load growl (filter Q bump at full throttle).
- [ ] **Step 2: Slip-pitched screech** — bandpass freq `900 + slip01*1800`, gain ∝ slip; separate soft rumble for offroad.
- [ ] **Step 3: Collision thud tiers + nitro whoosh** — reuse `beep()` noise burst at 90/140Hz by impact; wind gain already speed-squared, add nitro whistle overtone.
- [ ] **Step 4: Verify** — gesture-gated start still works; mute silences all; drive: RPM audibly shifts, drift screams, crash thuds.

### Stage 3: HUD (needle + lap drama)

**Files:**
- Modify: `public/live-preview/index.html` (SVG dial `#speedo` + `#gear`, `#newbest` flash el)
- Modify: `public/live-preview/ui.js` (`updateHUD` ~300-308)

**Interfaces:**
- Consumes: `player.speed/nitro/lap/lastLap/bestLap`, race pos string.
- Produces: needle rotation `-120°..120°` eased (BACK-out on gear shift pop), gear digit, gap text.

- [ ] **Step 1: SVG needle speedometer** — arc dial 0-260 km/h, eased needle (ui-taste craft: tabular numerals kept, 84px→dial hierarchy), redline zone >220; mobile keeps 56px min legibility.
- [ ] **Step 2: Gear indicator + NEW-BEST flash** — gear digit beside dial; `BEST` row pulses gold 1.2s on record (no flash under reduced-motion).
- [ ] **Step 3 (optional, if clean): gap-to-ahead** — `+0.4s` under position; skip if it needs per-frame allocation.
- [ ] **Step 4: Verify** — needle sweeps smoothly 0→max on straight; pause/resume keeps HUD; restart resets best-flash.

### Stage 4: Visuals (2 image maps + mesh check)

**Files:**
- Create: `storage/.uploads/road_detail.webp`, `storage/.uploads/carflake_detail.webp` (≤1024px, served at `/studio/uploads/…`)
- Modify: `public/live-preview/levels.js` (road material overlay), `public/live-preview/player.js` (paint `roughnessMap`/clearcoat-ish env tune)

**Interfaces:**
- Consumes: existing `createProceduralPBRMaterial('asphalt')`, car `MeshStandardMaterial` paint.
- Produces: same materials + `map`/`roughnessMap` overlays; zero new draw calls.

- [ ] **Step 1 (image call 1/2): seamless asphalt detail** — `make-image.js` "top-down seamless asphalt, tire-worn racing line, no text"; justify: procedural asphalt lacks worn-line storytelling.
- [ ] **Step 2 (image call 2/2): paint-flake micro detail** — "dark metallic-flake car paint micro texture, seamless, no text"; justify: flat clearcoat reads toy-like in close chase cam.
- [ ] **Step 3: Blender bpy mesh check** — inspect `supercar_highpoly.glb` (bevels? weighted normals?) via headless bpy; rebuild ONLY if quality bar fails — else code-only material tune.
- [ ] **Step 4: Verify** — close-up chase screenshot shows grain; `visual_qa_gate` still PASS; draw calls <100.

### Stage 5: Perf + QA gate + screenshots

**Files:**
- Modify: `public/live-preview/game.js` (delete `emergencyLowT`/`emergencyApplied` latch ~100-107; keep graceful auto-drop)
- Verify only: all stage files.

- [ ] **Step 1: Remove emergency floor trigger**; confirm graceful `lowT` auto-drop path intact.
- [ ] **Step 2: `node --check` every touched JS file** — must all pass.
- [ ] **Step 3: `node src/verifier/visual_qa_gate.js public/live-preview`** — must print PASS.
- [ ] **Step 4: Playwright screenshot verify** (webapp-testing) — menu, chase drift w/ smoke+lines, needle at speed, results; attach to report.
- [ ] **Step 5: 60s playtest done-gate** (game-logic §9): fps stable, pause→resume→restart ×2, mute persists, win+lose reachable, `?debug=1` overlay sane.

## Build Orchestration (AGENTS.md rule)

Build turns spawn via `subagent_spawn` + `subagent_wait` with strict file ownership:
- **B — World/Visuals** (Stage 4): `levels.js`, `player.js` materials, image maps.
- **C — Feel/Physics/Audio** (Stages 1-3): `game.js` camera, `vfx.js`, `audio.js`, `ui.js`, `index.html` HUD/CSS.
- **D — QA Critic** (Stage 5 + after each stage): QA gate, screenshots, 60fps + done-gate reject/approve.
- **A — Research**: per-stage research passes (game-pipeline Step 0e) precede each stage build; findings shown, user feedback awaited.
