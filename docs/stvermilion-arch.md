# Ashes of St. Vermilion — Stage 1 Architecture (Subagent A spec, binding for B/C/D)

Consumes: `docs/superpowers/plans/2026-11-01-stvermilion-stage1.md` Global Constraints + art refs (`storage/.uploads/ref-stvermilion-*.webp`: teal shadows + amber lantern glow). All units METERS, one floor y=0, wall height 3.2m, wall thickness 0.3m. Player eye 1.6m; walk 3.2 m/s; run 5.2 m/s; crouch 1.6 m/s. Vendor: global `THREE` r128 (`/studio/vendor/three.min.js`), `THREE.GLTFLoader` (`/studio/vendor/GLTFLoader.js`), `WorldRealism` (`/studio/vendor/world_realism.js`: `createRealisticSkyAndLighting`, `createProceduralPBRMaterial`, `loadGlbModel`, `normalizeToSize`, `wrapGlbAsLod`, `createInstancedFromRoot`, `capTextureSize`). `createProceduralPBRMaterial` kinds available: `asphalt | rock | dirt | kerb | brick | concrete` (+`grass`, BANNED in game code — QA gate fails on the word "grass"; also never call `create3DGrassField`/`createRealisticWater` in this interior stage). Architecture = `PlaneGeometry` + PBR only (≤3 primitive-geometry occurrences TOTAL across all game JS; zero `MeshLambertMaterial`; zero `function box(`).

## 1. Topology

Footprint x∈[-12,+12] (24m) × z∈[-9,+9] (18m). North = -z. All corridors 3.0m wide (≥2.4m ✓).

```
x:      -12   -9        -4  -1  +1  +4        +9   +12
        ┌────────────────┬────────────────┬────────────────┐ z=-9
        │      NORTH CORRIDOR 24m × 3m (z∈[-9,-6])          │
        │  W1(-6)   [CHAPEL DOOR 2.2m @x=0, LOCKED]   W2(+6)│
        ├────┬───────────┴──────┬──┬──┬──────┴───────────┬────┤ z=-6
        │    │                 │  │  │                  │    │
        │ W  │  CLASSROOM A    │DI│VI│  CLASSROOM B     │ E  │
        │ E  │  8m × 8m        │DE│DER  8m × 8m    K=KEY│ A  │
        │ S  │  x∈[-9,-1]  H1  │  │  │  x∈[+1,+9]  H2   │ S  │
        │ T  │  z∈[-6,+2]      │2m│  │  z∈[-6,+2]       │ T  │
        │    │ D3(x=-9,z=-2)   │  │  │   D4(x=+9,z=-2)  │    │
        │ 3m │ D1(x=-5,z=+2)   │  │  │   D2(x=+5,z=+2)  │ 3m │
        ├────┴─────────────────┴──┴──┴─────────────────┴────┤ z=+2
        │       SOUTH CORRIDOR 24m × 3m (z∈[+2,+5])         │
        ├───────┬────────────────────────┬─────────────────┤ z=+5
        │ WEST  │ ENTRANCE HALL 8m × 4m  │ EAST            │
        │ STORE │ x∈[-4,+4] z∈[+5,+9]    │ STORE           │
        │ 8×4m  │ S=SPAWN (0,+8.5) ry=0  │ 8×4m            │
        │ H6    │ facing NORTH(-z)   H5  │ H4              │
        └───────┴────────────────────────┴─────────────────┘ z=+9
              D5(x=-8)  OPEN ARCH x∈[-2,+2]  D6(x=+8)
```

Room AABB table (floor rects; walls sit on shared edges, doors = 1.4m gaps):

| Room | x0,x1 | z0,z1 | Size | Doors |
|---|---|---|---|---|
| Entrance Hall | -4,+4 | +5,+9 | 8×4m | open arch x∈[-2,+2] @z=+5 |
| South Corridor | -12,+12 | +2,+5 | 24×3m | D1,D2 (N side), D5,D6+arch (S side) |
| North Corridor | -12,+12 | -9,-6 | 24×3m | D3/D4 via W/E corridors |
| West Corridor | -12,-9 | -6,+2 | 3×8m | D3 @z=-2 (E side) |
| East Corridor | +9,+12 | -6,+2 | 3×8m | D4 @z=-2 (W side) |
| Classroom A | -9,-1 | -6,+2 | 8×8m | D1 (x=-5,z=+2), D3 (x=-9,z=-2) |
| Classroom B | +1,+9 | -6,+2 | 8×8m | D2 (x=+5,z=+2), D4 (x=+9,z=-2) |
| West Store | -12,-4 | +5,+9 | 8×4m | D5 (x=-8,z=+5) |
| East Store | +4,+12 | +5,+9 | 8×4m | D6 (x=+8,z=+5) |
| Divider block | -1,+1 | -6,+2 | solid | none |

