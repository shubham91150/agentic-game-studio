---
name: blender-armature-rigging
description: Blender 3.4 (bpy) Armature character rigging + bone skinning + NLA Idle/Walk baking + Three.js AnimationMixer playback. Applied to Mother Agatha (agatha.glb).
type: project
---

# Blender Armature Character Rigging + Three.js AnimationMixer

Research + applied recipe for TASK 2. Tools: `src/tools/blender_autorig_animate.py`
(generic NPC auto-rig), `src/tools/build_agatha_sam31.py` (Mother Agatha hero build).
Playback: `public/live-preview/enemy.js`, `public/live-preview/agatha-viewer.js`.

## 1. Humanoid Bone Hierarchy (Blender 3.4, Z-up, faces +Y in Blender)

Authoritative chain (Blender `.L`/`.R` naming so glTF keeps Left/Right clear):

```text
root (0,0,0 -> 0,0,0.80, no deform, scene anchor)
└── hips (0,0,0.80 -> 0,0,0.88)
    ├── spine (0,0,0.88 -> 0,0,1.10)          # torso driver, head == waist pivot
    │   └── chest (0,0,1.10 -> 0,0,1.38)
    │       ├── neck (0,-0.01,1.38 -> 0,-0.02,1.44)
    │       │   └── head (0,-0.02,1.40 -> 0,-0.02,1.62)
    │       ├── shoulder.L (0.10,0,1.34 -> 0.16,0,1.36, connected to chest)
    │       │   └── upper_arm.L (0.16,0,1.36 -> 0.22,-0.03,1.08)
    │       │       └── forearm.L (-> 0.25,-0.08,0.82)
    │       │           └── hand.L (-> 0.25,-0.10,0.68)
    │       └── shoulder.R / upper_arm.R / forearm.R / hand.R (mirrored x)
    ├── thigh.L (0.085,0,0.80 -> 0.085,0,0.42)  # leg driver, head == hip pivot
    │   └── shin.L (-> 0.085,0,0.06)
    │       └── foot.L (-> 0.085,-0.16,0.03, toe toward -Y)
    └── thigh.R / shin.R / foot.R (mirrored x)
```

Rules that matter:

- **Bone head == joint pivot.** A bone rotates around its head, so deformation
  bone heads MUST sit exactly on the old object origins (waist 0.88, hips
  ±0.085/0.80, shoulders ±0.16/1.36, neck (0,-0.02,1.40)). Get this wrong and
  limbs orbit instead of swinging.
- `use_connect = True` only where child head == parent tail (spine->chest,
  thigh->shin, upper_arm->forearm). Shoulders/legs use `use_connect = False`
  with explicit heads.
- `root` has `use_deform = False`; everything else deforms. One `ARMATURE`
  object per character; pose mode `rotation_mode = "XYZ"` on every pose bone
  before baking.
- Blender faces +Y; Three.js faces +Z. The glTF exporter handles the rotation;
  Agatha's existing meshes were authored facing +Z in Three terms, so bone
  forward/back swing stays on rotation.x in both apps.

## 2. ARMATURE Modifier + Vertex-Group Skinning (real SkinnedMesh export)

- Each mesh gets vertex groups named EXACTLY like the bones (`thigh.L`,
  `upper_arm.R`, ...). The glTF 2.0 exporter turns matching groups into
  `skin.joints` + inverse-bind-matrices; without them you get `skins: 0` and
  a dead statue.
- Add ONE modifier per mesh: `modifiers.new("Armature", "ARMATURE")`,
  `modifier.object = arm_obj`, `use_vertex_groups = True`. Do NOT parent mesh
  objects to bones as well (double transform). Mesh objects keep identity rest
  transforms; bones carry all motion.
- **Rigid weights** (whole limb -> 1 bone, weight 1.0): simple, safe, matches
  old object-pivot look. Used for head group + lantern-locked verts.
- **Smooth height-band weights** (Agatha legs/arms/torso): linear blends across
  joint bands so knees/elbows/waist BEND instead of shearing:
  - legs (world z): thigh z>=0.60, blend 0.34..0.60 thigh<->shin, shin
    0.10..0.34, blend 0.04..0.10 shin<->foot, foot z<0.04.
  - arms (world z): upper z>=1.10, blend 0.95..1.10, forearm 0.78..0.95,
    blend 0.70..0.78, hand z<0.70. Exception: lantern cage verts
    (y < -0.12 and x < -0.15 in `Agatha_Arm_R`) stay 100% `upper_arm.R` so the
    brass lantern never squash-stretches.
  - torso (world z): hips z<0.80, spine 0.80..1.10, chest z>1.10 with 0.06
    blends at each boundary.
  - Every vertex MUST belong to >= 1 group with weights summing to 1.0;
    unweighted verts freeze at bind pose (classic "foot stuck to floor" bug).
