---
name: game-logic
description: Write real, high-quality browser game logic — not placeholder boxes. Use for any gameplay code: loop, controls, camera, settings, performance. Owns the no-lag standards and the playtest done-gate.
license: MIT
metadata:
  version: "1.0.0"
  author: "Agentic Game Studio"
---

# Game Logic Standards — Real Games Only

A game is NOT done when a box moves. It is done when it **feels right**,
**never lags**, and has **settings + menus**. Follow every section below.
No shortcuts.

## 1. File Architecture (separate files, no 800-line soup)

Filenames below are a recommended shape, not a mandate — adapt, merge,
or rename to fit the game. What matters is separation of concerns and
the quality bars in §2–§8, not exact file names.

| File         | Owns (only this)                                       |
| ------------ | ------------------------------------------------------ |
| `main.js`    | Boot, fixed-timestep loop, state machine transitions   |
| `input.js`   | Keyboard + touch, jump buffering, coyote time          |
| `player.js`  | Movement physics, states (idle/run/jump/hit)           |
| `camera.js`  | Follow, lookahead, shake, bounds clamp                 |
| `enemies.js` | AI state machines (patrol/chase/return), damage        |
| `levels.js`  | Level data, spawn tables, difficulty curve             |
| `ui.js`      | Menu / pause / game-over / settings screens, HUD       |
| `audio.js`   | WebAudio SFX + music + mute, all synthesized           |
| `vfx.js`     | Pooled particles, trails, screen-shake trauma          |
| `save.js`    | localStorage: best score, volume, quality, sensitivity |
| `story.js`   | Title, objective, intro cards, hints                   |

## 2. Game Loop (fixed timestep — never variable-spiral)

- Accumulator loop, fixed `dt = 1/60`, max 3 steps per frame; render each RAF.
- Clamp stray deltas: `dt = min(rawDt, 0.05)`.
- States: `menu → playing ⇄ paused → over`. ESC/P pauses. Restart resets pools + score, never reloads the page.

## 3. Controls (top notch, both platforms)

- Keyboard: WASD + arrows move, Space/W jump, P/Esc pause. Prevent default scrolling on game keys.
- Touch: left-half virtual joystick (vector, dead-zone 0.15), right-side JUMP button (64px+). Show touch UI only on coarse pointers.
- Feel: acceleration + friction (never instant velocity), jump buffering 0.12s, coyote time 0.10s, variable jump height (release = halve upward velocity), terminal fall velocity cap.
- Sensitivity setting scales look/move response 0.5–2.0×.

## 4. Camera

- Lerp follow (position smoothing ~8/s), horizontal lookahead by velocity.
- Screen-shake via trauma value (decays 1.5/s, offset = trauma² × max).
- Clamp inside world bounds; never show outside the level.

## 5. Performance — NO LAG (hard budgets)

- Pixel ratio: `min(devicePixelRatio, 2)` desktop, `≤1.5` mobile; Quality setting Low/Med/High adjusts it + shadows.
- Shadows: ONE directional light, 1024 map; OFF on Low.
- Reuse geometries/materials across instances (share, don't clone per orb).
- Object pools for orbs, particles, enemies — zero `new` in `animate()`.
- Textures ≤1024px; total draw calls <100; prefer InstancedMesh for repeats.
- FPS meter (hidden, rolling 60-frame avg). Auto-drop: fps <45 for 3s → step quality down one notch + log it.
- Target: steady 60fps desktop, 30fps+ low-end mobile.

## 6. Settings + Persistence (every game ships these)

- Pause menu: Resume, Restart, Volume slider, Quality (Low/Med/High), Sensitivity slider, Mute toggle, Reset-save.
- `save.js` key `ags_save_v1`: `{ best, volume, quality, sensitivity }`. Load on boot, apply before first frame.
- Reduced-motion: honor `prefers-reduced-motion` (disable shake + flash).

## 7. Audio (synthesized, zero downloads)

- One shared AudioContext (resume on first gesture). Master gain ← volume setting.
- SFX: jump (sine sweep up), pickup (two-note chime), hit (noise burst + low thud), win (arpeggio). Music: tiny looped sequencer (bass + pad), mutable.

### NPC speech (free, built-in)

- Standard: browser `speechSynthesis` — no downloads, no API key, no infra.
- Helper spec: `speak(line, { rate, pitch })` — pick voice by lang preference list (`en-US` → default voice fallback), `rate` 1.0 default / `pitch` per mood (grumpy: rate 0.9 pitch 0.7; cheerful: 1.1/1.2).
- Always `speechSynthesis.cancel()` before a new line (no overlap).
- Fully gated by existing mute + volume settings (mute = skip speech entirely; voice is audio, so gate on mute only — NOT on `prefers-reduced-motion`).
- Graceful no-op if API missing (older browsers: `if (!('speechSynthesis' in window)) return`).
- Dialogue UI: typewriter text + portrait + voice together (speak on line start, cancel on line skip/close).
- UPGRADE path (RESEARCH, not existing): Meta SeamlessM4T open weights on Modal for real TTS later.

## 8. Done-Gate (playtest before saying done)

- [ ] 60 seconds of play: no jank, fps stable per §5 meter.
- [ ] Every input works: keyboard AND touch (or reason documented).
- [ ] Pause → resume → restart cycle clean, twice in a row.
- [ ] Mute silences everything; settings persist across reload.
- [ ] Win reachable, lose reachable, both show correct screens.
- [ ] `node --check` passes on every JS file; no inline `<script>` in HTML.
