---
name: game-pipeline
description: Build a complete playable 3D browser game in this workspace. Use whenever the user asks to build, modify, render, or preview a game or 3D model. Owns the full multi-file game structure, the deterministic pipeline tool, and the live-preview handoff.
license: MIT
metadata:
  version: "1.0.0"
  author: "Agentic Game Studio"
---

# Game Pipeline — Complete 3D Browser Game Builder

You are inside the Agentic Game Studio live terminal. The user's browser has TWO panes:

- **Left:** this terminal (you).
- **Right:** the Game Preview iframe, which serves `public/live-preview/index.html` and auto-reloads whenever you save files there.

## When to Use This Skill

- User asks to **build / make / create a game** → full pipeline below.
- User asks to **modify / fix / add a feature** to the game → edit files in `public/live-preview/`, save, preview auto-reloads.
- User asks to **render / preview an uploaded 3D model** (`.glb` in `storage/.uploads/`) → write a viewer into `public/live-preview/`.
- User only asks a question or runs `/mcp`, `/usage`, `/help` → do NOT touch `public/live-preview/`.

## Step 1 — Fast Path: Run the Deterministic Pipeline Tool

For a fresh game from a text prompt, prefer the pipeline tool over hand-writing everything. It runs safety check → Wonder/Baseten design → terrain + layout → Three.js files → Unity C# → physics QA → library save → copies into `public/live-preview/`:

```bash
node src/tools/build-game.js --prompt "a desert rover rally with 3 jump ramps and 12 beacons"
```

- Takes ~30–90s (Wonder + Baseten + Image API calls). Reuses `storage/cache/` on repeat prompts (0 credits).
- On success it prints `PREVIEW_READY public/live-preview/index.html` — the right pane picks it up automatically within ~2s. Just tell the user it's ready.
- If the tool fails (API down), fall back to Step 2 and hand-write the files.

## Step 2 — Hand-Written Multi-File Game Structure (fallback or edits)

Write these files under `public/live-preview/`. Keep each file focused:

| File         | Owns                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html` | Shell: `#canvas-container`, HUD (`#val-score` etc.), `#banner`, mobile controls. NO inline `<script>` — load scripts at end of `<body>` with `defer` |
| `game.js`    | Boot + game loop + `window` wiring (imports the modules below via separate `<script>` tags in dependency order, or a single file if small)           |
| `player.js`  | Movement, jump (with coyote-time), acceleration/friction                                                                                             |
| `enemies.js` | Patrol/chase state machine, damage + knockback                                                                                                       |
| `levels.js`  | Level defs: spawn, obstacles, orb positions, difficulty curve                                                                                        |
| `ui.js`      | Menu → playing → paused → game-over, HUD updates, tutorial hints                                                                                     |
| `audio.js`   | WebAudio synth: jump/pickup/hit SFX + simple music loop + mute                                                                                       |
| `story.js`   | Title, objective text, intro cards / NPC dialogue lines                                                                                              |
| `vfx.js`     | Pickup particle bursts, trails, screen-shake                                                                                                         |
| `save.js`    | Best score + settings in `localStorage`                                                                                                              |

Minimum viable game MUST have: state machine (`menu/playing/paused/over`), player + follow camera, collectibles + score + win trigger, HUD, keyboard + touch input, restart flow.

## Hard Rules (CSP + Preview)

1. **NEVER** inline `<script>...</script>` or `onclick=` in `index.html` — the reverse proxy sends `Content-Security-Policy: script-src 'self'` and blocks inline scripts.
2. Load order at end of `<body>`: `<script src="/studio/vendor/three.min.js" defer></script>` then your files with `defer`.
3. Guard DOM access: `document.getElementById('canvas-container') || document.body`.
4. Uploaded files in `storage/.uploads/<name>` are served at `/studio/uploads/<name>` — reference that URL from game code.
5. For `.glb` without a loader: parse the `GLB` magic (`0x46546C67`) chunks into `THREE.BufferGeometry`/`THREE.MeshStandardMaterial` directly, or extract meshes to `model_data.js` with a quick `node`/`python3` script. No external CDN scripts — only local `/studio/vendor/` and relative `./` files.

## Before You Say "Done"

- [ ] `node --check public/live-preview/game.js` passes (and every other JS file you wrote).
- [ ] No inline `<script>` blocks in `index.html` (`grep -c '<script>'` excluding `src=` should be 0).
- [ ] Game shows a recognisable scene, player moves, orbs/enemies behave, win/lose reachable.
- [ ] Tell the user what was built + controls in 2–3 lines. Keep it short.
