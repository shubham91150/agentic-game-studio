---
name: AI-Driven NPCs, Enemies & Dynamic 3D Environment Director
description: Mandatory architecture for using Meta AI models at BOTH build-time and live runtime to drive intelligent NPCs/enemies (tactics, perception, context-reactive dialogue) AND dynamic 3D game environments (lighting blackouts, fog/weather mutations, particle turbulence, world events).
type: project
---

# AI-Driven NPCs, Enemies & Dynamic 3D Environment Director

> **Core Principle**: Every game built in Agentic Game Studio must use Meta AI models not only to generate assets at build time, but also to drive **intelligent NPCs/Enemies** AND a **living, reactive 3D Game Environment** at runtime!

---

## 1. Dual-Layer AI for NPCs & Enemies (Build-Time + Live Runtime)

1. **Build-Time AI (`Muse Wonder 1.0` + `SAM 3.1` + `Baseten Spark Open`)**:
   - Design HFSM / Behavior Tree states (`PATROL`, `SUSPICIOUS`, `CHASE`, `SEARCH`, `AMBUSH`), sensory cones (sight + hearing), and A* / BFS grid pathfinding.
   - Calibrate 3D character anatomy with `SAM 3.1` and rig with a 20-bone Blender Armature (`Idle` + `Walk` `SkinnedMesh` animations).
2. **Live Runtime AI Brain (`POST /api/studio/ai/director` -> `meta-models/muse-spark-open-1026` / `muse-spark-1.3`)**:
   - Periodically (every ~12–15s or on key gameplay events: room change, key pickup, sprinting, hiding) send live game telemetry (`{ playerRoom, noiseLevel, torchOn, hasKey, enemyState, dist, survivalSec }`) to `POST /api/studio/ai/director`.
   - The AI returns a structured JSON decision `{ tactic, targetRoom, alertBoost, whisper, envEvent, fogDensity, lightDim, ashTurbulence }`:
     - **`tactic` & `targetRoom`**: Steers the enemy/NPC to ambush the player's current room, cut off escape routes, or inspect hiding spots (`setDirectorTarget(x, z, alertBoost)`).
     - **`whisper` / `dialogue`**: A live, context-reactive line spoken by the enemy/NPC that explicitly references what the player is doing right now (e.g., hiding in the dark in Classroom B or carrying the Chapel Key).

---

## 2. Dual-Layer AI for the 3D Game Environment (Build-Time + Live Runtime)

1. **Build-Time AI Environment Generation**:
   - Use `Muse Wonder 1.0` + `Muse Image 1.0` + `SceneScript/WFC` + `OSM 3D City` + `Blender 3.4` + `ambientCG 1K PBR` to construct authentic 3D architecture, props, lighting, and terrain.
2. **Live Runtime AI Environment Mutation (`levels.js` `applyAiEnvironment(directive)`)**:
   - The live 3D environment must dynamically react to the AI Director's `envEvent` and atmosphere parameters:
     - **`"lantern_blackout"`**: Dims or flickers nearby wall lanterns (`lightDim: 0.25` for 5s) to plunge the player's corridor into tense darkness.
     - **`"storm_surge"`**: Triggers an immediate double lightning super-strike + thunderclap and shifts fog color/density (`scene.fog.density`).
     - **`"ash_vortex"`**: Multiplies the drift speed and swirl turbulence of the 600 3D ash/ember particles (`ashTurbulence: 2.5`).
     - **`"chapel_omen"`**: Pulses the altar/door lights in eerie crimson-amber and deepens cathedral reverb/drone tension when the player nears the objective.
   - Always include an instant deterministic local fallback in `/api/studio/ai/director` (and client-side cache) so even if the network is offline or rate-limited, the AI Director responds in `<5ms` with zero interruption to 60 FPS gameplay!
