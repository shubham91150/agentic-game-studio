# AGENTS.md

Muse Code reads this file as project rules when it runs in this directory.

## CRITICAL OVERRIDE: Real 3D `.glb` Models & Shader Grass ONLY (Bans Built-in `web3d` / `browser-game` Primitive Advice)

**THIS RULE EXPLICITLY OVERRIDES ANY BUILT-IN `web3d` OR `browser-game` SKILL INSTRUCTION TO _"DRAW MODELS IN CODE"_ OR _"SHIP ZERO DOWNLOADS"_.**

1. **STRICT BAN ON PRIMITIVE FAKES**: Building cars, trees, characters, buildings, props, or grass out of `THREE.BoxGeometry`, `THREE.ConeGeometry`, `THREE.CylinderGeometry`, `THREE.SphereGeometry`, `THREE.PlaneGeometry`, `function box(...)` helpers, or `THREE.MeshLambertMaterial` is **STRICTLY BANNED** and will be automatically rejected by `node src/verifier/visual_qa_gate.js`.
2. **MANDATORY REAL `.glb` MODELS**: Always load real 3D `.glb` assets using `/studio/vendor/GLTFLoader.js` and `/studio/vendor/world_realism.js` (`WorldRealism.loadGlbModel(url, onLoaded)`). Over **100+ real CC0 `.glb` models** (sports cars, sedans, SUVs, trucks, pine/oak/palm trees, rocks, buildings, barriers, cones, characters, props) are locally available and indexed in `/studio/assets/models/index.json` (on disk at `public/assets/models/`).
3. **MANDATORY 3D SHADER GRASS & REALISM HELPER**:
   - Load `<script src="/studio/vendor/three.min.js" defer></script>`, `<script src="/studio/vendor/GLTFLoader.js" defer></script>`, and `<script src="/studio/vendor/world_realism.js" defer></script>` in `public/live-preview/index.html`.
   - Use `WorldRealism.createRealisticSkyAndLighting(scene, renderer, options)` for ACES Filmic tone mapping, PMREM IBL environment reflections (`scene.environment`), sun-disc shader sky dome, and 3-point shadowed lighting.
   - Use `WorldRealism.createProceduralPBRMaterial(kind, options)` (`'asphalt' | 'grass' | 'rock' | 'dirt' | 'kerb'`) for 512×512 Sobel normal-mapped + roughness-mapped PBR surfaces.
   - Use `WorldRealism.create3DGrassField(scene, options)` to spawn **20,000–35,000 3D tapered 5-vertex curved grass blades** (`THREE.InstancedMesh` with `onBeforeCompile` wind-sway vertex shader). Flat `PlaneGeometry` / `BoxGeometry` grass is forbidden.
4. **HARD VISUAL QA GATE**: Every 3D preview or game build MUST pass `node src/verifier/visual_qa_gate.js public/live-preview` before completion.

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
5. **Available Local Vendor Libraries, 100+ Real CC0 `.glb` Models & Uploaded Files**:
   - Three.js (r128): `<script src="/studio/vendor/three.min.js" defer></script>`
   - GLTFLoader: `<script src="/studio/vendor/GLTFLoader.js" defer></script>`
   - WorldRealism helper (sky/IBL, Sobel PBR materials, 20k–35k 3D shader grass blades, normalized `.glb` loader): `<script src="/studio/vendor/world_realism.js" defer></script>`
   - **100+ Real CC0 `.glb` Models Library**: Catalog indexed at `/studio/assets/models/index.json` (files in `public/assets/models/`, served at `/studio/assets/models/<category>/<file>.glb`). Always load real `.glb` models via `WorldRealism.loadGlbModel` or `THREE.GLTFLoader` — **NEVER** fake cars, trees, buildings, or characters with `BoxGeometry`/`ConeGeometry`/`SphereGeometry` or base64 box dumps.
   - Any file in `storage/.uploads/<filename>` is served at: `/studio/uploads/<filename>` (and `/storage/.uploads/<filename>`).
6. **Run the Visual QA Gate before finishing**:
   - Run `node src/verifier/visual_qa_gate.js public/live-preview` and ensure it prints `PASS`.
7. Do **not** modify `public/live-preview/` when the user is only asking a question or running slash commands (`/mcp`, `/usage`, `/help`).

## HARD RULE: No UI Code Without Design Skills (rejection policy)

Any UI change (HTML/CSS/frontend JS visuals in `public/`) MUST be made
with the design skills read and applied FIRST:

- `.agents/skills/ui-taste/SKILL.md` — always (anti-slop playbooks)
- `plugin:threejs:threejs` — for any Three.js/WebGL work
- `.agents/skills/ios-design/SKILL.md` — for mobile layout work

Code review rule: UI code produced WITHOUT the relevant skill read is
REJECTED — no matter who wrote it (agent, subagent, or orchestrator).
The commit message for UI work must name the skill(s) applied.
