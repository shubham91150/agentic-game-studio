# 05 — Genre System Design Blueprints

Complete end-to-end architectural specifications for 6 core 3D game genres. Every blueprint defines its **Entity Archetypes**, **Hierarchical State Machines**, **Win/Lose & Progression Loop**, **HUD Contract**, **Camera Mode**, **WebAudio Stems**, and **Required `.glb` / Procedural 3D Asset Breakdown** (strictly compliant with `visual_qa_gate.js` — zero primitive box/cone fakes).

---

## Blueprint 1: 3D Circuit / Street Racer

### 1. Entity List & Component Signatures

- **`PlayerVehicle`**: `VehicleDynamics3D` (Marco Monster weight transfer, slip-angle cornering, 6-speed gearbox, drift handbrake, nitro reservoir), 4-wheel independent spin/steer sub-nodes, brake-light emissive material, exhaust flame particle emitter, skidmark ribbon pool.
- **`AIRivalVehicle` (3–7 rivals)**: Centripetal Catmull-Rom spline follower with lateral overtaking offset ($s \pm \Delta w$), rubber-banding throttle scalar ($\in [0.88, 1.08]$ based on signed spline distance to player), brake-zone look-ahead curvature sensor.
- **`TrackSpline & Checkpoints`**: Closed centripetal Catmull-Rom loop (`CentripetalTrackSpline`), red-white bevelled kerbs on high-curvature apexes, ordered checkpoint gates ($0 \dots M-1$) with directional plane-crossing dot-product check to prevent reverse lap cheating.
- **`TracksideEnvironment`**: Grandstands, pit building, barrier walls, street lamps, Poisson-disc scattered `.glb` trees outside road shoulder, `WorldRealism.create3DGrassField` (25,000 wind-sway blades).

### 2. State Machines

- **Game Loop FSM**: `MenuState` $\to$ `GridCountdownState` (3–2–1–GO with revving throttle allowed) $\to$ `RacingState` $\leftrightarrow$ `PausedState` $\to$ `FinishLapSummaryState` (Gold/Silver/Bronze medal + Ghost replay save).
- **Vehicle Substate**: `GripDriving` $\leftrightarrow$ `DriftSliding` ($|\alpha_{\text{rear}}| > 0.18\text{ rad}$, awards Drift Boost meter) $\leftrightarrow$ `NitroBoosting` (FOV $+14^\circ$, blue exhaust shockwave) $\leftrightarrow$ `OffTrackRecovery` (grass drag $3\times$, auto-reset to spline if stuck $> 3\text{ s}$).

### 3. Win / Lose & Progression Loop

- **Win**: Complete $N$ laps (default 3) finishing in P1–P3 or beating target medal time.
- **Lose**: Time-trial clock expires before checkpoint, or finishing outside podium.

### 4. HUD Contract

- `#val-speed` (km/h digital readout + tach RPM bar + gear indicator `1..6`), `#val-lap` (`LAP 2/3`), `#val-pos` (`POS 1/6`), `#val-time` (`01:24.82` + sector delta `-0.42s`), `#val-nitro` (0–100% boost bar), mini-map `<canvas>` rendering spline + rival dots.

### 5. Camera Mode

- `ChaseCameraSystem3D` (`distBack: 6.8m`, `heightUp: 2.3m`, `springOmega: 15.0`, cornering Dutch roll $\pm 3^\circ$, FOV speed-warp $58^\circ \to 76^\circ$, kerb rumble trauma $0.12$, barrier impact trauma $0.55$).

### 6. Audio Stems (WebAudio Synth / Layered Nodes)

- Dual detuned sawtooth/triangle oscillator engine synth pitch-tracked to `RPM` ($70\text{ Hz} \to 340\text{ Hz}$) with low-pass filter opening on throttle; bandpass white-noise tire screech modulated by `slipRatioRear`; turbo blow-off chirp on upshift; countdown chime notes.

### 7. Required 3D Asset Breakdown

- **Vehicles**: High-poly `.glb` sports/street cars (`/studio/assets/models/` or Polyhaven/Blender `blender_pro_builder.py`).
- **World / City / Track**: Real OSM city extrusion (`python3 src/tools/osm_city_3d.py --preset monaco_harbor`) OR carved spline terrain + `WorldRealism.createRealisticBuilding`, Polyhaven `concrete_road_barrier_02`, `street_lamp_01`, `jacaranda_tree`, and `WorldRealism.create3DGrassField`.

---

## Blueprint 2: 3D Open-Zone Explorer / Bazaar Sim (NPC Shopkeepers, Quests, Inventory, Dialogue)

### 1. Entity List & Component Signatures

