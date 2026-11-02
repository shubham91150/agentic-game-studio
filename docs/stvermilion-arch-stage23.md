# Ashes of St. Vermilion — Stage 2+3 Architecture Extension (Subagent A)

Extends `docs/stvermilion-arch.md` (Stage 1: topology, `StV_*` interfaces, lights, props, states) with Mother Agatha enemy AI (Stage 2) and the lose state + full loop (Stage 3). Stage 1 files are extended, never rewritten; Stage-1 `window.StV_*` interfaces stay VERBATIM — only the ADDITIVE items listed in §1/§5 are allowed.

Provenance: behaviour states, transition thresholds, horror beats, and difficulty multipliers below are VERBATIM from `muse-wonder-1.0` (Meta Model API `https://api.meta.ai/v1/responses`, key via repo path `resolveMetaApiKey()`), called live during this design task; canonical transcript in task evidence (`wonder_bt_canonical.json`: 5 states, 9 transitions, 5 beats, 3 difficulties). Anything this doc adds around Wonder's numbers (HFSM mapping, waypoint coordinates, grid spec, raycast rules, DOM contracts) is marked `[DESIGN-NOTE]`. Reconciliations where Wonder's text meets binding Stage-1/brief constraints are marked `[RECONCILED]` with the reason.

Conventions: all units METERS/SECONDS, one floor y=0. Speeds binding per brief: patrol 2.0 m/s, chase 4.5 m/s, player run 5.2 m/s, catch radius 0.8 m. All sense radii/timers are Normal-difficulty baselines; §2 Difficulty scales them. No outdoor content in this interior stage. Closest genre blueprint (`05-genre-system-blueprints.md`, none is stealth-horror): win/lose+HUD structure follows Blueprint 5 (escape-room: clear-vs-reset loop, par-style timer) with a Blueprint 4-style wave-director pacing the horror beats; enemy brain is the HFSM from `01-architecture-patterns.md` §2.

## 1. EnemyInterface

Verbatim shape from the brief (file `public/live-preview/enemy.js`):

```javascript
window.StV_Enemy = {
  create: function (scene, colliders, bounds, player) {
    // returns { update(dt, t, playerState), getState(), reset(), setAlert(level), onCaught(cb) }
  }
};
```

### create(scene, colliders, bounds, player)

- `scene` (THREE.Scene): Agatha mesh + lantern-glow sprite are parented here. No new lights (Stage-1 light budget is final).
- `colliders` (Array<{x0,z0,x1,z1}>, authoritative from `StV_Levels.buildWorld().colliders`): used for BOTH the pathfinding blocked-grid (§3) and sight raycast occlusion (§4). `enemy.js` never invents wall geometry.
- `bounds` ({x0,z0,x1,z1} = {-12,-9,+12,+9}): clamps all steering; waypoints outside bounds are a spec bug.
- `player` (StV_Player instance): kept for interface verbatim; per-frame truth comes from `playerState` in `update`. `player.pos()` is used ONLY as a fallback when `update` receives a null `playerState` (debug warp paths). [DESIGN-NOTE]
- Returns the enemy handle (methods below). Returns `null` ONLY if `scene` is missing (game boots without Agatha rather than crashing). [DESIGN-NOTE]

### update(dt, t, playerState)

- `dt`: clamped seconds (≤0.05); `t`: run-time seconds for director/beats. Advances HFSM (§2), steering (§3), senses (§4). Returns `undefined`.
- `playerState` (C's game.js MUST pass this shape every frame while `state === 'playing'`): `{ x: number, z: number, noise: number (0..1, straight from StV_Player.noiseLevel()), torchOn: bool (StV_Player.isTorchOn()), crouch: bool (StV_Player.isCrouch()) }`. Stage-1 ground truth: `noiseLevel()` = 0 stationary, 0.25 crouch-move, 0.55 walk, 1.0 run (smoothed ≈6/s, so ≈0.5 s attack — matches Wonder's 0.5 s dwell). [DESIGN-NOTE: field list; value semantics are verbatim Stage-1 code]