Key points: player spawn S=(0,+8.5) ry=0 (facing -z/north into hall arch). Chapel Key K=(+6.5,-4.5) in Classroom B on crate-desk (y≈0.9, float+spin, E-interact radius 1.6m). Chapel Door C=(0,-9) north wall, 2.2m wide, LOCKED teaser (E → toast, no open). Hiding spots (crouch-behind prop clusters, ≥1.2m pass kept): H1=(-7.5,-4.5) Class A crates; H2=(+7.5,+0.5) Class B barrels; H3=(-10.5,+0.5) West Corr chest; H4=(+10,+7) East Store boxes; H5=(-3,+8) Entrance crates; H6=(-10,+7) West Store chest. Broken windows (emissive planes, lightning-lit, no extra lights): N wall (-6,-9),(+6,-9); S wall (-8,+9),(+8,+9); W wall (-12,-2),(-12,+3.5); E wall (+12,-2),(+12,+3.5). `bounds={x0:-12,z0:-9,x1:+12,z1:+9}`.

## 2. Interfaces

FINAL `window.StV_*` names (verbatim from plan — NO changes, all feasible as r128 globals):

| Global | File | Shape |
|---|---|---|
| `window.StV_Levels` | levels.js | `{ buildWorld(scene): {colliders:[{x0,z0,x1,z1}], spawn:{x,z,ry}, bounds, update(dt,t), keyMesh, chapelDoor}, VERSION }` |
| `window.StV_Player` | player.js | `{ create(camera,colliders,bounds): {pos(), update(dt,input), setTorch(bool), setCrouch(bool), noiseLevel(), setMoveVec(x,z), setLookDelta(dx,dy)} }` |
| `window.StV_Audio` | audio.js | `{ init(), ambientStart(), thunder(), footstep(run), setVolume(v), setMuted(m) }` |
| `window.StV_UI` | ui.js | `{ show(name), setObjective(txt), toast(txt) }` (`name ∈ menu/playing/paused/stageclear`) |
| `window.StV_Story` | story.js | `{ TITLE, INTRO, OBJECTIVES[] }` |
| `window.StV_Save` | save.js | `{ load(), save(s) }` (settings + best clear time, `localStorage`) |
| `window.StV_VFX` | vfx.js | `{ create(scene): {addTrauma(x), flashLightning(), update(dt,camera)} }` |
| `window.game` | game.js | debug: `{scene, player, warp(x,z), win(), giveAll()}` + `?debug=1` FPS+XYZ overlay |

DOM ids (Task 2 `index.html` MUST use exactly): `canvas-container`, `hud-obj`, `hud-key`, `noise-meter`, `banner`, `menu`, `pause`, `clear`, `joy`, `btn-torch`, `btn-crouch`, `btn-act`. Interface changes vs plan: NONE.

## 3. Lights

Budget: 1 shadowed spot + 5 points + ambient/hemi + 1 unshadowed directional (≤6 points per plan ✓).

| Light | Type | Pos (x,y,z) | Color | Intensity | Distance/decay | Shadow |
|---|---|---|---|---|---|---|
| Torch | SpotLight (on camera) | eye 1.6m, fwd | 0xffd9a0 | 1.6 | 18 / 1.5 | YES 1024 (only shadow) |
| P1 Hall | Point | (0,2.4,+7) | 0xff9a3c amber | 1.1 | 10 / 2 | no |
| P2 S-Corr | Point | (-8,2.4,+3.5) | 0xff9a3c | 1.0 | 9 / 2 | no |
| P3 N-Corr | Point | (0,2.4,-7.5) | 0xff9a3c | 1.1 | 10 / 2 | no |
| P4 ClassA | Point | (-5,2.4,-2) | 0xff9a3c | 1.0 | 9 / 2 | no |
| P5 Chapel | Point | (0,2.6,-8.2) | 0xff7733 | 0.9 | 6 / 2 | no |
| Ambient | AmbientLight | — | 0x1a2b3a teal | 0.25 | — | no |
| Hemi | HemisphereLight | — | sky 0x2a4a5a / gnd 0x0a0805 | 0.3 | — | no |
| Lightning | DirectionalLight | (20,30,-10) | 0xbdd8ff | 0 base → 3.0 flash | — | NO |