- **`PlayerExplorer`**: `CharacterController3D` (walk/sprint, jump with coyote time + jump buffer, step-up climbing $0.35\text{ m}$), interaction proximity sphere ($R = 2.6\text{ m}$), `InventoryBag` (coins, spices, brass lanterns, silk carpets, quest tokens), stamina bar.
- **`NPCShopkeeper` (4–8 named merchants)**: Anchored at bazaar stalls (`spice_merchant`, `lantern_smith`, `carpet_weaver`, `chai_vendor`, `scholar_guide`), head-look IK toward player within $5\text{ m}$, dialogue tree loaded from `story.js` (`src/tools/npc_dialogue.js`), trade catalog `{ itemId, price, questGrant }`.
- **`AmbientBazaarCrowd` (15–40 walkers)**: Driven by `CrowdFlowField` + `SpatialHashGridXZ` separation steering between plaza waypoints.
- **`InteractableStall & CollectibleRelics`**: Market stalls with emissive warm lanterns (`PointLight` `#ffaa44`), inspectable chests/crates, delivery drop-off shrines.

### 2. State Machines

- **Game Loop HFSM (Pushdown)**:
  - Base: `MenuState` $\to$ `FreeRoamExploreState`.
  - Pushdown Overlays: `DialogueModalState` (pushes when pressing `E` near NPC; pauses player locomotion, zooms camera smoothly toward merchant, displays speaker portrait + branching choices), `ShopTradeState`, `QuestJournalState`, `PausedState`, `VictoryFestivalState`.
- **Quest State Machine**: `NotStarted` $\to$ `ActiveObjective(stepIndex)` $\to$ `ReadyToTurnIn` $\to$ `Completed` (unlocks district gate or festival fireworks).

### 3. Win / Lose & Progression Loop

- **Core Loop**: Explore bustling bazaar districts $\to$ talk to NPCs (`E` / tap interact) $\to$ fulfill multi-step trade/fetch/appraisal quests & haggle with coins $\to$ restore the Grand Bazaar Festival before sundown timer (or open-ended completion of all 5 master merchant commissions).
- **Lose / Setback**: Running out of festival clock or stamina collapse (respawns at central fountain with coin penalty).

### 4. HUD Contract

- `#val-coins` (Gold Dinars / Rupees), `#val-quest` (active objective tracker + compass distance in meters), `#interaction-prompt` (`[E] Talk to Ustad Karim — Lantern Smith`), `#dialogue-box` (speaker name, mood badge, typewriter line, `[1/2/3]` response buttons), `#inventory-bar` (5 quick-slots).

### 5. Camera Mode

- Over-the-shoulder third-person orbital spring camera (`distBack: 4.8m`, `heightUp: 2.1m`, mouse/touch yaw-pitch orbit) that smoothly interpolates to a 2-shot framing pivot (`distBack: 2.6m`, `fov: 46`) when `DialogueModalState` is pushed onto the HFSM stack.

### 6. Audio Stems

- Warm Middle-Eastern / Indian / Mediterranean pentatonic plucked-oud & tabla procedural loop; spatialized bazaar murmur bed; coin clink SFX; dialogue syllable blip pitched per NPC voice profile; quest completion fanfare.

### 7. Required 3D Asset Breakdown

- **District Geometry**: Real-world bazaar footprint generated via `python3 src/tools/osm_city_3d.py --preset lucknow_hazratganj --radius 200 --out public/assets/models/lucknow_bazaar.glb` + `WorldRealism.createRealisticBuilding`.
- **Stalls & Props**: Polyhaven photogrammetry `.glb` models (`CoffeeCart_01`, `Lantern_01`, `Barrel_01`, `modular_street_seating`, `street_lamp_01`) + `.glb` characters & trees.

---

## Blueprint 3: 3D Platformer / Parkour Course

### 1. Entity List & Component Signatures

- **`ParkourRunner`**: `CharacterController3D` with 3-phase jump gravity, coyote time ($0.11\text{ s}$), jump buffer ($0.12\text{ s}$), air-dash impulse ($v_{\text{dash}} = 16\text{ m/s}$ for $0.16\text{ s}$, 1 charge refreshed on ground touch), wall-slide / wall-jump normal reflector, squash-and-stretch visual mesh pivot.
- **`KineticPlatforms`**:
  - `MovingPlatform`: Sinusoidal or waypoint-looping kinematic body that transfers its frame delta $(\Delta x, \Delta y, \Delta z)$ to the grounded player.
  - `CrumbleBlock`: Shakes for $0.55\text{ s}$ on step, drops away for $3.0\text{ s}$, then respawns with scale-pop tween.
  - `BouncePad`: Launches player to $v_y = 19\text{ m/s}$ with `addTrauma(0.35)` and chord SFX.
- **`CheckpointTotem & SkyShards`**: Activated checkpoints update `respawnTransform`; collectible floating `.glb` crystals increment score and unlock the summit portal.