### getState()

Returns snapshot `{ state: 'PATROL'|'SUSPICIOUS'|'CHASE'|'SEARCH'|'CAUGHT', suspicion: 0..100, dist: meters to player, alert01: 0..1 }`. Consumed by game.js for `hud-enemy`, `StV_Audio.setAlert01`, and `?debug=1` (FPS + XYZ + Agatha state). [DESIGN-NOTE: snapshot shape]

### reset()

Respawns Agatha at R1 (0,-7.5) facing R2, state PATROL, suspicion 0, all timers 0, route index 0, spur cycle 0, finale flag false. Called on Start/Retry/Restart and Quit-to-menu. [DESIGN-NOTE]

### setAlert(level)

Director override, `level ∈ {0,1,2}` (0 calm→PATROL bias, 1 suspicious ping with stimulus=player pos, 2 force CHASE repath). Used ONLY by scripted beats (§2 Beats); free-play senses otherwise rule. Auto-clears to sensed state within one transition evaluation (no latch). [DESIGN-NOTE]

### onCaught(cb)

Registers `cb()` fired ONCE per catch when the CAUGHT edge triggers (≤0.8 m for 0.1 s). game.js routes it to the gameover sequence (§5). Registering replaces any previous callback. [DESIGN-NOTE]

### ADDITIVE interface list (Stage-1 UNCHANGED)

1. New global `window.StV_Enemy` (shape above) — nothing else gains/loses a method. 2. `window.game.enemy` debug handle (see §5). No Stage-1 `StV_*` signature changes in this section; the audio/UI/save additions live in §5/§6.

## 2. BehaviourTree

### HFSM mapping [DESIGN-NOTE]

Wonder designed a flat 5-state machine; C implements it on the `01-architecture-patterns.md` HFSM: superstate `Active ⊃ {PATROL, SUSPICIOUS, CHASE, SEARCH}` owns shared per-tick work (senses → suspicion meter, path-follow steering, stuck watchdog), each substate owns only its speed/target/dwell. `CAUGHT` is a pushed interrupt (terminal): on push it fires `onCaught`, plays the 2 s jumpscare beat, and takes no further transitions until `reset()`. This satisfies the brief's "CAUGHT edge" (a one-way edge, never a loop) while keeping Wonder's 5-state vocabulary for `getState()`/`hud-enemy`.

### States (Wonder VERBATIM speeds; movement targets [DESIGN-NOTE])

| State | Speed | Wonder movement/sense core | C target rule |
|---|---|---|---|
| PATROL | 2.0 m/s | Chapel/Classrooms/corridor waypoints; sight 10 m (14 m torch-ON); hear run 12 m / walk 4 m / crouch 0 m; suspicion decays 10/s | Follow cyclic route R1..R24 + spur detours (§2 Route); 0.6 s dwell + lantern sweep at H-adjacent stops (R6, R13, R20, spur ends) |
| SUSPICIOUS | 3.0 m/s | Investigate last heard/seen point up to 4 s; lantern swings to stimulus | Path to stimulus cell; on arrive, scan (yaw sweep ±70°) until 4 s timer or transition |
| CHASE | 4.5 m/s | Directly toward player (slower than run 5.2, escape by sprint); catch 0.8 m; last-known-pos memory 3 s | Repath to player cell at 2 Hz; keep Chungking 3 s memory of last seen pos for SEARCH handoff |
| SEARCH | 2.5 m/s | Check last-known pos + props/rooms within 6 m for 8 s incl. hiding spots; decay 15/s | Visit up to 3 sub-targets: last-known + nearest 2 H-props within 6 m; 8 s timer, then give-up |
| CAUGHT | 0 m/s | ≤0.8 m: lantern flare + bell + jumpscare [RECONCILED: no checkpoint reset — Stage 3 routes to `#gameover`; the "2 seconds" = jumpscare beat before gameover input arms, §5] | Freeze, face player, fire onCaught once |

