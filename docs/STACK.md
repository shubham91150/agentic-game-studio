# STACK — What I use, what I skip, and why

Honest, judge-readable, Hinglish-friendly. Har claim repo me verified hai —
proof ke saath file/route diya hai. Jo nahi hai, wo clearly SKIP me hai.

## USE (har ek live, proof ke saath)

- **Muse Spark / Wonder (design)** — game architect JSON: `src/agent/muse_wonder.js`, `src/agent/meta_wonder.js` (model `muse-wonder-1.0`).
- **Baseten `muse-spark-open-1026` (enrich)** — asset-prompt enrichment: `src/agent/baseten_muse.js` (model `meta-models/muse-spark-open-1026`).
- **Muse Image (art + edit)** — concept/key-art + edits: `src/pipeline/meta_image.js` (model `muse-image-1.0`, `/v1/images/edits`), CLI via `src/tools/make-image.js`.
- **SAM 3.1 (masks)** — segmentation cutouts, standalone tool: `src/tools/segment_image.py` (model `sam-3.1`).
- **SAM 3D Modal (hero 3D)** — image-to-3D `.glb`, 2 green trials: `src/tools/modal_call_3d.py --backend sam3d` (Modal app `spurcode-sam3d-objects`), evidence `docs/evidence-sam3d/` (trial3 + trial4 EXIT 0, 2 valid `.glb`).
- **Blender (cleanup + procedural)** — headless decimate/merge/loose-delete: `src/tools/blender_cleanup.py`; projection: `src/tools/blender_project.py`.
- **Godot / Unity (engines)** — Godot web-export skill `.agents/skills/godot-web/SKILL.md`, Unity headless exporter `src/engine/unity_exporter.js`; browser 3D runtime `src/engine/threejs_runtime.js`.
- **Rapier (physics)** — self-hosted `@dimforge/rapier3d-compat` 0.21.0, vendored `src/engine/vendor/`, served `/studio/vendor/` (see `src/server.js`).
- **Depth / warp tools** — monocular depth `src/tools/depth_map.py`, novel-view warp `src/tools/novel_view.py` (tool-only, shipped path ka hissa nahi).
- **NPC dialogue** — short Spark-Open lines + local fallback: `src/tools/npc_dialogue.js`.
- **WebAudio + speech** — procedural synth `src/audio/audiocraft_synth.js`; browser speech recognition + TTS `public/studio.js`.
- **localStorage saves** — best score + settings persist: `public/studio.js` (game template pattern `save.js` per skill).

## SKIP + WHY (resource reason, one line each)

- **Trellis** — non-Meta (Microsoft), sirf dev-only backend (`src/pipeline/assets_3d.js`, `REMINDERS.md`); submission se pehle Nov 3 ko remove hoga, shipped path me kabhi nahi.
- **Open-world scale** — GPU/time budget nahi hai; bounded start (`worldBound:72`, `src/pipeline/layout.js`), quality-gate ke baad hi scale.
- **Splatting training** — GPU hours chahiye, isliye planned-only, koi code nahi (`docs/WORLD_PIPELINE.md` §6: "koi code nahi hai").
- **Seamless voice** — research-grade model, GPU + integration cost; shipped path me WebAudio synth + browser speech hi hai.
- **Mixamo** — decision se removed (commit `2458344`); character animation ka ekmatra path ab Blender in-house rigging hai.
- **Gaussian full scenes** — Modal queue-bound (speed run wall 5242 s, `docs/evidence-sam3d/README.md`); shipped games procedural terrain + primitive/kit meshes use karte hain.

## VISION (3-4 lines)

Sab kuch kaam karta hai, direction clear hai — production/enterprise grade
BY CHOICE nahi hai, budget ki wajah se hai: bounded quality over open
mediocrity. Full budget hota to (1) SAM 3D hero assets har game me live,
(2) splatting-trained full scenes bina queue-wait, (3) Seamless voice NPCs —
yeh teeno unlock hote.
