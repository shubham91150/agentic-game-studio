# AGENTS.md

Muse Code reads this file as project rules when it runs in this directory.

## Live Studio Environment (Split-Screen UI)

You are running inside the **Agentic Game Studio** live terminal on the left side of the user's browser screen.
On the **right side** of the user's browser screen is the **Game Preview** iframe.

### How to Render Anything in the Right-Side Game Preview Pane

Whenever the user asks you to build a game, modify a game, or render/preview an uploaded 3D model (`.glb` / `.gltf` / image in `storage/.uploads/`):

1. Write your HTML to **`public/live-preview/index.html`** and your JavaScript to **`public/live-preview/game.js`**.
2. The right-side preview pane automatically watches `public/live-preview/` and reloads `/studio/live-preview/index.html` as soon as you save those files.
3. **CRITICAL CSP RULE (`script-src 'self'`)**:
   - **NEVER** use inline `<script>...</script>` blocks or inline `onclick=` attributes in `public/live-preview/index.html` (the reverse proxy's Content-Security-Policy blocks inline scripts).
   - Always put all JavaScript inside `public/live-preview/game.js` and load `<script src="/studio/vendor/three.min.js" defer></script>` and `<script src="./game.js" defer></script>` at the bottom of `<body>` (before `</body>`) so DOM elements exist when `game.js` runs.
4. **Available Local Vendor Libraries & Uploaded Files**:
   - Three.js (r128) is available locally at: `<script src="/studio/vendor/three.min.js"></script>`
   - Any file in `storage/.uploads/<filename>` is served at: `/studio/uploads/<filename>` (and `/storage/.uploads/<filename>`).
   - If you need to load a `.glb` (glTF 2.0 binary) file without an external GLTFLoader, either parse its JSON + binary buffer chunks (`GLB` magic `0x46546C67`) directly into `THREE.BufferGeometry` / `THREE.MeshStandardMaterial` in `public/live-preview/game.js`, or extract its meshes into `public/live-preview/model_data.js` using a quick `node` or `python3` script so it renders reliably with zero external CDN dependencies.
5. Do **not** modify `public/live-preview/` when the user is only asking a question or running slash commands (`/mcp`, `/usage`, `/help`).
