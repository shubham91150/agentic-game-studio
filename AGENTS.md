# AGENTS.md

Muse Code reads this file as project rules when it runs in this directory.

## SUPREME OPERATING SYSTEM (FOR ALL GAMES & COMPLETE GAME BUILDING): 1. Goal Clarity → 2. Right-Method Blueprint → 3. Full-Potential Execution → 4. 3-Pillar Verification

This is the **Universal System of Thinking and Taking Action in the Right Way** across **ALL games** and across **ALL 8 pillars of complete game building** (_1. Gameplay & Core Loop, 2. Controls/Physics/Game Feel, 3. AI & Behavior, 4. Level Design & Spatial Architecture, 5. 3D Art/Animation/Lighting, 6. Audio & Emotion, 7. UI/UX, 8. Performance_). Both the Lead Agent and every Subagent (`subagent_spawn`) **MUST** follow these 4 stages on every task:

1. **LOCK THE MAIN GOAL IN DETAIL (`Mera Main Goal Kya Hai?`)**:
   - Before touching any tool or code, clearly define the complete player experience, mechanical behavior, spatial layout, visual/audio detail, and emotional feel you must achieve.
2. **DISCOVER & DESIGN THE EXACT RIGHT METHOD (`Apni Powers Se Is Goal Ko Achieve Karne Ka Sabse Sahi Tareeka Kya Hai?`)**:
   - Never guess, improvise blindly, or take lazy shortcuts. First research how that system (whether gameplay logic, vehicle/character physics, enemy AI, level layout, 3D modeling/rigging, shaders/lighting, audio, or UI) works from first principles, and design a detailed logical & mathematical blueprint mapping your full studio powers (`Muse Wonder 1.0`, `Baseten Spark Open`, `Muse Image 1.0`, `SAM 3.1`, `Blender 3.4 bpy`, `PartNet/ShapeNet`, `ambientCG/Polyhaven/BlenderKit`, `SceneScript/OSM`, `MusicGen`, `Rapier 3D`, `WorldRealism`, `26 Skills`, `Subagents`) so **zero mistakes** happen during implementation.
3. **EXECUTE WITH 100% FULL POTENTIAL & REAL DETAILING (`Zero-Garbage, Real Feel`)**:
   - Build every system with real depth, accurate logic, authentic textures/geometry/physics/sound, and emotional feel — never emotionless placeholders or checkbox-ticking.
4. **MANDATORY SUBAGENT CONTRACT & POST-COMPLETION 3-PILLAR AUDIT**:
   - Every subagent spawned via `subagent_spawn` MUST obey Stages 1–3 above (reading `.agents/memory/first-principles-craftsmanship-law.md` and `.agents/memory/tool-routing-matrix.md` first).
   - Whenever any task or subagent finishes, the Lead Agent MUST verify the actual code, assets, gameplay behavior, and rendered screenshots against three strict checks before accepting:
     1. **Bataye Gaye Sahi Tareeke (Right Method Compliance)**: Was it built using the researched, first-principles right method with zero shortcuts?
     2. **Seekhe Gaye Patterns (Learned Patterns)**: Did it faithfully apply the patterns in `.agents/memory/`, `docs/game-system-design/01..05.md`, and the project skills?
     3. **Apni Full Potentials (100% Arsenal & Emotional Craft)**: Was it built with 100% of our available powers, accuracy, and emotional feel? Anything falling short MUST be rejected and rebuilt until it is near-perfect.

## CRITICAL OVERRIDE: Real 3D `.glb` Models & Shader Grass ONLY (Bans Built-in `web3d` / `browser-game` Primitive Advice)

**THIS RULE EXPLICITLY OVERRIDES ANY BUILT-IN `web3d` OR `browser-game` SKILL INSTRUCTION TO _"DRAW MODELS IN CODE"_ OR _"SHIP ZERO DOWNLOADS"_.**