- Local vs world: `recenter_origin()` shifts verts into pivot-local space, so
  band tests MUST add the pivot back (`world_z = local_z + pivot_z`).

## 3. NLA / Action Baking — Idle + Natural Human Walk (30 fps)

- `scene.render.fps = 30`. Idle = 48 frames (1.6 s breath loop), Walk = 32
  frames (~1.07 s full stride: left+right step). All pose-bone fcurves sampled
  every frame; first frame duplicated at end for seamless `LoopRepeat`.
- **Idle:** root bob ±0.015, spine breath pitch ±0.045, head slow look ±0.08,
  arms relaxed sway ±0.06, knees soft (shin 0.04 flex so legs never lock).
- **Natural Walk (phase w over 2π, s=sin, c=cos):**
  - thighs ±0.42 swing (opposite phase), shins knee-flex `0.55*max(0,-c)` on
    the swing leg only (knee bends while leg passes through, extends at heel
    strike), feet compensate `-0.25*thigh` to keep soles near-flat.
  - root double-bob `0.035*|cos|`, spine forward pitch 0.08 + roll ∓0.06
    (contrapposto), chest counter-yaw, head stabilize -0.5x torso yaw.
  - arms counter-swing ∓0.44 (opposite to same-side leg), elbows trail
    +0.15 flex. Lantern arm (Agatha R) damps to 0.10 swing — she carries it.
  - Bake `location` + `rotation_euler` on every deform bone each frame, then
    push each Action into its own NLA track (`nla_tracks.new()`,
    `track.strips.new(name, 1, action)`). The 3.4 exporter writes one glTF
    animation per NLA strip when `export_nla_strips=True` — strip NAME becomes
    `animation.name` ("Idle"/"Walk"), which is what `AnimationClip.findByName`
    looks up. Set `animation_data.action = None` after baking so strips (not
    the active action) drive the export.
- Export flags: `export_animations=True`, `export_nla_strips=True`,
  `export_skins=True`, `export_apply=False` (True would freeze the armature!).

## 4. Three.js r128 Playback (THREE.AnimationMixer)

```js
var mixer = new THREE.AnimationMixer(modelRoot); // modelRoot == gltf.scene
var idle = THREE.AnimationClip.findByName(clips, "Idle");
var walk = THREE.AnimationClip.findByName(clips, "Walk");
var idleA = mixer.clipAction(idle); idleA.play();
var walkA = mixer.clipAction(walk); walkA.play();
idleA.setEffectiveWeight(1 - k); walkA.setEffectiveWeight(k); // k ~ speed
mixer.update(dt); // every frame, AFTER movement, BEFORE bone add-ons
```

- Name lookup is case-insensitive with `walk`/`idle` substring fallback (old
  `*Action` object clips never match, so old .glb files safely fall back to
  the procedural limb driver).
- Mixer is PRIMARY; the legacy procedural leg/arm rotation is skipped while
  clips play (running both double-swings the limbs). Sprite tier keeps the
  procedural bob only.
- Bone add-ons (head scan, lantern sway) apply AFTER `mixer.update()` each
  frame via `modelRoot.getObjectByName("head")` — mixer rewrites bone
  transforms on update, so pre-update edits are wiped.
- r128 notes: `clipAction`, `setEffectiveWeight`, `crossFadeTo`,
  `LoopRepeat` all exist; `THREE.SkeletonHelper(model)` visualizes the live
  skeleton in the viewer when `?skeleton=1` is set.
- r128 GLTFLoader SANITIZES node names: `thigh.L` loads as `thighL` (dots
  stripped; verified in-browser: `root,hips,spine,chest,neck,head,
  shoulderL,upper_armL,...,thighL,shinL,footL,...`). Mixer clip binding is
  index-based so playback is unaffected — but any `getObjectByName` lookup
  MUST use the sanitized form. Dot-free names (`head`) survive verbatim.
- Bone add-ons (head scan) MUST post-multiply a quaternion about the bone's
  LOCAL axis (`bone.quaternion.multiply(q.setFromAxisAngle(Y, yaw))` — bone
  +Y is the long axis, so local-Y = head yaw). Bones carry flipped rest
  quaternions (down-bones read ±π in Euler), so Euler-adding tilts the wrong
  axis. Preallocate the temp Quaternion/axis (zero per-frame garbage).

## 5. Verification Checklist (TASK 2)

- `python3 -m py_compile` on both tools; `node --check` on both JS files.
- glTF JSON probe: `skins >= 1`, `animations` contains `Idle` + `Walk`.
- `node src/verifier/visual_qa_gate.js public/live-preview` prints PASS.
- Headless Chromium screenshot: Agatha mid-stride, red eyes + lantern intact.
- Never regress: Human Lady face, Red Glowing Eyes, black habit, Polyhaven
  brass lantern, CSP (no inline `<script>`), zero primitive fakes.
