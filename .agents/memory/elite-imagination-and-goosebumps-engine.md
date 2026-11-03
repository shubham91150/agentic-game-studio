---
name: Elite Imagination Engine & Master Reference Bible (Hitman, Resident Evil, Hello Neighbor 2 & All Genres)
description: Comprehensive reference bible and imagination protocol giving the agent deep systemic game-design patterns, clockwork stealth/distraction mechanics, multi-step puzzle chains, autonomous micro-detailing, and goosebump engineering across all genres.
type: project
---

# Elite Imagination Engine & Master Reference Bible (Goosebump & Masterpiece Engineering)

> **Core Mission**: Do not merely place 3D models in a room. Engineer **living, breathing, systemic clockwork worlds** that give the player **goosebumps** through peak micro-detailing, emergent cause-and-effect mechanics, and psychological atmosphere — at the level of **Hitman (World of Assassination)**, **Resident Evil (RE2 Remake / RE7 / Village)**, **Hello Neighbor 2**, **Forza Horizon**, and **Elden Ring / Zelda**.

Run `node src/tools/elite_imagination_engine.js --prompt "<game idea>" --archetype "<hitman|resident-evil|hello-neighbor|racing|action-rpg|scifi>"` before architecting any game or major stage to generate a bespoke **Goosebump & Systemic Interaction Blueprint**.

---

## 1. Archetype Reference 1: HITMAN (Agent 47) — "The Clockwork Stealth & Manipulation Sandbox"

Why _Hitman_ feels like a masterpiece: **Every object in the world is a systemic tool that manipulates AI perception, routines, and cause-and-effect.**

- **Rule 1 — Acoustic Lures & Distraction Propagation**:
  - The player can trigger or throw acoustic lures (ringing a desk bell, winding a grandfather clock, tossing a coin/bottle, flipping a breaker switch).
  - The sound emits a spatial stimulus `(stimX, stimZ, radius)` that interrupts the nearest NPC/Enemy's `PATROL` routine, transitions them to `INVESTIGATE (SUSPICIOUS)`, and makes them physically walk over to inspect the source for 6–8 seconds while muttering a voice line — opening a tactical window for the player to sneak behind their back!
- **Rule 2 — Environmental Sabotage & Traps**:
  - Interactive world fixtures (`Chandelier_01`, fuseboxes, oil lamps, locked doors) can be sabotaged or triggered to create diversions, blackouts, or environmental hazards.
- **Rule 3 — "Swiss-Cheese" 3-Route Level Topology**:
  - Never design a single linear corridor bottleneck. Every objective room MUST have at least **2–3 distinct tactical approaches**:
    1. _Direct/High-Risk Route_ (main corridor, well-lit, patrolled),
    2. _Stealth/Flanking Route_ (dark side-corridor or connecting classroom doors using hiding cabinets),
    3. _Systemic/Puzzle Route_ (trigger an acoustic distraction in Room A to pull the stalker away from Room B).
- **Rule 4 — Tactile "Instinct / Focus Sense" Pulse (Optional Ability)**:
  - Holding a focus key (`Q` / button) briefly highlights interactive puzzle mechanisms, hiding spots, and the acoustic/heartbeat pulse of nearby threats through walls.

---

## 2. Archetype Reference 2: RESIDENT EVIL (RE7 / RE2 Remake / Village) — "Survival Tension, Puzzle Boxes & Stalker Pacing"

Why _Resident Evil_ gives unforgettable goosebumps: **Every resource is a tense choice, every room is an interconnected puzzle box, and the atmosphere breathes.**

- **Rule 1 — Multi-Step Interconnected Puzzle Chains (Never Just "Walk Up and Grab Key")**:
  - Instead of leaving the final key sitting openly on a box, build a **2-to-3 step tactile puzzle chain**:
    - _Step A_: Search `drawer_cabinet` / `treasure_chest` (`E — Search`) to find a **Winding Key / Brass Bell / Fuse**.
    - _Step B_: Use it on a landmark mechanism (e.g. `vintage_grandfather_clock_01` or Chapel Altar Candelabra) → the Grandfather Clock chimes loudly across the hall (acting as a Hitman-style acoustic lure that pulls the enemy toward the hall while unlocking the secret compartment containing the **Chapel Key**!).
- **Rule 2 — Light-vs-Stealth Tension Trade-off**:
  - Torch ON = clear visibility + calm nerves, but Enemy sight range increases (`14m`).
  - Torch OFF = Enemy sight range drops (`6m`), allowing you to slip past in the dark using moonlight shafts and lightning flashes!
- **Rule 3 — Safe-Haven Contrast vs Stalker Pressure**:
  - Contrast warm amber candle-lit pockets (where the player can catch their breath and read lore notes) against cold, fog-drenched corridors where the stalker's heavy footsteps and distant whispers echo with cathedral reverb.