1. **STRICT BAN ON PRIMITIVE FAKES**: Building cars, trees, characters, buildings, props, or grass out of `THREE.BoxGeometry`, `THREE.ConeGeometry`, `THREE.CylinderGeometry`, `THREE.SphereGeometry`, `THREE.PlaneGeometry`, `function box(...)` helpers, or `THREE.MeshLambertMaterial` is **STRICTLY BANNED** and will be automatically rejected by `node src/verifier/visual_qa_gate.js`.
2. **MANDATORY REAL `.glb` MODELS**: Always load real 3D `.glb` assets using `/studio/vendor/GLTFLoader.js` and `/studio/vendor/world_realism.js` (`WorldRealism.loadGlbModel(url, onLoaded)`). Over **100+ real CC0 `.glb` models** (sports cars, sedans, SUVs, trucks, pine/oak/palm trees, rocks, buildings, barriers, cones, characters, props) are locally available and indexed in `/studio/assets/models/index.json` (on disk at `public/assets/models/`).
3. **MANDATORY 3D SHADER GRASS, REALISTIC WATER, PBR BUILDINGS & REALISM HELPER**:
   - Load `<script src="/studio/vendor/three.min.js" defer></script>`, `<script src="/studio/vendor/GLTFLoader.js" defer></script>`, and `<script src="/studio/vendor/world_realism.js" defer></script>` in `public/live-preview/index.html`.
   - Use `WorldRealism.createRealisticSkyAndLighting(scene, renderer, options)` for ACES Filmic tone mapping, PMREM IBL environment reflections (`scene.environment`), sun-disc shader sky dome, and 3-point shadowed lighting.
   - Use `WorldRealism.createProceduralPBRMaterial(kind, options)` (`'asphalt' | 'grass' | 'rock' | 'dirt' | 'kerb' | 'brick' | 'concrete'`) for 512×512 Sobel normal-mapped + roughness-mapped PBR surfaces.
   - Use `WorldRealism.create3DGrassField(scene, options)` to spawn **20,000–35,000 3D tapered 5-vertex curved grass blades** (`THREE.InstancedMesh` with `onBeforeCompile` wind-sway vertex shader). Flat `PlaneGeometry` / `BoxGeometry` grass is forbidden.
   - Use `WorldRealism.createRealisticWater(scene, options)` for animated dual-scrolling procedural wave water with Fresnel sky/deep-water blending (`#0a3246` ↔ `#7ab8d6`), sun specular glint, and shoreline foam edge feathering.
   - Use `WorldRealism.createRealisticBuilding(options)` for multi-material PBR architectural buildings (normal-mapped concrete/brick facades, recessed reflective PMREM glass windows, ground-floor storefront frames, parapet cornice ledges, and rooftop HVAC/water-tank details). Flat untextured box buildings are forbidden.
   - Use real Polyhaven photogrammetry models in `public/assets/polyhaven/` (served at `/studio/assets/polyhaven/<id>/<id>_1k.glb`, including `Barrel_01`, `Lantern_01`, `CoffeeCart_01`, `Drill_01`, `modular_street_seating`, trees, boulders, barriers, street lamps) or fetch additional ones via `python3 src/tools/fetch_polyhaven.py <id> --type model --res 1k`.
4. **HARD VISUAL QA GATE**: Every 3D preview or game build MUST pass `node src/verifier/visual_qa_gate.js public/live-preview` before completion.
5. **MANDATORY TOOL-FIRST AAA WORLD RICHNESS PROTOCOL (NO EMPTY ROOMS OR CRATE/BARREL SPAM)**:
   - **NEVER build empty rooms made only of flat `PlaneGeometry` walls and generic crates/barrels, and NEVER use flat `MeshBasicMaterial` squares for windows or flames.**
   - Before writing any level or world code (`levels.js`), you MUST first run a **Deep Environment & Asset Matrix Research Pass** listing at least **12–20 domain-authentic 3D objects** that belong in that specific setting (e.g., for a Convent School: 3D gothic stone pillars & pointed arches, timber ceiling beams, wainscot wall trim, 3D mullioned gothic window frames with volumetric moonlight shafts, student desks & chairs, chalkboards, tall bookshelves, lockers, chapel pews, altar, crucifix, candelabras).
   - If any domain-specific 3D asset is not already in `public/assets/`, you **MUST generate it as a real `.glb` using headless Blender 3.4 (`blender -b -P ...` / `src/tools/blender_pro_builder.py` / `src/tools/partnet_shapenet_blueprint.py --generate-bpy`) and fetch real 1K PBR texture maps (`Color`, `NormalGL`, `Roughness`) using `python3 src/tools/fetch_ambientcg.py` or `fetch_polyhaven.py`** BEFORE writing `levels.js`.
   - Every 3D game MUST include:
     1. **Real 1K PBR Texture Maps** (`ambientCG` / `Polyhaven` normal + roughness + albedo maps on floors, walls, ceilings, and roads — never rely solely on 256px procedural noise),
     2. **3D Architectural Depth & Domain Furniture** (real `.glb` columns, arches, ceiling beams, 3D window frames, and room-appropriate furniture),
     3. **Tactile Player Presence** (in first-person games: a real 3D held viewmodel such as a brass lantern/torch in the lower-right camera view with walk-bob and look-sway inertia; in third-person/vehicle games: articulated suspension/wheel/limb animation),
     4. **Atmospheric GPU Particles & Volumetric Lighting** (`THREE.Points` floating dust/ash/embers/rain illuminated by light cones + angled volumetric light shafts through windows).

