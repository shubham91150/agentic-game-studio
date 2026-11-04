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
