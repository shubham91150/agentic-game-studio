---
name: game-system-design
description: Authoritative Game System Design Knowledge Corpus covering Game Programming Patterns (fixed timestep, HFSM, ECS, zero-GC pools, spatial hash/BVH), Marco Monster Car Physics & Quake/Celeste Character Controllers, Red Blob Games & Meta SceneScript Procedural Worlds (Poisson-disc, Catmull-Rom road carving, WFC, Flow Fields, OSM 3D City Extruder), Real-Time Rendering/Cameras/Juice, and 6 Genre System Blueprints. Load before designing or coding any 3D game system.
license: MIT
metadata:
  version: "1.0.0"
  author: "Agentic Game Studio"
---

# Game System Design — Authoritative Engineering & Procedural World Corpus

Use this skill **before designing or coding any game architecture, physics controller, procedural world, camera/juice system, or genre loop**. Instead of guessing ad-hoc formulas or writing fragile boolean-spaghetti loops, load the exact reference blueprint from `docs/game-system-design/` and adapt its copy-ready JavaScript classes and math.

---

## Corpus Index (`docs/game-system-design/`)

| File                                                                 | Core Engineering Topics Covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | When to Read It                                                                                                                                                   |
| :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`docs/game-system-design/01-architecture-patterns.md`**            | **Game Programming Patterns**: Fixed-Timestep Accumulator Loop (`1/60s`) with render interpolation $\alpha$, Hierarchical Finite State Machine (HFSM) + Pushdown Automaton stack, Data-Oriented `TinyECS` (SoA `Float32Array` buffers), `ZeroGCPool` (swap-and-pop active set), `SpatialHashGridXZ` & `StaticBVH` broadphase collision, `InputCommandRecorder` (replay ghosts + puzzle undo), and `GameEventBus` (PubSub decoupling).                                                                           | Before writing `game.js` loop, entity managers, collision broadphase, state transitions, or undo/replay systems.                                                  |
| **`docs/game-system-design/02-vehicle-and-character-physics.md`**    | **Marco Monster Car Physics & Character Controller Math**: Ackermann geometry, dynamic weight transfer $\Delta W = (h/L) \cdot m \cdot a$, slip angle $\alpha = \arctan((v_y + \omega b)/                                                                                                                                                                                                                                                                                                                       | v_x                                                                                                                                                               | )$ & lateral cornering stiffness, 6-speed gearbox & torque curve, 4-point raycast suspension spring-damper $F = kx + c\dot{x}$, plus Quake/Celeste 3D character movement (derived $g = -2H/T_{\text{apex}}^2$, 3-phase jump gravity, coyote time, jump buffer, slope projection, step-up climbing). | Whenever building or tuning a driving/racing game (`VehicleDynamics3D`) or a 3D character/platformer/explorer controller (`CharacterController3D`). |
| **`docs/game-system-design/03-procedural-worlds-and-algorithms.md`** | **Red Blob Games & Meta SceneScript Procedural World Algorithms**: Bridson's $O(N)$ Fast Poisson-Disc Sampling (`samplePoissonDisc2D`), Centripetal Catmull-Rom Splines with parallel-transport normals & smooth heightfield road carving (`CentripetalTrackSpline`), Wave Function Collapse (`WaveFunctionCollapseGrid`), Voronoi/Delaunay biomes, A* & Dijkstra `CrowdFlowField` navigation, and Meta **SceneScript** (`make_wall`, `make_door`, `make_window`, `make_bbox` via `SceneScriptCompiler`).       | Whenever scattering trees/props without overlap, carving roads into terrain, generating city blocks/interiors, pathfinding NPC crowds, or compiling room layouts. |
| **`docs/game-system-design/04-rendering-camera-and-game-feel.md`**   | **Real-Time Rendering, Camera Systems & Game Feel ("Juice")**: Critically damped spring chase/orbit camera with velocity look-ahead & cornering Dutch roll (`ChaseCameraSystem3D`), Mark Brown GMTK / Squirrel Eiserloh 6-DOF trauma camera shake ($S = T^2$), hit-stop frame freeze, FOV speed-warp, PBR energy conservation (`ACESFilmicToneMapping` + PMREM IBL), tight player-snapped directional shadow frustum (`updateTightPlayerShadowFrustum`), and WebGL draw-call / `InstancedMesh` culling budgets. | Whenever wiring `THREE.PerspectiveCamera`, lighting/shadows, impact feedback, or optimizing frame rates to hit 60 FPS.                                            |
| **`docs/game-system-design/05-genre-system-blueprints.md`**          | **Complete Genre System Design Blueprints**: End-to-end specifications (Entity list, HFSM states, Win/Lose loop, HUD DOM IDs, Camera mode, WebAudio stems, and `.glb` 3D asset breakdown) for 6 genres: **(1) 3D Circuit / Street Racer**, **(2) 3D Open-Zone Explorer / Bazaar Sim**, **(3) 3D Platformer / Parkour**, **(4) Top-Down / Twin-Vector Arena**, **(5) 3D Puzzle / Sokoban / Escape Room**, and **(6) Rhythm / Endless Runner**.                                                                   | At **Step 0e (Research First)** when scoping a new game or upgrading an existing prototype into a complete, deep playable experience.                             |