---

## 3. Archetype Reference 3: HELLO NEIGHBOR 2 — "Adaptive Stalker AI & Tactile Hide-and-Peek"

Why _Hello Neighbor 2_ feels alive: **The AI learns your habits, and every piece of furniture is physically interactive.**

- **Rule 1 — Wardrobe / Cabinet Peek-and-Hide (`GothicCabinet_01`)**:
  - Pressing `E` near a wardrobe (`GothicCabinet_01`) smoothly moves the camera inside the cabinet looking out through a narrow vertical gap between the doors, muffles ambient sound (low-pass filter at `600Hz`), and hides the player (`isHidden() = true`) unless the enemy actually saw the player enter!
- **Rule 2 — Adaptive Heatmap AI Memory**:
  - Track which room the player spends the most time in (`roomHeatmap[roomName] += dt`). The AI Director (`POST /api/studio/ai/director` + `enemy.js`) biases the stalker's patrol spurs toward the player's most-visited room so the player can never camp safely in one spot!
- **Rule 3 — Stylized Warm-vs-Cold Visual Contrast & Lived-In Clutter**:
  - Deep teal-blue shadows (`#0b1929`) vs warm golden-amber lantern pools (`#ff9e3d`) with `UnrealBloomPass` halos, ground contact-shadow AO discs under every prop, crooked wall picture frames (`hanging_picture_frame_01`), abandoned `wheelchair_01`, `Rockingchair_01`, and scattered encyclopedia books (`book_encyclopedia_set_01`).

---

## 4. Universal "12 Goosebump & Peak Micro-Detail Layers" (Mandatory Across ALL Games)

Every game built in the Studio MUST include at least **6 of these 12 living micro-detail layers** in its `update(dt, t)` loop so the world NEVER feels static or dead:

1. **Autonomous Living Props**: `Rockingchair_01` gently rocking back and forth on its own (`rotation.x = Math.sin(t * 1.4) * 0.06`); `Chandelier_01` / `lantern_chandelier_01` swaying subtly from ceiling chains (`rotation.z = Math.sin(t * 0.9) * 0.03`); `vintage_grandfather_clock_01` ticking rhythmically.
2. **Proximity EM / Light Interference**: When the stalker/threat comes within `9m` of the player, nearby wall lanterns and the player's held lantern flicker erratically (`intensity *= 1 + Math.sin(t * 43) * 0.35 * proximityFactor`) — a diegetic goosebump warning before you even see the enemy!
3. **First-Person Held Viewmodel Inertia**: The held 3D `Lantern_01` sways with mouse-look lag, dips on footsteps, lowers when crouching, and trembles slightly when the enemy is within `6m`!
4. **Dynamic Heartbeat & Breath Audio-Visual Coupling**: As threat distance shrinks (`< 12m`), 55Hz sub-bass heartbeat speeds up (`65 -> 145 BPM`) and screen-edge crimson/dark vignette pulses in sync with the heartbeat.
5. **Volumetric Moonlight & Lightning God-Rays**: High wall-mounted windows (`y = 1.85m`) cast translucent additive moonlight shafts that flare brightly during lightning strikes, followed `300–800ms` later by rolling cathedral-reverbed thunder.
6. **3D Spatial Audio & Occlusion**: Enemy footsteps and whispers pan across left/right stereo (`StereoPannerNode`) based on camera angle and muffle through walls (`BiquadFilterNode` low-pass).
7. **Interactive Distraction Lures**: Searchable cabinets/chests (`drawer_cabinet`, `treasure_chest`) and ringable mechanisms (`vintage_grandfather_clock_01`) that emit acoustic stimuli to lure the enemy away.
8. **Ground Contact Shadow AO**: Soft dark radial contact-shadow discs under every piece of furniture so every prop has physical weight on the floor.
9. **PMREM Specular IBL**: Procedural interior environment map (`scene.environment`) giving brass, glass, polished wood, and wet stone tiles realistic 3D reflections.
10. **Soft Radial Atmospheric Particles**: Drifting ash flakes and warm glowing embers around lanterns (`CanvasTexture` Gaussian radial alpha, `AdditiveBlending`).
11. **Environmental Lore & Narrative Clues**: Readable/inspectable notes or chalkboards that tell the story of the world and hint at puzzle solutions.
12. **Live Meta AI Director (`POST /api/studio/ai/director`)**: Real-time `muse-spark-open-1026` brain adapting enemy tactics, speaking context-aware whispers, and triggering environment events (`lantern_blackout`, `storm_surge`, `ash_vortex`, `chapel_omen`).
