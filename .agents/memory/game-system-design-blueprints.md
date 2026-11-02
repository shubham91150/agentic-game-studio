# Game System Design Blueprints (`docs/game-system-design/`)

Always consult the relevant blueprint in `docs/game-system-design/` (and skill `.agents/skills/game-system-design/SKILL.md`) before designing or coding any game system:

1. **`docs/game-system-design/01-architecture-patterns.md`**:
   - `FixedTimestepLoop` (accumulator loop with render interpolation $\alpha$ and hit-stop support)
   - `HierarchicalStateMachine` + Pushdown Automaton (`menu -> playing <-> paused -> over`)
   - `TinyECS` (Data-Oriented Structure-of-Arrays ECS)
   - `ZeroGCPool` (Swap-and-Pop object pool with zero per-frame allocations)
   - `SpatialHashGridXZ` & `StaticBVH` (broadphase spatial partitioning)
   - `InputCommandRecorder` (Command pattern + ghost replay) & `GameEventBus`

2. **`docs/game-system-design/02-vehicle-and-character-physics.md`**:
   - `VehicleDynamics3D` (Marco Monster Car Physics: Ackermann steering geometry, dynamic longitudinal/lateral weight transfer $\Delta W = (h/L) m a$, lateral cornering stiffness & slip angle $\alpha$, 6-speed gearbox & torque curve, 4-point raycast suspension spring-damper)
   - `CharacterController3D` (Quake/Celeste 3D movement: derived jump gravity $g = -2H/T_{\text{apex}}^2$, 3-phase jump gravity, coyote time, jump buffer, slope projection, step-up climbing)

3. **`docs/game-system-design/03-procedural-worlds-and-algorithms.md`**:
   - `samplePoissonDisc2D` (Bridson's $O(N)$ natural non-overlapping foliage/prop scatter)
   - `CentripetalTrackSpline` (Catmull-Rom spline with parallel-transport normals & smooth heightfield road carving)
   - `WaveFunctionCollapseGrid` (constraint-propagated tiled city/interior layouts)
   - `CrowdFlowField` (Dijkstra flow-field navigation for dozens of NPCs)
   - `SceneScriptCompiler` (Meta SceneScript architectural DSL: `make_wall`, `make_door`, `make_window`, `make_bbox`)

4. **`docs/game-system-design/04-rendering-camera-and-game-feel.md`**:
   - `ChaseCameraSystem3D` (critically damped spring chase cam + velocity look-ahead + Dutch roll)
   - GMTK 6-DOF trauma camera shake ($S = T^2$), hit-stop freeze, FOV speed-warp
   - `WorldRealism` (`createRealisticSkyAndLighting`, `create3DGrassField`, `createRealisticWater`, `createRealisticBuilding`, `loadGlbModel`)

5. **`docs/game-system-design/05-genre-system-blueprints.md`**:
   - Complete entity/state/HUD/camera/audio/asset contracts for: (1) 3D Circuit/Street Racer, (2) 3D Open-Zone Explorer / Bazaar Sim, (3) 3D Platformer, (4) Top-Down Arena, (5) 3D Puzzle / Room Escape, (6) Rhythm / Endless Runner.
