# AGENTS.md

Muse Code reads this file as project rules when it runs in this directory.

## Live Studio Environment (Split-Screen UI)

You are running inside the **Agentic Game Studio** live terminal on the left side of the user's browser screen.
On the **right side** of the user's browser screen is the **Game Preview** iframe.

## Game Building: Read the Skill First

Before building, modifying, or previewing any game or 3D model, read the project skill:

**`.agents/skills/game-pipeline/SKILL.md`**

It owns the full method: when to run the pipeline tool vs hand-write files,
the multi-file structure (`player.js`, `enemies.js`, `levels.js`, `ui.js`,
`audio.js`, `story.js`, `vfx.js`, `save.js`), CSP rules, and the done-checklist.

## Quick Reference

### Render Anything in the Right-Side Game Preview Pane

Whenever the user asks you to build a game, modify a game, or render/preview an uploaded 3D model (`.glb` / `.gltf` / image in `storage/.uploads/`):

1. **Fresh game from a prompt (preferred):** run the deterministic pipeline tool —
   `node src/tools/build-game.js --prompt "<user idea>"`.
   It runs safety → Wonder/Baseten design → terrain+layout → Three.js files → Unity C# → QA gate → library save,
   then copies the result into `public/live-preview/`. Prints `PREVIEW_READY` on success.
2. **Edits / model viewers:** write `public/live-preview/index.html` + `public/live-preview/game.js` (plus `player.js`, `enemies.js`, etc. as needed).
3. The right-side preview pane automatically watches `public/live-preview/` and reloads `/studio/live-preview/index.html` as soon as you save those files.
4. **CRITICAL CSP RULE (`script-src 'self'`)**:
   - **NEVER** use inline `<script>...</script>` blocks or inline `onclick=` attributes in `public/live-preview/index.html` (the reverse proxy's Content-Security-Policy blocks inline scripts).
   - Always put all JavaScript inside `public/live-preview/game.js` (and sibling `.js` files) and load `<script src="/studio/vendor/three.min.js" defer></script>` and `<script src="./game.js" defer></script>` at the bottom of `<body>` (before `</body>`) so DOM elements exist when `game.js` runs.
5. **Available Local Vendor Libraries & Uploaded Files**:
   - Three.js (r128) is available locally at: `<script src="/studio/vendor/three.min.js"></script>`
   - Any file in `storage/.uploads/<filename>` is served at: `/studio/uploads/<filename>` (and `/storage/.uploads/<filename>`).
   - If you need to load a `.glb` (glTF 2.0 binary) file without an external GLTFLoader, either parse its JSON + binary buffer chunks (`GLB` magic `0x46546C67`) directly into `THREE.BufferGeometry` / `THREE.MeshStandardMaterial` in `public/live-preview/game.js`, or extract its meshes into `public/live-preview/model_data.js` using a quick `node` or `python3` script so it renders reliably with zero external CDN dependencies.
6. Do **not** modify `public/live-preview/` when the user is only asking a question or running slash commands (`/mcp`, `/usage`, `/help`).

## HARD RULE: No UI Code Without Design Skills (rejection policy)

Any UI change (HTML/CSS/frontend JS visuals in `public/`) MUST be made
with the design skills read and applied FIRST:
- `.agents/skills/ui-taste/SKILL.md` — always (anti-slop playbooks)
- `plugin:threejs:threejs` — for any Three.js/WebGL work
- `.agents/skills/ios-design/SKILL.md` — for mobile layout work

Code review rule: UI code produced WITHOUT the relevant skill read is
REJECTED — no matter who wrote it (agent, subagent, or orchestrator).
The commit message for UI work must name the skill(s) applied.