### 2. State Machines

- **Player Movement HFSM**:
  - Superstate `Grounded` $\supset$ `{ Idle, Run, LandSquash }`.
  - Superstate `Airborne` $\supset$ `{ JumpRise, ApexHang, FastFall, CoyoteGrace }`.
  - Interrupt States: `AirDashState`, `WallSlideState`, `RespawnFadeState`.

### 3. Win / Lose & Progression Loop

- **Win**: Collect required Sky Shards and reach the Summit Beacon before the course timer runs out.
- **Lose**: Falling below kill-plane ($y < -15\text{ m}$) deducts 1 heart and respawns at last checkpoint totem; losing all 3 hearts triggers `GameOverState`.

### 4. HUD Contract

- `#val-shards` (`12 / 15`), `#val-hearts` (`3`), `#val-timer` (`02:15.4`), `#dash-indicator` (ready/cooldown icon), `#checkpoint-banner` toast.

### 5. Camera Mode

- Elevated third-person platforming camera (`distBack: 8.0m`, `heightUp: 3.8m`, downward pitch $-16^\circ$) with vertical deadzone so jumping does not jerk camera height unless the player lands on a higher ledge; blob drop-shadow decal directly beneath player feet on the ground below for exact landing depth perception.

### 6. Audio Stems

- Upbeat synth-arp tempo loop; pitch-ascending jump whoosh; crisp landing thud scaled by fall speed; crystal harmonic chime (pentatonic scale ascending with combo); bounce-pad spring boing.

### 7. Required 3D Asset Breakdown

- Architectural ruins, bridges, boulders (`boulder_01`), trees (`jacaranda_tree`, `quiver_tree_02`), animated `.glb` runner character, and `WorldRealism.createRealisticWater` below the canyon/island course.

---

## Blueprint 4: Top-Down / Twin-Vector 3D Arena

### 1. Entity List & Component Signatures

- **`ArenaPilot`**: Omni-directional XZ movement (`groundAccel: 65 m/s²`), independent aim yaw (mouse cursor raycast onto ground plane $y = h$ or right virtual thumbstick), dash-invulnerability iframe window ($0.18\text{ s}$), weapon heat/cooldown meter.
- **`SwarmDrones / Chasers / Turrets`**: Managed by `TinyECS` + `ZeroGCPool` + `CrowdFlowField` + `SpatialHashGridXZ` for 60+ simultaneous agents at 60 FPS with zero GC allocations.
- **`ProjectilePool & PickupPool`**: Pooled energy bolts, shockwave rings, multiplier gems, and shield repair canisters.

### 2. State Machines

- **Wave Director FSM**: `WaveIntroBanner` $\to$ `SpawningActiveWave` $\to$ `ClearRemainingEnemies` $\to$ `BetweenWaveUpgradeDraft` (pick 1 of 3 modular upgrades) $\to$ `BossEncounterState` $\to$ `VictoryState`.

### 3. Win / Lose & Progression Loop

- **Win**: Survive all $W$ waves (e.g., 5 escalating waves + final guardian) and defeat the arena boss.
- **Lose**: Hull integrity reaches `0`.

### 4. HUD Contract

- `#val-score` + `#val-multiplier` (`x4.0` decay bar), `#val-wave` (`WAVE 3/5`), `#val-hull` (segmented health bar), `#upgrade-cards` modal between waves.

### 5. Camera Mode

- High-angle angled orthographic/perspective tactical camera (`heightUp: 22m`, `distBack: 14m`, pitch $-58^\circ$) with cursor-lead offset ($\text{lerp}$ $15\%$ toward aim point) + GMTK trauma shake + $50\text{ ms}$ hit-stop on elite/boss takedowns.

### 6. Audio Stems

- Driving bassline pulse synchronized to wave intensity; rapid percussive fire transients with slight random pitch $\pm 6\%$; shield-break glass sub-drop; combo multiplier rising synth riser.

### 7. Required 3D Asset Breakdown

- Real `.glb` rovers/mechs/drones, industrial arena structures (`Barrel_01`, `concrete_road_barrier_02`, `street_lamp_01`), and `InstancedMesh` perimeter details.

---

## Blueprint 5: 3D Puzzle / Sokoban / Architectural Escape Room

### 1. Entity List & Component Signatures

- **`GridTactician / Inspector`**: Discrete grid-aligned movement (with smooth $0.14\text{ s}$ ease-out visual interpolation) OR first/third-person room explorer; `InputCommandRecorder` holding full reversible command history (`MoveAndPushCommand.execute()` / `.undo()`).
- **`PushableRelicCrates / LaserMirrors / PressurePlates`**:
  - `Crate`: Occupies integer tile $(gx, gz)$; slides onto $(gx + dx, gz + dz)$ if target tile is empty or a pressure plate.
  - `PressurePlate`: Depresses $0.06\text{ m}$ when weighted; emits `"circuit_changed"` on `GameEventBus`.
  - `LogicGateDoor`: Opens when all linked pressure plates / beam receivers are active.