## MANDATORY MULTI-SUBAGENT ORCHESTRATION RULE (`subagent_spawn` + `subagent_wait`)

Muse Code CLI has built-in subagent tools: `subagent_spawn`, `subagent_wait`, `subagent_send_message`, and `subagent_cancel`.
Whenever Muse Code CLI builds or upgrades a game, it **MUST NOT work single-threaded**. It MUST act as the **Lead Orchestrator** and spawn parallel specialized subagents via `subagent_spawn` + `subagent_wait` (giving each subagent strict file ownership so they never overwrite each other):

1. **Subagent A — Research & Architecture**: Deep gameplay/mechanics/reference report, level spline/topology design, and state machine contract.
2. **Subagent B — World, Terrain, Water & Foliage**: `WorldRealism.createRealisticSkyAndLighting`, `create3DGrassField`, `createRealisticWater`, `createRealisticBuilding`, and Polyhaven photogrammetry nature/rocks (`levels.js`).
3. **Subagent C — Vehicles, Characters, Tools & Physics**: High-poly `.glb` vehicles/characters/tools/props (`public/assets/polyhaven/` & `public/assets/models/`), Rapier/arcade physics, animations, and WebAudio (`player.js`, `enemies.js`, `audio.js`, `vfx.js`).
4. **Subagent D — Visual QA & Playtest Critic**: Runs `node src/verifier/visual_qa_gate.js`, takes headless Chromium screenshots, and rejects any primitive/box/cartoon asset before handoff.

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

1. **Fresh game from a prompt (MANDATORY BESPOKE MULTI-SUBAGENT + FULL-TOOL BUILD — NEVER USE TEMPLATE SHORTCUTS):**
   - **DO NOT** run `node src/tools/build-game.js` to overwrite `public/live-preview/` with a generic orb-collector template.
   - Instead, EVERY game requested by the user MUST be custom-architected and built in `public/live-preview/` (`index.html`, `game.js`, `levels.js`, `player.js`, `enemy.js`/`enemies.js`, `audio.js`, `ui.js`, `vfx.js`, `save.js`) using **Multi-Subagent Orchestration (`subagent_spawn` + `subagent_wait`)** and **100% of the studio's tools**:
     - **Phase 1 (Deep Research & Genre Blueprint)**: Read `.agents/skills/game-system-design/SKILL.md` + `docs/game-system-design/01..05.md`, call `muse-wonder-1.0` (`src/agent/muse_wonder.js`) + `make-image.js` (`muse-image-1.0` reference art), and define the exact genre mechanics and a 12–20 item domain-authentic 3D asset matrix.
     - **Phase 2 (Mandatory Tool Execution — Custom 3D `.glb` Kit, Rigged Characters, 1K PBR & AI Audio)**:
       - Run headless **Blender 3.4** (`blender -b --factory-startup -P ...`, `src/tools/blender_pro_builder.py`, `src/tools/partnet_shapenet_blueprint.py --generate-bpy`, `src/tools/scenescript_wfc_world.py`, `src/tools/osm_city_3d.py`) to build custom 3D architecture, props, and furniture `.glb`s for the scene.
       - Run `src/tools/blender_autorig_animate.py` (20-bone humanoid Armature + `SkinnedMesh` + baked `Idle`/`Walk` NLA actions) + `src/tools/segment_image.py` (SAM 3.1) for characters/enemies.
       - Run `python3 src/tools/fetch_ambientcg.py` and `python3 src/tools/fetch_polyhaven.py` for real 1K PBR textures and photogrammetry models.
       - Run `python3 src/tools/meta_musicgen_audio.py` (Meta MusicGen) and `node src/tools/npc_dialogue.js` (Baseten `muse-spark-open-1026`) for AI music and dialogue.
     - **Phase 3 (AAA WebGL Polish & Game Feel)**: Include 3D architectural depth, domain-authentic furniture, tactile player presence (3D first-person held viewmodel with sway OR articulated vehicle/character suspension/rig), and `THREE.Points` atmospheric GPU particles.
     - **Phase 4 (Verification & Auto-Publish)**: Pass `node src/verifier/visual_qa_gate.js public/live-preview`, verify in headless Chromium, and publish via `node src/tools/publish-game.js`.
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

