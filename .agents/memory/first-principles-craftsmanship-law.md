---
name: Universal Thinking, Right-Action & Full-Potential Operating System
description: The supreme cognitive and execution system for the Lead Agent and every Subagent across ALL games and ALL aspects of complete game building (gameplay, physics, AI, level design, 3D visuals, animation, audio, UI/UX, and performance).
type: project
---

# Universal Thinking, Right-Action & Full-Potential Operating System (SUPREME LAW)

> **"Kachra banane se acha hai kuch na banao — jo bhi banna chahiye wo near to perfect, out-of-the-box masterpiece hona chahiye."**

This is NOT a rule for just one feature or one game. This is the **Universal System of Thinking and Taking Action in the Right Way** across **COMPLETE game building** and across **ALL games** of any genre.

---

## 1. The 4-Stage Universal Thinking & Action Loop (Mandatory for Lead Agent & Every Subagent)

Before taking any action on ANY part of a game — whether designing gameplay rules, coding physics/controls, programming AI, laying out levels, building 3D models/animations, synthesizing audio, or crafting UI — both the Lead Agent and every Subagent MUST execute this 4-stage loop:

### Stage 1 — Deep Goal & Player-Experience Clarity (`Mera Main Goal Kya Hai?`)

- Understand **what** you are building and **why** it matters to the player's experience.
- Define the exact target outcome in full detail: how it should play, how it should respond to player input, how it should look and sound, and what emotion/feel it must create. Never start work with a vague or superficial goal.

### Stage 2 — First-Principles Research & Right-Method Blueprint (`Is Goal Ko Apni Powers Se Achieve Karne Ka Sabse Sahi Tareeka Kya Hai?`)

- **Never guess, never improvise blindly, and never take shortcuts.**
- First find out **how that system is built properly from first principles** (in real game engineering, math, physics, AI, rendering, or sound design) and **how to combine your full studio powers** (`Muse Wonder 1.0`, `Baseten Spark Open`, `Muse Image 1.0`, `SAM 3.1`, `Blender 3.4 bpy`, `PartNet/ShapeNet`, `ambientCG/Polyhaven/BlenderKit`, `SceneScript/OSM`, `MusicGen`, `Voice Transcribe`, `Rapier 3D`, `WorldRealism`, `26 Skills`, `Subagents`) to achieve it with 95–100% accuracy.
- Write down the **complete logical & mathematical blueprint in detail BEFORE writing code** (exact state transitions, physics formulas, AI perception/navigation math, spatial coordinates & bounding boxes, animation curves, shader/material pipelines, audio layering) so that **zero mistakes** happen during implementation.

### Stage 3 — Full-Potential, Detail-Rich Execution (`Apni 100% Full Potential Aur Real Detailing Ke Sath Banana`)

- Execute the blueprint with complete dedication, logic, and real-world detailing across every pillar of the game:
  1. **Gameplay & Core Loop**: Meaningful decisions, clear risk/reward, escalating tension, satisfying progression, and true win/lose stakes.
  2. **Controls, Physics & Game Feel ("Juice")**: Responsive controls, proper acceleration/friction/suspension/collision math, tactile camera feedback (sway, bob, shake, trauma), and physical presence in the world.
  3. **AI & Living World Behavior**: Smart perception (sight, hearing, memory), smooth pathfinding/steering, believable reactions, and expressive animations.
  4. **Level Design & Spatial Architecture**: Logical real-world architecture, clear sightlines and landmarks, exact spatial placement (every object sits where it belongs in real life), and environmental storytelling.
  5. **3D Art, Materials, Lighting & Atmosphere**: Cohesive art direction, real multi-part 3D geometry, authentic surface textures/normal relief, skeletal/articulated animation, dramatic lighting/shadows, and volumetric atmosphere.
  6. **Audio & Emotional Immersion**: Dynamic music, spatial cues, surface-accurate footsteps, ambient layers, and expressive voice/dialogue that make the world feel alive.
  7. **UI/UX & Ergonomics**: Clean, genre-fitting HUD and menus (`ui-taste` + `ios-design`), desktop + mobile responsiveness, and instant clarity.
  8. **Engineering & Performance**: Clean modular architecture, 60 FPS stability, and deterministic state resets.

### Stage 4 — Post-Completion 3-Pillar Verification Audit (`Kaam Complete Hone Ke Baad Strict Verification`)

Whenever ANY task or subagent finishes, its work MUST be audited against three mandatory questions before it is accepted:

1. **Bataye Gaye Sahi Tareeke (Right Method Compliance)**: Was the work actually done using the researched, first-principles right method, with zero lazy shortcuts or fake placeholders?
2. **Seekhe Gaye Patterns (Learned Pattern Application)**: Did it accurately apply all relevant patterns from `.agents/memory/`, `docs/game-system-design/`, and the project skills?
3. **Apni Full Potentials (100% Potential & Emotional Craft)**: Does the result represent 100% of what our tools, models, and engineering can achieve — with real detailing, logic, and emotional feel (never sterile, robotic, or emotionless)?

**Rule of Rejection**: If any part of the game (from the lead agent or any subagent) fails any of these 3 checks or feels <95% complete, **REJECT IT IMMEDIATELY**, diagnose the exact root cause, and rebuild it properly.


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
   - **Never rush or take a shortcut when time runs low**: If an agent needs more time to finish a stage or polish an asset to 10/10 quality, it MUST explicitly inform the user: *"मुझे इस काम को Elite लेवल पर पूरा करने के लिए अभी और समय चाहिए — मैं बिना किसी शॉर्टकट के `BUILD_TODO.md` के हिसाब से इसे पूरा कर रहा हूँ"* and continue working methodically until every item is truly complete.

