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

## Step 0 — UI Work: Read ui-taste First

Any change to the studio page (`public/index.html`, `public/app.css`,
`public/studio.js`) or the preview pane: read
`.agents/skills/ui-taste/SKILL.md` first and apply its playbooks.
No generic AI-slop styling — match the existing dark studio system
(obsidian surfaces, 1px borders, mono labels, window-dot headers).

UI skill routing (all under `.agents/skills/`):

- `frontend-design/SKILL.md` — anti-slop visual direction (ground design in
  the game's subject matter, plan-then-critique) for new studio/preview UI.
- `web-design-guidelines/SKILL.md` — QA pass: fetch latest guidelines, then
  review studio/preview code and report findings in `file:line` format.
- `mobile-design/SKILL.md` — touch controls and small-screen layout for the
  preview pane (thumb-zone controls, no hover-only input, 44px+ targets).
- `better-ui/SKILL.md` + `better-interface/SKILL.md` — exact polish values
  (radius = inner + padding, press scale 0.96, transitions not keyframes) and
  the ranked cross-discipline interface review format.
- `3d-web-experience/SKILL.md` — preview-pane WebGL work: Three.js scene
  setup, GLB→web pipeline, loading states, mobile fallback for heavy scenes.

## Step 0b — Engine Work: Delegate to Engine Skills

- Godot game / GDScript / web export → read `.agents/skills/godot-web/SKILL.md` first (binary paths, cybersurge reference, headless export flow).
- Unity C# / project / headless build → read `.agents/skills/unity-build/SKILL.md` first (exporter reuse, license rules, batchmode validation).
- Never write engine boilerplate from memory when a skill owns the workflow.

## Step 0e — 2D Track: Phaser or Godot 2D

When the prompt fits 2D (platformer, puzzle, top-down, cards,
board, match-3, tower-defense on a grid, visual novel), pick ONE engine:

- **Phaser (default for pure 2D):** build scenes with the vendored
  Phaser 3.x (`/studio/vendor/phaser.min.js`, served from
  `src/engine/vendor/phaser.min.js` — CSP forbids CDN scripts, use the
  local vendor path only). Standard shape: `Boot` → `Menu` →
  `Game` scene(s) in `game.js` (+ `levels.js` for level defs when the
  game has more than one level).
- **Godot 2D web export (when the prompt already asks for
  Godot/GDScript, or needs a Godot-only feature):** the
  `.agents/skills/godot-web/SKILL.md` skill owns that path — read it
  first and follow its headless export flow with a 2D project.

2D preview goes to `public/live-preview/` exactly like 3D:
`index.html` (shell, no inline `<script>`, `defer` only) + `game.js`
(boot + loop). Load order at end of `<body>` for a Phaser game:
`<script src="/studio/vendor/phaser.min.js" defer></script>` then
your files with `defer`. Same done-gate as 3D (state machine,
win/lose reachable, keyboard + touch, `node --check` clean).

## Step 0d — Open Design (no genre boxes)

There is NO fixed genre list. ANY game the user describes can be built —
runner, platformer, puzzle, racing, pet sim, rhythm, maze, story adventure,
sports, music, farming, flying, underwater, space — whatever the prompt asks.
Never force a prompt into a template, and never answer "that genre is not
supported". Design from the prompt's own words: goal, rules, win/lose, world,
characters.

The orb-collector runner is just ONE past example, never the default.
Each game reuses the same file architecture and done-gate from
`.agents/skills/game-logic/SKILL.md` — only the rules, level data, and
win/lose conditions change per the user's idea.

BANNED always: war, weapons, military, killing, blood, gore. If the user asks
for any of these, the safety shield sanitizes the theme — build the peaceful
version (e.g. "space battle" → "asteroid dodging courier") and say so in one
line. Never lecture, just build.

## Scope rule: build as big as quality holds

Start bounded (single arena / track / room / island, our `worldBound:72` pattern in `src/pipeline/layout.js`), then scale up freely — multi-arena, connected zones, larger bounds, richer dressing via Blender/SAM3D/Image — as long as fps budgets, the QA gate, and the done-gate pass. The ceiling is QUALITY, not size: grow until perf/playtest says stop, then stop.
Scaling ladder: arena → connected zones → larger bounds; each step up is gated by the fps meter + QA gate (`src/verifier/physics_qa_gate.js`) passing.
Never shrink ambition by default — only scope down when measurements (fps, QA, playtest) demand it. If the user asks open-world, still start bounded, scale toward it, and say in ONE line where the build stands and why (engine + deadline honesty, no lecture).

## Step 0c — Gameplay Code: Obey game-logic Standards

Any gameplay code (loop, controls, camera, enemies, settings, audio,
performance): read `.agents/skills/game-logic/SKILL.md` and follow ALL of it —
fixed timestep, pooled objects, perf budgets, settings screens, done-gate.
Placeholder "box moves" code is a fail. The done-gate playtest is mandatory
before telling the user the game is ready.

## Step 1 — Fast Path: Run the Deterministic Pipeline Tool

For a fresh game from a text prompt, prefer the pipeline tool over hand-writing everything. It runs safety check → Wonder/Baseten design → terrain + layout → Three.js files → Unity C# → physics QA → library save → copies into `public/live-preview/`:

```bash
node src/tools/build-game.js --prompt "a desert rover rally with 3 jump ramps and 12 beacons"
```

- Takes ~30–90s (Wonder + Baseten + Image API calls). Reuses `storage/cache/` on repeat prompts (0 credits).
- On success it prints `PREVIEW_READY public/live-preview/index.html` — the right pane picks it up automatically within ~2s. Just tell the user it's ready.
- If the tool fails (API down), fall back to Step 2 and hand-write the files.

## Step 1b — Game Images (works with ANY active CLI model)

To generate textures, sprites, concept/key art, or skybox images, run:

```bash
node src/tools/make-image.js --prompt "sci-fi power crystal, game key art, no text"
```

- It calls **Meta Muse Image 1.0 directly** with the VM key — independent of the CLI session's active model (Wonder/Spark/anything). Do NOT confuse with the CLI's `--image` flag: that only _attaches_ an image to a prompt, it never _generates_ one.
- Saves a `.webp` into `storage/.uploads/` (served at `/studio/uploads/<file>`) ready to reference from `public/live-preview/` game code, or pass `--out <path>` / `--concept` for a custom path / pipeline cache dir.
- Typical uses: character portraits for `story.js` dialogue cards, HUD icons, ground/sky textures, loading-screen art.

## Step 1c — World-Expansion (depth → warp → Blender-projection tools)

World-expansion (parallax views / relief mesh from a concept image, TOOL ONLY — never the shipped Meta path): depth→warp→Blender-projection chain lives in `src/tools/depth_map.py` → `novel_view.py` → `blender_project.py` (exact commands + timings: `docs/WORLD_PIPELINE.md` §6); use when the user asks for novel views, depth relief, or scene expansion from a flat image, and never route shipped submissions through it.

## Step 1d — NPC Dialogue (Spark Open tool)

NPC lines for `story.js` dialogue cards: `node src/tools/npc_dialogue.js --character "grumpy shopkeeper" --world "desert bazaar" --lines 5 --out dialogue.json` writes a JSON array of `{speaker, line, mood}` via Baseten Muse Spark Open (cheap short-dialogue call, local fallback offline); paste entries into `story.js`, or pair with Step 1b portraits.

## Step 1d — Mesh Cleanup (SAM 3D / generated .glb → game-ready .glb)

Mesh cleanup (dense SAM 3D output, TOOL ONLY — never the shipped Meta path): `src/tools/blender_cleanup.py` headless decimate + merge-doubles + loose-delete + transform-apply (exact command + verified sizes: `docs/WORLD_PIPELINE.md` §7); use when the user asks to clean, decimate, shrink, or game-ready a `.glb` before it ships in a game.

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
2. Load order at end of `<body>`: `<script src="/studio/vendor/three.min.js" defer></script>` then your files with `defer` (3D). For 2D Phaser games: `<script src="/studio/vendor/phaser.min.js" defer></script>` then your files with `defer`.
3. Guard DOM access: `document.getElementById('canvas-container') || document.body`.
4. Uploaded files in `storage/.uploads/<name>` are served at `/studio/uploads/<name>` — reference that URL from game code.
5. For `.glb` without a loader: parse the `GLB` magic (`0x46546C67`) chunks into `THREE.BufferGeometry`/`THREE.MeshStandardMaterial` directly, or extract meshes to `model_data.js` with a quick `node`/`python3` script. No external CDN scripts — only local `/studio/vendor/` and relative `./` files.

## Publish Rule — Hand-Made Games Publish Verbatim (NEVER Regenerate)

Hand-made games (built/fixed by hand in `public/live-preview/` or a rough
folder) publish ONLY via `publish-game.js`, which copies the real files
verbatim into the library — it never regenerates anything:

```bash
node src/tools/publish-game.js --dir <game-folder> --title "<real game title>" [--prompt "<the game idea>"]
# or: npm run asset:publish -- --dir <game-folder> --title "<real game title>"
```

- This copies `index.html` + co-located assets (js/css/png) verbatim into
  `storage/games/<id>/`, writes `manifest.json` in the exact gameStore
  schema, and upserts the `index.json` entry — which feeds the Library drawer.
- `public/live-preview/` holds ONLY the current game (gets overwritten — not a library).
- NEVER publish a hand-made game with `node src/tools/build-game.js`:
  that tool REGENERATES a template orb-collector game from the prompt and
  OVERWRITES the real game (this already destroyed one tic-tac-toe this way).
  Run `build-game.js` ONLY for fresh pipeline-generated ideas, never for a
  game that already exists as files.
- NEVER delete the rough folder until the published game is verified, in this
  order (verify-then-delete):
  1. `GET /api/studio/games` lists the new game, AND
  2. `curl` on its `playUrl` returns 200 with the real game content.
     Only then delete the rough folder (keep workspace clean).

## Before You Say "Done"

- [ ] `node --check public/live-preview/game.js` passes (and every other JS file you wrote).
- [ ] No inline `<script>` blocks in `index.html` (`grep -c '<script>'` excluding `src=` should be 0).
- [ ] Game shows a recognisable scene, player moves, orbs/enemies behave, win/lose reachable.
- [ ] Tell the user what was built + controls in 2–3 lines. Keep it short.
