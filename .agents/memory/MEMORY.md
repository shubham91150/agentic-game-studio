# Project Memory Index

- [Elite Imagination Engine & Master Reference Bible (Hitman, Resident Evil, Hello Neighbor 2 & All Genres)](elite-imagination-and-goosebumps-engine.md) — Supreme reference bible + `node src/tools/elite_imagination_engine.js` for clockwork stealth/distraction sandboxes, multi-step Resident Evil puzzle chains, Hello Neighbor 2 adaptive AI & wardrobe peek-hide, and 12 mandatory goosebump micro-detail layers.
- [First-Principles Craftsmanship & Zero-Garbage Law](first-principles-craftsmanship-law.md) — SUPREME RULE: Know how every shader/material/mesh works from first principles before coding; zero square particles, zero untextured plastic meshes, zero fake checkbox ticking; always apply real 1K PBR textures, UVs, soft radial sprites, and ruthless pixel-level critique.
- [3D Asset and World Tools](3d-asset-and-world-tools.md) — MCP tools & CLI builders for PartNet/ShapeNet multi-part CAD assets, Blender Sapling/Archimesh/ANT/AutoRig, 3D Gaussian Splatting, Meta SceneScript+WFC, VGGT-1B, OpenStreetMap 3D cities, Objaverse, BlenderKit, PolyHaven, ambientCG, and MusicGen audio.
- [Blender Armature Rigging](blender-armature-rigging.md) — Blender 3.4 (`bpy`) humanoid 20-bone Armature rigging, analytical vertex group skinning (`SkinnedMesh`), NLA `Idle`/`Walk` action baking, and `THREE.AnimationMixer` integration.
- [Game System Design Blueprints](game-system-design-blueprints.md) — Complete Game System Design Corpus (`docs/game-system-design/01..05.md`): ECS, HFSM, Marco Monster Car Physics, Quake/Celeste Controller, Red Blob / SceneScript World Algorithms, and 6 Genre Blueprints.
- [Studio Security, gVisor Sandbox, Multi-Window Terminal & UI State](studio-security-gvisor-and-ui-state.md) — Owner AES-256-GCM auth vs Judge Google gVisor (`runsc 4.19.0-gvisor`) full-power CLI sandbox, non-destructive `tmux new-window` sessions, library auto-save/activate, UI color locks (`#000000` / `#121212`), and Mother Agatha SAM-3.1 20-bone rig.
- [Tool Routing Matrix](tool-routing-matrix.md) — WHEN → WHICH POWER → EXACT COMMAND stage table (research, Blender kits, PBR, rigging, audio, verification); auto-appended to build prompts by `enrichStudioPrompt`.
- [Visual QA and Subagent Rules](visual-qa-and-subagent-rules.md) — Mandatory multi-subagent orchestration (`subagent_spawn`), per-stage research + reference consistency, hard ban on box/cone primitives, and `node src/verifier/visual_qa_gate.js`.
- [Game Sound Design, Adaptive BGM, Spatial 3D SFX & Audio Architecture](game-sound-design-and-audio-architecture.md) — Complete 4-bus WebAudio mixer + ConvolverNode room reverb, Meta MusicGen adaptive BGM crossfading, 3-part transient+body+tail SFX synthesis, stereo-panned distance-filtered 3D spatial audio, surface footsteps, and voice ducking.
- [AI-Driven NPCs, Enemies & Dynamic 3D Environment Director](ai-npc-and-environment-director.md) — Mandatory build-time + live runtime Meta AI Director (`POST /api/studio/ai/director` via `muse-spark-open-1026`) driving adaptive NPC/enemy tactics & context-reactive dialogue AND live 3D environment mutations (lantern blackouts, storm surges, fog shifts, ash vortexes).


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
   - **Never rush or take a shortcut when time runs low**: If an agent needs more time to finish a stage or polish an asset to 10/10 quality, it MUST explicitly inform the user: *"I need additional time to complete this stage at Elite AAA quality without shortcuts — continuing methodically against BUILD_TODO.md"* and continue working methodically until every item is truly complete.