### 2. State Machines

- **Puzzle Turn FSM**: `AwaitingInputState` $\to$ `AnimatingStepState` ($0.14\text{ s}$ tween) $\to$ `EvaluatingCircuitState` (checks plate/beam graph) $\to$ `RoomSolvedTransition` (loads next SceneScript room layout).
- Supports instant `[Z]` Undo (`InputCommandRecorder.undoLast()`) and `[R]` Room Reset at any time without reloading assets.

### 3. Win / Lose & Progression Loop

- **Win**: Solve all $K$ architectural chambers (3–5 escalating rooms) within par move count for 3-Star Mastery.
- **Lose**: Soft-locks are impossible to get stuck in because `[Z] Undo` and `[R] Reset Room` are always active and advertised on the HUD.

### 4. HUD Contract

- `#val-room` (`CHAMBER 2 / 4`), `#val-moves` (`MOVES: 14 (PAR: 18)`), `#val-plates` (`PLATES: 3 / 3 ACTIVE`), prominent `[Z] Undo` and `[R] Reset` buttons for keyboard + touch.

### 5. Camera Mode

- Isometric / diorama architectural framing (`fov: 38`, `distBack: 16m`, `heightUp: 15m`) with `[Q]/[E]` $90^\circ$ smooth orbital snap rotation around the room center.

### 6. Audio Stems

- Calm ambient marimba/kalimba puzzle theme; stone crate scrape + resonant wooden/stone lock click when a crate settles onto a pressure plate; harmonic chord progression as each circuit node activates.

### 7. Required 3D Asset Breakdown

- Room walls/doors/windows compiled via `SceneScriptCompiler` + `WorldRealism.createRealisticBuilding` materials, Polyhaven `.glb` crates/barrels/lanterns (`Barrel_01`, `Lantern_01`), and character `.glb`.

---

## Blueprint 6: 3D Rhythm / Endless Highway Runner

### 1. Entity List & Component Signatures

- **`LaneSurfer`**: 3-lane or 5-lane lateral switching ($x \in \{-3.5, 0, +3.5\}\text{ m}$) using critically damped spring lateral snap ($\omega_n = 28\text{ rad/s}$) + bank roll tilt, jump + slide ducking collider, forward speed $v_z(t) = v_0 + a_{\text{ramp}} t$ clamped to $[18, 42]\text{ m/s}$.
- **`TreadmillChunkPool` (`ZeroGCPool`)**: 6 recycled $60\text{ m}$ highway/city corridor chunks. As the player passes $z_{\text{chunk}} + 60\text{ m}$, the rear chunk recycles to the front with a new WFC/pattern obstacle + beat-note layout (zero runtime mesh creation).
- **`BeatOrbs & BarrierObstacles`**: Spawned along lane markers quantized to musical eighth/quarter-note grid intervals $\Delta z = v_z \cdot (60 / \text{BPM})$.

### 2. State Machines

- **Runner FSM**: `MenuState` $\to$ `BeatSyncStartState` $\to$ `RunningFlowState` (with `FeverMode` substate at $25+$ streak) $\to$ `CrashSlowMoState` ($0.4\text{ s}$ trauma + hit-stop) $\to$ `RunSummaryState`.

### 3. Win / Lose & Progression Loop

- **Win**: Reach the target distance / song completion portal (e.g., $1500\text{ m}$) or achieve Gold Score threshold.
- **Lose**: Frontal collision with an obstacle (glancing lane-switch collision stumbles and resets combo; second stumble within $4\text{ s}$ or frontal hit ends run).

### 4. HUD Contract

- `#val-score`, `#val-combo` (`24x STREAK` with pop-scale tween on every pickup), `#val-distance` (`840m / 1500m` progress bar), `#fever-meter`.

### 5. Camera Mode

- Low-slung kinetic chase camera (`distBack: 5.2m`, `heightUp: 1.9m`) that sways laterally $65\%$ of player lane X so lane switches feel crisp and readable ahead, widening FOV to $74^\circ$ during `FeverMode`.

### 6. Audio Stems

- Beat-locked WebAudio drum + bass + arpeggiator clock (`AudioContext.currentTime` lookahead scheduler) where every orb pickup triggers a quantized lead synth note in key with the backing track.

### 7. Required 3D Asset Breakdown

- Real `.glb` runner/vehicle avatar, corridor buildings (`osm_city_3d.py` or `WorldRealism.createRealisticBuilding`), street lamps (`street_lamp_01`), barriers (`concrete_road_barrier_02`), and glowing `.glb` collectible pickups.