[RECONCILED: Wonder's CHASE note says sprint "drains stamina" — Stage 1 has no stamina system and additive-only rules forbid inventing one, so escape balance rests on 5.2 vs 4.5 + the 3 s LOS-break rule.]

### Suspicion meter (Wonder VERBATIM, 0..100)

Fill: +40/s while player in sight (10 m, 14 m torch-ON); +25/s run noise within 12 m; +10/s walk noise within 4 m; +0/s crouch/silent. Decay: −10/s in PATROL, −15/s in SEARCH, no decay in SUSPICIOUS/CHASE. Thresholds 30 (disturb) / 100 (confirm) per transitions. [DESIGN-NOTE: meter persists across PATROL↔SUSPICIOUS↔SEARCH; CHASE entry snaps it to 100; CHASE exit (→SEARCH) holds 100 until SEARCH decay drains it; reset() zeroes it.]

### Transitions (Wonder VERBATIM conditions; evaluation order [DESIGN-NOTE])

Evaluate top-to-bottom each tick; first match fires. CAUGHT edges (T6/T9) are evaluated FIRST from any `Active` substate (distance-only, no LOS needed — she is on top of the player).

| # | From → To | Verbatim condition |
|---|---|---|
| T1 | PATROL → SUSPICIOUS | Suspicion ≥ 30 from sight within 10 m for 0.5 s (14 m torch-ON), or run noise within 12 m for 0.5 s, or walk noise within 4 m for 1.0 s |
| T2 | PATROL → CHASE | Player clearly seen within 5 m for 0.3 s AND suspicion ≥ 100 [RECONCILED: reachable only when suspicion is already 100 (scripted beat inject or carryover), since T1 fires at 30 first; primary path is T1→T3] |
| T3 | SUSPICIOUS → CHASE | Suspicion ≥ 100 after sight within 10 m for 1.0 s (14 m torch-ON), or player within 3 m for 0.3 s (proximity clause escalates regardless and snaps suspicion to 100) |
| T4 | SUSPICIOUS → PATROL | Suspicion ≤ 0 after 3 s with no sight within 10 m and no noise within 4 m |
| T5 | CHASE → SEARCH | LOS lost for 3 s AND distance > 10 m, or hidden-crouch-behind-prop for 3 s beyond 8 m |
| T6 | CHASE → CAUGHT | Distance ≤ 0.8 m for 0.1 s |
| T7 | SEARCH → CHASE | Seen within 10 m for 0.5 s (14 m torch-ON), or run noise within 12 m for 0.3 s with suspicion ≥ 100 |
| T8 | SEARCH → PATROL | Search timer ≥ 8 s with no sight within 10 m, no noise within 12 m, suspicion ≤ 0 |
| T9 | SEARCH → CAUGHT | Distance ≤ 0.8 m for 0.1 s during search check |

### Patrol route [DESIGN-NOTE; waypoint policy from brief: H1–H6 + corridor nodes]

Cyclic route (each (x,z) verified inside bounds and off wall AABBs, §3 wall table; H-adjacent stops sit 1.2–2.0 m into open floor from their prop cluster, never inside it):

R1 (0,-7.5) N-corr/spawn → R2 (10.5,-7.5) → R3 (10.5,-4.0) → R4 (9,-2) D4 gap → R5 (5,-2) ClassB → R6 (6.0,-0.5) @H2 → R5 (5,-2) → R8 (5,2) D2 gap → R9 (10.5,3.5) → R10 (0,3.5) S-corr → R11 (0,5) arch → R12 (0,7) hall → R13 (-3,6.8) @H5 → R12 (0,7) → R15 (0,5) → R16 (0,3.5) → R17 (-5,3.5) → R18 (-5,2) D1 gap → R19 (-5,-2) ClassA → R20 (-6.0,-4.5) @H1 → R19 (-5,-2) → R22 (-9,-2) D3 gap → R23 (-10.5,-4.0) → R24 (-10.5,-7.5) → R1.

Spur detours (deterministic alternation, no RNG: spur k taken when `(cycle + k) % 2 == 0`): S1 at R9: (8,5) D6 gap → (8.5,7.0) @H4 → (8,5) → resume R10. S2 between R16→R17: (-10.5,3.5) → (-8,5) D5 gap → (-8.5,7.0) @H6 → (-8,5) → (-10.5,3.5) → resume R17. S3 at R23: (-10.5,-1.5) @H3 → resume R24. Finale anchor F (+9.0,-7.5): 9.1 m from chapel door C=(0,-9), in open N-corridor [RECONCILED: the naive "9 m south of door" (0,0) is INSIDE the solid divider block — forbidden; F is the conforming point].

### Horror beats (Wonder VERBATIM content/timings; director wiring [DESIGN-NOTE])

| t (s) | Beat (verbatim) | What happens (verbatim) | Player goal (verbatim) | Director rule (game.js; never teleports except gated F) |
|---|---|---|---|---|
| 0 | Whispers | Distant whispers + faint amber glow beyond corridor at 12 m; Agatha PATROL 2.0 | Learn movement; head toward Classroom B | `setAlert01(0.15)`; whisper scheduler sparse; Agatha spawns R1 (16 m from player — beyond every sense) |
| 35 | Distant Silhouette | Silhouette crosses a doorway 10 m away backlit by lantern, bell tolls once, resumes patrol | Observe patrol timing; break LOS with props | If player–Agatha > 8 m: steer route toward nearest of R10/R16 + `thunder()`-soft bell + `flashLightning()` reveal; no teleport |
| 80 | First Chase | Scripted sighting near Classroom B → SUSPICIOUS then CHASE 4.5; whispers → chanting | Sprint 5.2, break LOS 3 s, grab Chapel Key | On first Class-B entry (or t≥80 if already inside): suspicion = max(suspicion, 60), steer R5, `setAlert01(0.6)` |
| 125 | Near-Miss | SEARCHES within 2 m of hiding prop, lantern floods gap, heartbeat peaks, 8 s give-up | Stay crouched, silent, torch OFF till PATROL | If player hidden and Agatha SEARCH within 8 m: force SEARCH sub-target = nearest H-prop to player; `setAlert01(0.85)`; resolves via T8 |
| 170 | Chapel Finale | Key collected → Agatha 9 m from chapel door, final CHASE 4.5, whispers crescendo | Sprint to chapel door, unlock, escape before 0.8 m | On key pickup (or t≥170 if held): reposition to F ONLY if player has no LOS to F (else walks from current pos); suspicion 100; `setAlert01(1.0)` |

### Difficulty (Wonder VERBATIM multipliers; absolutes derived)

| Level | speed | hear | sight | Patrol / Susp / Chase / Search (m/s) | Hear run/walk (m) | Sight off/on torch (m) |
|---|---|---|---|---|---|---|
| Easy | 0.85 | 0.8 | 0.8 | 1.70 / 2.55 / 3.83 / 2.13 | 9.6 / 3.2 | 8.0 / 11.2 |
| Normal | 1.0 | 1.0 | 1.0 | 2.0 / 3.0 / 4.5 / 2.5 | 12 / 4 | 10 / 14 |
| Hard | 1.1 | 1.25 | 1.2 | 2.20 / 3.30 / 4.95 / 2.75 | 15.0 / 5.0 | 12.0 / 16.8 |

Hard chase 4.95 stays below player run 5.2 (0.25 m/s escape margin — tight by design). [DESIGN-NOTE: hearingMult also scales hearing fill rates (Easy 20/8/s, Hard 31.25/12.5/s); sight rate 40/s, decays, proximity 3 m, catch 0.8 m, and all timers are unscaled on every level; crouch radius stays 0. Difficulty persists in save.js, default Normal, §5.]

## 3. Pathfinding

### Grid spec [DESIGN-NOTE]

Cell 0.5 m over 24×18 m → 48 cols × 36 rows. `i = floor((x+12)/0.5)`, `j = floor((z+9)/0.5)`, clamped; center `(−12+(i+0.5)*0.5, −9+(j+0.5)*0.5)`. 0.5 m resolves 3.0 m corridors (6 cells) and 1.4 m door gaps (≥2 free cells, proven below).

### Collider → blocked mapping [DESIGN-NOTE]

A cell is blocked iff its center lies inside ANY `colliders` AABB expanded by 0.35 m (Agatha body radius). `colliders` from `StV_Levels` is AUTHORITATIVE (walls + all prop colliders incl. key-desk); door gaps D1–D6/arch/D3/D4 carry no colliders so they stay open. Free-cell proof for gaps: D1-type (1.4 m gap in z-wall): wall pieces expand 0.35 from each side leaving 0.7 m → cells i=13,14 free (pattern verified for D1 x∈[-5.7,-4.3] and identical for D2/D5/D6/arch). D3-type (x-wall): cells j=13,14 free (verified for D3/D4 z∈[-2.7,-1.3]). Waypoint (±9,-2) maps to free cell (42,14)/(6,14); (0,-8.0) door-front → (24,2) free; key-stand (6.5,-3.5) → (37,11) free (the key cell itself sits on the desk collider — BFS targets the stand cell, never the desk).

### Algorithm + cadence [DESIGN-NOTE]

A* on 8-connected grid, octile heuristic, no corner-cutting (diagonal needs both orthogonals free), full-grid cap 1728 expansions (single agent — no time-slicing needed), string-pulling smoothing with segment-vs-expanded-collider LOS tests. Repath: PATROL on arrive/dwell-end; SUSPICIOUS ≤1 Hz or stimulus moved >1.5 m; CHASE 2 Hz to player cell; SEARCH per sub-target. Arrive radius 0.4 m; yaw faces velocity (lerp 10/s). Stuck watchdog: <0.15 m progress in 1.2 s → immediate repath + 0.5 m lateral sidestep. All movement on clamped dt (≤1/60 nominal, frame clamp 0.05) so per-tick travel never exceeds §3 CCD numbers.

### Wall reference table (for QA spot-checks; colliders remain authoritative) [DESIGN-NOTE]

Thickness 0.3 m; every patrol waypoint was checked against these AABBs (all clear). Outer: N z[-9.15,-8.85] x[-12.15,12.15] with chapel-door gap x[-1.1,1.1] (locked door collider fills it); S z[8.85,9.15] full; W x[-12.15,-11.85], E mirrored. z=-6 wall: x[-9,-1] + x[+1,+9] (W/E-corr junctions x[-12,-9]/[+9,+12] OPEN). z=+2 wall: x[-9,-5.7], D1 x[-5.7,-4.3], x[-4.3,-1], divider face x[-1,+1], x[+1,+4.3], D2 x[4.3,5.7], x[5.7,9] (junctions OPEN). z=+5 wall: x[-12,-8.7], D5 x[-8.7,-7.3], x[-7.3,-2], arch x[-2,+2] OPEN, x[+2,+7.3], D6 x[7.3,8.7], x[8.7,12]. x=-9 wall (z[-6,2]): z[-6,-2.7], D3 z[-2.7,-1.3], z[-1.3,2]; x=+9 mirrored with D4. Hall sides x=±4 (z[5,9]) full. Divider solid x[-1,+1] z[-6,+2].

### BFS preflight + physics-gate compliance [DESIGN-NOTE]

Two-tier proof. (1) REAL guarantee (C ships this): BFS flood-fill on the fine 0.5 m grid from Agatha spawn (0,-7.5) over expanded colliders must reach every R/S waypoint + F + key-stand + door-front; C asserts at boot (console line in `?debug=1`) and D re-runs it — any unreachable target is a layout bug, not a design gap. (2) GENERIC gate adapter (`src/verifier/physics_qa_gate.js verifyTopologicalReachability`, 4 m cells): C passes `worldBound: 12` (6×6 grid), `spawn: {x:0, z:8.5}` → cell (3,5), 11 orbs (room centers + key + door: (-6,-7.5) (0,3.5) (-10.5,-2) (10.5,-2) (-5,-2) (5,-2) (0,7) (-8,7) (8,7) (6.5,-4.5) (0,-9)), obstacles `[{x:0,z:-4.5,r:2.0},{x:0,z:-0.5,r:2.0}]` (two honest circles covering 7.5/8 m of the divider; outer walls implicit as grid edges). Hand-verified trace: blocked = {(2,1),(3,1),(2,2),(3,2)} only; all 11 orb cells unblocked and 4-connected to (3,5) (east–west passes via row j=3, north approach via (4,0)→(3,0)) → 11/11 PASS. CCD: gate `verifyZeroTunneling` with playerSpeed 5.2 + gate-default jump 9.5 (N/A, no-jump game) → 0.181 m/tick < 0.3 m walls at 60 Hz, margin 0.119 PASS; Agatha Hard chase 4.95 → 0.083 m/tick. Camera/jump gate proofs are N/A (first-person interior, no jump — C passes spec values through).

## 4. Senses

### Hearing (Wonder VERBATIM radii/rates; band edges [RECONCILED] to Stage-1 values)

Stage-1 `noiseLevel()` emits exactly {0 stationary, 0.25 crouch-move, 0.55 walk, 1.0 run}, so bands are: SILENT n<0.4 (radius 0 m, +0/s — covers stationary AND crouch-move, matching Wonder's "crouch=silent"); WALK 0.4≤n<0.8 (radius 4 m, +10/s); RUN n≥0.8 (radius 12 m, +25/s). Radius check is Euclidean XZ distance Agatha→player; hearing ignores walls within radius (muffled stone carries boots — Wonder's design is radius-only) but SUSPICIOUS investigates the HEARD cell, so walls still protect via misdirection. Scaled by hearingMult (§2). The ≈0.5 s noise attack transient satisfies Wonder's 0.5 s/1.0 s dwell readings.

### Sight (Wonder VERBATIM ranges + raycast policy; geometry [DESIGN-NOTE])

- Raycast: segment from Agatha eye (ax, 1.55, az) to player chest (px, py, pz), py = 1.2 standing / 0.7 crouch. Blocked if the 2D segment crosses any collider (same AABBs as §3, UNexpanded) — any crossing prop/wall section breaks sight.
- Range: 10 m, 14 m if `torchOn` (× sightMult). Frontal half-FOV ±60° around facing yaw [DESIGN-NOTE: Wonder implies directional sight + close-range omniscience]; outside the cone, only the 3 m proximity sense applies.
- Proximity sense (Wonder T3 clause): ≤3 m, 360°, still needs LOS, 0.3 s dwell → escalate to CHASE. Hiding (crouch + within 1.2 m of an H-prop collider + n<0.4) breaks ALL sight beyond 2.0 m [DESIGN-NOTE: formalizes Wonder's "crouch behind prop = hidden"]; inside 2.0 m only the catch radius still applies.
- Catch (T6/T9): distance-only ≤0.8 m for 0.1 s — no LOS, no FOV, no difficulty scaling.
- Sight fill +40/s (fixed, all difficulties); T5 exit needs 3 s no-LOS AND >10 m, or hidden-crouch 3 s beyond 8 m (verbatim).

### Sense output [DESIGN-NOTE]

`update` folds hearing+sight into the suspicion meter (§2) and exposes `{state, suspicion, dist, alert01}` via `getState()`; `alert01` = max(beatFloor, stateMap) with stateMap PATROL 0.15 / SUSPICIOUS 0.55 / SEARCH 0.7 / CHASE 1.0 / CAUGHT 1.0, refreshed at 4 Hz for `hud-enemy` + `setAlert01` + debug overlay.

## 5. States23

### Extended machine [DESIGN-NOTE; win edge per binding brief §Stage-3.3]

`menu → playing ⇄ paused → stageclear (key + chapel door) OR gameover (caught) → menu/playing (restart)`.

Transitions: menu→playing (Start click/tap: pointer-lock + audio.init/ambientStart + full reset incl. enemy.reset + director t=0 + `setAlert01(0.15)`); playing⇄paused (ESC/P/button; loop HALTS updates incl. enemy + director timers; audio dims; alert01 frozen); playing→stageclear (E/`btn-act` ≤1.6 m of chapel door C=(0,-9) WHILE key held — key pickup flips door LOCKED→UNLOCKED + objective "Escape through the chapel door"); playing→gameover (enemy onCaught → 2 s jumpscare beat → `#gameover`); paused/clear/over→playing (Restart/Retry: same full reset); paused/clear/over→menu (Quit: reset + show menu, save kept).

[RECONCILED — the ONE sanctioned Stage-1 transition change: Stage-1 arch sent key-pickup straight to `stageclear`, but the binding Stage-2/3 brief (§Goal + §Stage-3.3 "Win condition: Chapel Key + Chapel Door open") mandates key-then-door with a chapel finale. Authority: brief wins for Stage 3. D must update the old `win()` path: debug `win()` = grant key + teleport door-front (keeps one-call testing); `giveAll()` unchanged.]

Survival timer runs in `playing` only; run end (clear OR over) writes `bestSurvivalSec = max(...)` + `difficulty` to save.js (brief §Stage-3.5).

### `#gameover` screen contract [DESIGN-NOTE]

`<div id="gameover" class="overlay hidden" role="dialog" aria-modal="true">` (hidden by default; sibling to `#menu/#pause/#clear`): children `h1` "PAKDA GAYA", `.go-sub` (run survival time + difficulty, e.g. "Survived 02:41 · Normal"), `.go-face` (Agatha visage panel — C fills with lantern-glow styling; no new light), `#btn-go-retry` (→ playing, full reset), `#btn-go-menu` (→ menu). Input arms 2.0 s after show (Wonder CAUGHT beat); ESC ignored here (explicit click required). `StV_UI.show('gameover')` displays it.

### New DOM ids [DESIGN-NOTE]

`gameover` (above) + `hud-enemy` (brief §Stage-2.5): `<div id="hud-enemy" data-state="patrol|suspicious|chase|search">` with dot + label + `.dist` ("12m", 4 Hz from `getState()`). Colors: patrol green #7dff9a, suspicious yellow #ffd23f, chase red #ff4d4d + pulse, search amber #ff9a3c (search color mine — brief names three). Hidden in menu/paused/clear/over.

### Restart-reset list (Stage-1 list + enemy/director additions) [DESIGN-NOTE]

Reset: player→S ry=0, torch ON, crouch off, noise 0, key K1 restored+spinning, door re-LOCKED, objective reset, hud-key/hud-obj/noise-meter reset, trauma 0, lightning idle, timer 0, banner hidden, UI→playing, PLUS enemy.reset(), suspicion 0, `setAlert01(0.15)`, hud-enemy→patrol, beat flags + finale flag cleared, gameover arm-flag false, survival timer 0. NOT reset: save file (settings/best/difficulty), audio muted/volume prefs.

### ADDITIVE list (everything else VERBATIM Stage-1)

1. `StV_UI.show(name)`: `name` gains `'gameover'` (menu/playing/paused/stageclear unchanged). 2. `window.game` gains `enemy` (StV_Enemy handle) + `die()` (debug: force onCaught path); existing keys (scene/player/getState/pause/resume/warp/win/giveAll) unchanged. 3. save.js gains fields `difficulty` ('Easy'|'Normal'|'Hard', default 'Normal') + `bestSurvivalSec` (number, default 0); `load()/save(s)` signatures unchanged. 4. `?debug=1` overlay gains Agatha state line (state + suspicion + dist). 5. Playing→stageclear edge changes key→clear into key→door→clear (sanctioned change above).

## 6. AssetContracts

### Agatha `.glb` + fallback chain (B produces, C loads)

Primary path `public/live-preview/assets/agatha.glb` (served `./assets/agatha.glb`).

| Tier | File | Producer / method | Loader behavior (C) |
|---|---|---|---|
| 1 hero | `assets/agatha.glb` | B via SAM 3D Objects from `ref-stvermilion-nun.webp` | `WorldRealism.loadGlbModel` → `normalizeToSize(~1.7 m)`; procedural bob/sway + lantern swing; NO new lights (emissive in-model only) |
| 2 | `assets/agatha_vggt.glb` | B via VGGT fast recon (only if SAM queue blocks) | Same load path on tier-1 error |
| 3 | `assets/agatha_blender.glb` | B via Blender Pro nun (in-house rig, NO Mixamo) | Same load path on tier-2 error |
| 4 last resort | runtime Sprite impostor (no file) | C builds if all fail (8 s total budget, `console.warn` each step) | Canvas 256×512 painted silhouette (black veil + pale face + amber lantern dot) on `THREE.SpriteMaterial` (fog:true) + bob; ZERO banned geometries, ZERO new lights; senses/colliders unaffected; `?debug=1` shows active tier |

Game MUST boot playable on any tier (brief hard rule). C never fakes Agatha with Box/Cone/Cylinder/Sphere geometry (QA gate bans it).

### Whisper-line file format (B produces via Baseten `muse-spark-open-1026`) [DESIGN-NOTE]

Required: `public/live-preview/assets/whispers.json`: `{version: 1, voice: "agatha-whisper", lines: [{id, text, mood, dur}]}` with `mood ∈ distant|near|chase`, ≥3 lines per mood (≥9 total; Hindi, e.g. "Kahan chhupa hai...", "Mujhe mil gaya...", "Ruk jaa beta..."), `dur` ≈ seconds. audio.js runs an INTERNAL scheduler (no new StV_Audio methods): interval from `alert01` (0.15→every 18–25 s distant; 1.0→every 4–6 s chase) + forced lines on beats B0/B2/B4. Optional enhancement: per-line wavs `assets/whispers/<id>.wav` (44.1k/16/mono) — audio.js prefers wav when present, else WebAudio formant-whisper synth fallback (C).

### Music stems + alert-fade API (B produces stems; C wires fade) [DESIGN-NOTE]

Required: `assets/audio/agatha_drone.wav` (low stalker drone loop, seamless 8–16 s) + `assets/audio/agatha_heart.wav` (heartbeat loop, 50 bpm base, seamless 4-beat), both 44.1 kHz 16-bit mono WAV ≤2 MB each (B via `meta_musicgen_audio.py`). New ADDITIVE method `StV_Audio.setAlert01(x)`: `x ∈ [0,1]` clamped; drone gain 0.0→0.9 (silent <0.05), heart gain 0.0→0.8 + playbackRate 1.0→2.8 (50→140 bpm); idempotent, callable at 4 Hz. game.js drives it: `max(beatFloor, stateMap(getState()))` every 0.25 s. Existing `StV_Audio` methods stay VERBATIM UNCHANGED: `{ init(), ambientStart(), thunder(), footstep(run), setVolume(v), setMuted(m) }` — C must not alter their signatures or behavior.

### B → C handoff checklist [DESIGN-NOTE]

| File | Producer | Consumer | Required |
|---|---|---|---|
| `assets/agatha.glb` (+`_vggt`/`_blender` fallbacks as available) | B (SAM/VGGT/Blender) | C enemy.js loader (tier chain) | Tier-1 file OR documented tier in use; game boots regardless |
| `assets/whispers.json` (≥9 lines, 3 moods) | B (Baseten) | C audio.js scheduler | Yes |
| `assets/whispers/*.wav` (optional, ids match JSON) | B (voice-transcribe layer) | C audio.js (prefers wav) | No |
| `assets/audio/agatha_drone.wav` + `agatha_heart.wav` | B (MusicGen) | C audio.js + `setAlert01` | Yes |
| `StV_Audio.setAlert01(x)` | C (new additive) | C game.js director | Yes (only audio API addition) |