Fog: `FogExp2` 0x060a0e density 0.045. Tone: `ACESFilmicToneMapping` exposure 1.0 + PMREM env (via `createRealisticSkyAndLighting` with dark overrides, or manual ACES+env — Task 2 decides; gate needs ACES present). STAGE-1 FINAL (QA-canonical, supersedes table above): wall tint `0x51463c` (+darkened floor/ceil/door/trim), Ambient `0.16`, Hemi `0.18` (teal hues kept), lit-lantern glass emissive `0xffa63e @1.6` (L6 stays dark). Reason: ref-mood match (near-dark + amber pools). Extra lantern meshes beyond P1–P5 use emissive-flame impostors (zero lights). Draw-call estimate: arch planes ~36 (shared PBR mats) + windows 8 + props ~18 + lanterns 6×2 + key/door ~4 ≈ 78 < 100 ✓.

## 4. Props

All URLs exist on disk (verified `stat`, sizes in report). Serve path = disk path `public/X` → `/studio/X`; catalog URLs verbatim from `public/assets/models/index.json`.

| # | Model (serve URL) | Pos (x,z) y/rotY | Use |
|---|---|---|---|
| L1–L4 | `/studio/assets/polyhaven/Lantern_01/Lantern_01_1k.glb` | (0,+7),(−8,+3.5),(0,−7.5),(−5,−2) @y=2.2 wall-hang | lit lanterns = P1–P4 anchors |
| L5 | same Lantern_01 URL | (0,−8.6) @y=2.4 | chapel teaser = P5 anchor |
| L6 | same Lantern_01 URL | (+5,−2) @y=2.2 | Class B UNLIT visual (dark key hunt) |
| K1 | `/studio/assets/models/props/key.glb` | (+6.5,−4.5) @y=0.9 spin | Chapel Key pickup → stageclear |
| C1 | `/studio/assets/models/props/chest.glb` | (−10.5,+0.5) H3 | hiding chest |
| C2 | same chest URL | (−10,+7) H6 | hiding chest |
| R1–R5 | `/studio/assets/models/props/crate.glb` | 3×H1 (−7.5,−4.5 stack), 2×H5 (−3,+8) | hiding + key-desk (1 under K1) |
| B1–B5 | `/studio/assets/models/props/barrel.glb` | 3×H2 (+7.5,+0.5), 2×West Store (−6,+8) | hiding barrels |
| X1–X2 | `/studio/assets/models/props/box-large.glb` | H4 (+10,+7) pair | hiding boxes |
| D1 | `/studio/assets/models/props/ladder.glb` | East Store (+11,+5.5) lean | decor + collider |
| PB1–PB2 | `/studio/assets/polyhaven/Barrel_01/Barrel_01_1k.glb` | (±3,+8.5) hall corners | hero photogrammetry props |

Totals: 6 lantern + 1 key + 2 chest + 5 crate + 5 barrel + 2 box-large + 1 ladder + 2 Barrel_01 = 24 instances, 8 unique URLs. All loaded via `WorldRealism.loadGlbModel(url,{targetLength,onError→emissive impostor})`; game MUST boot playable if any/all fail (fallback impostor + colliders kept).

## 5. States

Machine: `menu → playing ⇄ paused → stageclear`. ESC/P pause toggle; restart resets state, never reloads page.

```
        click Start/Tap
  ┌────────┐  (audio.init+ambientStart)  ┌─────────┐  E on key (≤1.6m)  ┌────────────┐
  │  menu  │ ──────────────────────────▶ │ playing │ ─────────────────▶ │ stageclear │
  └────────┘                             └─────────┘                    └────────────┘
       ▲                                  │      ▲                            │
       │            ESC/P or pause-btn    │      │ resume-btn/ESC/P           │ Restart btn
       │         ┌────────────────────────┘      └──────────────────┐         │
       │         ▼                                                  │         ▼
       │    ┌────────┐  Restart btn ────────────────────────────────┴── (same reset path)
       └────│ paused │  Quit-to-menu btn ──▶ menu (keeps save)
            └────────┘
```

Transitions: menu→playing (Start click/tap; pointer-lock request + drag-look fallback); playing⇄paused (ESC/P/button; loop halts updates, audio dims); playing→stageclear (E/`btn-act` within 1.6m of K1; `win()` same path); paused→playing (resume); paused/clear→playing (Restart: full reset below); paused→menu (quit). Restart resets: player→spawn S ry=0, torch ON, crouch off, noise 0, key K1 restored+spinning, `hud-key`/`hud-obj`/`noise-meter` reset, trauma 0, lightning idle, timer 0, `banner` hidden, UI→playing; does NOT reset: save file (settings/best), audio muted/volume prefs.