## Native 3D/World MCP Server (`studio-3d-tools`) & Auto-Injected Memory (`.agents/memory/`)

1. **First-Class MCP Tools (`studio-3d-tools`)**:
   - `partnet_shapenet_build` (`src/tools/partnet_shapenet_blueprint.py` — PartNet anatomical part-hierarchies + ShapeNet metric dimensions + `--generate-bpy` multi-part `.glb` builder)
   - `blender_pro_generate` (`src/tools/blender_pro_builder.py` — Blender 3.4 Sapling Tree Gen, Archimesh multi-floor buildings, A.N.T. Landscape terrain, plus 11 auto-enabled CAD/BoolTool/BoltFactory addons)
   - `osm_real_world_city_3d` (`src/tools/osm_city_3d.py` — OpenStreetMap Overpass API real-world 3D city/bazaar extruder: `lucknow_hazratganj`, `monaco_harbor`, `tokyo_shibuya`, `nyc_times_square`)
   - `objaverse_inspect_3d` (`src/tools/search_objaverse.py` — Objaverse-XL / LVIS 10M+ 3D structure inspector)
   - `blenderkit_search_free` (`src/tools/fetch_blenderkit.py` — BlenderKit free 3D models/materials/HDRIs search & blueprint fetcher)
   - `fetch_cc0_pbr_or_model` (`src/tools/fetch_polyhaven.py` & `src/tools/fetch_ambientcg.py` — CC0 photogrammetry models & 1K PBR texture sets)
   - `run_visual_qa_gate` (`node src/verifier/visual_qa_gate.js`)

2. **Game Development System Design Corpus (`docs/game-system-design/` & `.agents/skills/game-system-design/SKILL.md`)**:
   - Read `.agents/skills/game-system-design/SKILL.md` and `docs/game-system-design/01..05.md` before architecting any game loop, ECS, vehicle/character physics, procedural world, camera rig, or genre state machine.


## 🚨 IRONCLAD ZERO-SHORTCUT & PER-STAGE SELF-CONFIRMATION LAW (PERMANENT)

1. **ZERO SHORTCUTS — NEVER REUSE ANOTHER GAME'S WORLD OR HOUSE**:
   - When building a new game, it is **STRICTLY FORBIDDEN** to copy or reuse another game's `levels.js`, house, rooms, corridors, or enemy setup (e.g., never reuse *Ashes of St. Vermilion*'s convent school rooms for a Zombie Survival Shooter).
   - Every game MUST have a **100% original 3D world layout, setting, lighting, sky/environment, and architecture** built specifically for its genre.

2. **MANDATORY RESEARCH BEFORE BUILDING (STAGE 1)**:
   - Before writing any game code or selecting any 3D asset, research the genre's top AAA references (environment topology, camera framing, lighting contrast, enemy anatomy, weapon feel, HUD layout) and inventory all candidate 3D `.glb` assets.

3. **INDIVIDUAL 3D ASSET VISUAL AUDIT BEFORE SCENE INTEGRATION (STAGE 2)**:
   - Never blindly drop a `.glb` model into a game by filename alone.
   - Render and inspect candidate character/enemy/weapon `.glb` models first and ask: *"Does this actually look like a terrifying human zombie / realistic weapon / intended prop, or does it look like a pig/blob/box?"* If it looks wrong, reject it immediately and use/build an anatomically accurate human/prop model.