---

## Real-World 3D City & Bazaar Extruder (`src/tools/osm_city_3d.py`)

When a game takes place in a city, street circuit, harbor, or bustling bazaar (e.g., Lucknow Hazratganj Bazaar, Monaco Harbor Circuit, Tokyo Shibuya Crossing, NYC Times Square, or any custom `(lat, lon)`), generate a real multi-mesh `.glb` city block using `src/tools/osm_city_3d.py` powered by `trimesh`, `manifold3d`, `shapely`, and `scipy`:

```bash
# Built-in presets (with automatic offline procedural fallback if Overpass API is unreachable/rate-limited):
python3 src/tools/osm_city_3d.py --preset lucknow_hazratganj --radius 200 --out public/assets/models/lucknow_bazaar_city.glb
python3 src/tools/osm_city_3d.py --preset monaco_harbor --radius 250 --out public/assets/models/monaco_harbor_city.glb
python3 src/tools/osm_city_3d.py --preset tokyo_shibuya --radius 200 --out public/assets/models/tokyo_shibuya_city.glb
python3 src/tools/osm_city_3d.py --preset nyc_times_square --radius 200 --out public/assets/models/nyc_times_square_city.glb

# Custom real-world coordinates:
python3 src/tools/osm_city_3d.py --lat 26.8500 --lon 80.9462 --radius 250 --out public/assets/models/custom_city.glb
```

### What `osm_city_3d.py` Produces

1. Queries OpenStreetMap Overpass API for `building`, `highway`, `waterway`/`natural=water`, and `landuse=grass|park|plaza` within `--radius` meters (and falls back deterministically to an authentic procedural district layout if offline or rate-limited).
2. Projects `(lat, lon)` to local metric coordinates `(x, z)` centered at `(0, 0)`.
3. Extrudes every building footprint polygon via `shapely` + `trimesh` by its `building:levels * 3.5m` (or `height` tag) with separate PBR facade, recessed window-band, parapet cornice, and roof materials.
4. Builds 3D road ribbons, sidewalks, plazas/parks, and water basins, exporting a single game-ready multi-mesh `.glb` ready to load via `WorldRealism.loadGlbModel()`.

---

## Mandatory Workflow When Designing Any Game

1. **Identify the Matching Blueprint**: Read `docs/game-system-design/05-genre-system-blueprints.md` first to lock the entity list, HFSM state graph, HUD contract, camera mode, audio stems, and `.glb` asset list.
2. **Pull Copy-Ready Core Systems**:
   - Use `FixedTimestepLoop`, `HierarchicalStateMachine`, `ZeroGCPool`, and `SpatialHashGridXZ` from `01-architecture-patterns.md`.
   - Use `VehicleDynamics3D` or `CharacterController3D` from `02-vehicle-and-character-physics.md`.
   - Use `samplePoissonDisc2D`, `CentripetalTrackSpline`, `WaveFunctionCollapseGrid`, `CrowdFlowField`, or `SceneScriptCompiler` from `03-procedural-worlds-and-algorithms.md`.
   - Use `ChaseCameraSystem3D` (with 6-DOF trauma shake + FOV speed-warp) and `updateTightPlayerShadowFrustum` from `04-rendering-camera-and-game-feel.md`.
3. **Verify Against Visual & Physics Gates**:
   - Run `node src/verifier/visual_qa_gate.js public/live-preview` to confirm zero inline scripts, real `.glb` models via `GLTFLoader`, zero primitive box/cone fakes, 3D `InstancedMesh` wind-sway grass blades, and `ACESFilmicToneMapping`.
