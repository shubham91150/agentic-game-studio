---
name: Visual QA, Tool-First AAA World Richness & Subagent Rules
description: Mandatory rules requiring deep domain research, 100% tool execution (Blender 3.4 custom GLB kits, ambientCG 1K PBR textures, Polyhaven, SAM 3.1), 3D architectural depth, domain furniture, 3D FP viewmodel, GPU particles, and multi-subagent orchestration.
type: project
---

# Visual QA, Tool-First AAA World Richness & Subagent Rules

## 1. Why Mediocre Games Happen (and How to Prevent Them)

- **BANNED ANTI-PATTERN**: Building rooms out of bare flat `PlaneGeometry(1, 1)` sheets, pasting flat `MeshBasicMaterial` squares as "windows", and scattering 5 generic crates/barrels in an empty "school" or "city" is **STRICTLY FORBIDDEN**.
- **MANDATORY TOOL-FIRST EXECUTION**: You have Blender 3.4 (`blender -b -P`), `blender_pro_builder.py`, `partnet_shapenet_blueprint.py --generate-bpy`, `scenescript_wfc_world.py`, `fetch_ambientcg.py`, `fetch_polyhaven.py`, `fetch_blenderkit.py`, `segment_image.py` (SAM 3.1), `meta_musicgen_audio.py`, and 15 MCP tools in `studio-3d-tools`. **USE THEM ON EVERY GAME!**

## 2. Four-Phase AAA Game Build Protocol

1. **Phase 1 — Deep Domain & Asset Matrix Research**:
   - Before writing code, research the exact real-world architecture, props, lighting, and game feel of the genre.
   - List 12–20 domain-authentic 3D objects that belong in the scene (e.g., for a Convent School: Gothic stone pillars, pointed arches, timber ceiling beams, wainscot trim, 3D mullioned gothic windows, wooden student desks & chairs, chalkboards, bookshelves, chapel altar, pews, candelabras).
2. **Phase 2 — Blender 3.4 Custom `.glb` Asset Kit & 1K PBR Texture Generation**:
   - Fetch real 1K PBR textures (`Bricks`, `Plaster`, `Wood`, `Tiles`) via `python3 src/tools/fetch_ambientcg.py`.
   - Write and run a headless Blender 3.4 Python script (`blender -b -P ...`) to generate the custom 3D architectural & furniture `.glb` models needed for the scene into `public/live-preview/assets/`.
3. **Phase 3 — Cinema-Grade Three.js Atmosphere & Tactile Feel**:
   - Replace flat window squares with real 3D window frames + angled volumetric moonlight shafts (`ConeGeometry`/`CylinderGeometry` or custom beam mesh with additive depth-faded shader/material).
   - Add a `THREE.Points` atmospheric particle system (floating dust motes / ash / embers drifting in the torch beam).
   - In first-person games, attach a **real 3D held viewmodel** (e.g., `Lantern_01_1k.glb` held in the bottom-right of the camera) with spring look-sway and walk-bob inertia!
4. **Phase 4 — Multi-Subagent Verification (`visual_qa_gate.js` + Headless Chromium Critique)**:
   - Run `node src/verifier/visual_qa_gate.js public/live-preview`, capture in-game screenshots, and verify that rooms look richly furnished, atmospheric, and AAA-crafted.


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


## 🤝 STAGE-SYNCHRONIZED 4-AGENT SWARM & TIME-EXTENSION PROTOCOL (ELITE CRAFTSMANSHIP ONLY)

1. **ALL 4 AGENTS FOCUS ON THE SAME STAGE TOGETHER (NEVER SPLIT ACROSS DIFFERENT STAGES IN PARALLEL)**:
   - **Forbidden Pattern**: Never assign Subagent A to Assets, Subagent B to World, Subagent C to Player/UI, and Subagent D to Game Loop at the same time. That causes blind integration mismatches and rushed, basic work.
   - **Required Pattern (Stage-Synchronized Swarm)**: All 4 agents must work on the **SAME stage simultaneously**, dividing the micro-tasks of that single stage so each agent can do deep research and elite-level execution on its slice:
     - **During Stage 1 (Research & `BUILD_TODO.md`)**: All 4 agents research every micro-detail of the genre (visual references, lighting, anatomy/rigging, physics math, sound, HUD) and build one exhaustive `BUILD_TODO.md`.
     - **During Stage 2 (3D Assets Only)**: All 4 agents work EXCLUSIVELY on 3D `.glb` assets and textures:
       - *Agent 1*: Hero / First-Person Viewmodel + Rigged Hands + PBR Weapon Materials + Isolated Render Audit.
       - *Agent 2*: Enemy / Character `.glb` Models + Real Clothing/Skin UVs + Skeletal `Idle`/`Walk`/`Run`/`Hit`/`Death` Animations + Isolated Render Audit.
       - *Agent 3*: Architectural Kit, Landmarks & Interactive Mechanism `.glb` Models + Isolated Render Audit.
       - *Agent 4*: Photogrammetry Props, Foliage, 1K Normal-Mapped PBR Textures & Triangle/BufferView Optimization (`60 FPS` budget) + Isolated Render Audit.
     - **During Stage 3 (3D World & Lighting Only)**: All 4 agents collaborate exclusively on world layout, PBR surfaces, HDRI/sky, volumetric fog, `UnrealBloomPass`, and ambient micro-life, followed by multi-angle world render verification.
     - **During Stages 4 & 5 (Controller, AI, Audio & UI Only)**: All 4 agents collaborate on physics/camera feel, HFSM/A* AI, 4-bus Cathedral Reverb WebAudio, and desktop + mobile controls (verifying exact DOM IDs against `index.html`).
     - **During Stage 6 (Deep QA & Playtest)**: All 4 agents verify every checkbox in `BUILD_TODO.md`, run `visual_qa_gate.js` (`maxAllowedPrimitives = 0`), and run full Playwright control/FPS audits.

2. **MICRO-RESEARCH BEFORE EVERY TASK**:
   - Even for the smallest detail (how a shirt collar sits on a neck, how weapon recoil recovers, how fog blends into a skybox, how a button responds to touch), agents must research and verify the exact math/geometry first instead of guessing.

3. **AUTONOMOUS MULTI-HOUR EXECUTION & EXPLICIT TIME-EXTENSION REQUESTS**:
   - Agents are expected to work autonomously for hours against `BUILD_TODO.md` to achieve **Elite AAA quality (never basic/placeholder quality)**.
   - **Never rush or take a shortcut when time runs low**: If an agent needs more time to finish a stage or polish an asset to 10/10 quality, it MUST explicitly inform the user: *"मुझे इस काम को Elite लेवल पर पूरा करने के लिए अभी और समय चाहिए — मैं बिना किसी शॉर्टकट के `BUILD_TODO.md` के हिसाब से इसे पूरा कर रहा हूँ"* and continue working methodically until every item is truly complete.