4. **MANDATORY PER-STAGE CONFIRMATION GATE (STAGES 1 -> 2 -> 3 -> 4)**:
   - At the end of **EVERY** stage, stop and verify with concrete visual proof (screenshots + metrics):
     1. *What did I actually do in this stage?*
     2. *Is it 100% faithful to our goal with zero shortcuts, or did I fake/reuse anything?*
   - Never advance to the next stage until the current stage passes 100% honest visual confirmation.


## ⏳ MANDATORY 6-STAGE TODO-DRIVEN GAME ENGINEERING PROTOCOL (5-HOUR BUDGET — NEVER BUILD IN ONE SHOT)

**CRITICAL RULE: A game must NEVER be built in a single rushed pass. The agent has a full ~5-hour (`18,000,000 ms`) engineering budget and MUST build every game across 6 sequential, verified stages tracked in `BUILD_TODO.md`:**

- **STAGE 1 — Deep Research, Reference Concept & `BUILD_TODO.md` Creation**:
  1. Research real AAA genre references (web search + generate a visual target reference image with `Muse Image 1.0` `make-image.js`).
  2. Write a comprehensive `BUILD_TODO.md` breaking the entire project into Stages 1–6 with granular `[ ]` checkboxes for every asset, shader, mechanic, sound bus, and control.
  3. **Gate 1 Confirmation**: Confirm the reference image and `BUILD_TODO.md` match the user's vision before touching any 3D assets or code.

- **STAGE 2 — Dedicated 3D Asset Curation, Preparation & Isolated Visual Audit (`0%` Game Logic Yet)**:
  1. Discover, fetch, and prepare all required 3D `.glb` assets (Photogrammetry scans from Polyhaven, pre-rigged/animated characters, weapons, and props).
  2. Render EVERY character, enemy, weapon, and hero prop in an isolated inspection scene first.
  3. **Gate 2 Confirmation**: Visually inspect the rendered asset screenshots. Reject any broken UVs, missing textures, A-pose mannequins, or primitive fakes immediately. Do NOT start Stage 3 until 100% of 3D assets pass visual audit and are checked off in `BUILD_TODO.md`.

- **STAGE 3 — 3D World Architecture, PBR Surfaces, Sky & Post-Processing (`levels.js`)**:
  1. Build the 3D world layout, 1K normal-mapped PBR surfaces, HDRI/sky, volumetric fog, `UnrealBloomPass`, 3D `InstancedMesh` foliage, and collision bounds.
  2. **Gate 3 Confirmation**: Render the world from multiple camera angles and verify lighting, atmosphere, and 60-FPS frame time before adding gameplay entities.

- **STAGE 4 — Core Player Controller, Physics, Camera & Viewmodel Feel (`player.js`)**:
  1. Implement and tune movement physics, collision resolution, camera inertia/bob, and first/third-person viewmodels.
  2. **Gate 4 Confirmation**: Test movement, collision, and viewmodel orientation in headless Chromium and check off Stage 4 in `BUILD_TODO.md`.

- **STAGE 5 — Enemy AI, Systemic Gameplay Loop, 4-Bus Spatial Audio & Full Desktop/Mobile UI (`enemy.js`, `game.js`, `audio.js`, `ui.js`)**:
  1. Implement enemy AI (HFSM + pathfinding + skeletal `AnimationMixer` transitions), combat/stealth interactions, 4-bus Cathedral Reverb WebAudio, Live Meta AI Director hook, and always-visible desktop + mobile controls.
  2. **Gate 5 Confirmation**: Verify all animations, sound triggers, and HUD readouts.

- **STAGE 6 — End-to-End Playtest, Hardened Visual QA Gate (`maxAllowedPrimitives = 0`) & Final Sign-Off**:
  1. Run `node src/verifier/visual_qa_gate.js` (`maxAllowedPrimitives = 0` — strict zero tolerance on primitive boxes/cones/cylinders/spheres).
  2. Run automated Playwright playtests verifying every keyboard, mouse, and on-screen touch button, 60-FPS real-time clock speed, and win/loss states.
  3. Confirm every `[x]` item in `BUILD_TODO.md` is completed with zero shortcuts.

