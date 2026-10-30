# WORLD_PIPELINE — Hunyuan-World-style 4-Stage Pipeline, Meta-only (Agentic Game Studio)

> Source: WhatsApp chat MASTER_PLAN (30 Oct 2026, Hindi/Hinglish) jo Hunyuan World 2.0 ka Meta-compliant replacement propose karta hai.
> Is doc ka rule: **jo EXISTS likha hai wo repo me verified path ke saath hai; jo nahi hai wo PLANNED hai.** Koi fake claim nahi.

## 1. Hunyuan 4-stage → hamara mapping

| Hunyuan part                   | Kaam                     | Hamara replacement                                                                                                                                  | Type                                                | Real path (verified)                                                                |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| HY-Pano (360 panorama)         | Text → 360 world image   | **Muse Image** (`muse-image-1.0`) concept/key-art                                                                                                   | Meta Model API — EXISTS                             | `src/pipeline/meta_image.js`                                                        |
| WorldNav (rasta/plan)          | Scene + camera path plan | **Muse Wonder** (`muse-wonder-1.0`) game architect JSON + **Muse Spark Open** (`meta-models/muse-spark-open-1026`, Baseten) asset-prompt enrichment | Meta — EXISTS                                       | `src/agent/muse_wonder.js`, `src/agent/meta_wonder.js`, `src/agent/baseten_muse.js` |
| WorldStereo (naye views/depth) | Segmentation + depth     | **SAM 3.1** (Meta Model API) mask/cutout; depth sirf procedural heightmap se (learned depth model nahi hai)                                         | Meta + local tool — EXISTS (SAM 3.1), depth PLANNED | `src/tools/segment_image.py`, `src/pipeline/terrain.js`, `src/pipeline/layout.js`   |
| WorldMirror (final 3D)         | Image → 3D mesh          | **SAM 3D Objects** (Meta, Modal backend `spurcode-sam3d-objects`) → `.glb`; preview **Three.js** runtime me                                         | Meta + tool — EXISTS                                | `src/tools/modal_call_3d.py` (`--backend sam3d`), `src/engine/threejs_runtime.js`   |

Deterministic layout (`src/pipeline/layout.js`) single source of truth hai — WebGL runtime render karta hai, QA gate usi pe BFS reachability prove karta hai (`src/verifier/physics_qa_gate.js` — EXISTS).

## 2. Full flow (jo aaj chalता hai)

```
prompt
  → Muse Wonder 1.0 (game JSON: title, biome, physics, objective, assets)   [src/agent/muse_wonder.js]
  → Muse Spark Open (Baseten) focal asset prompts enrich                    [src/agent/baseten_muse.js]
  → Muse Image muse-image-1.0 (concept/key art)                             [src/pipeline/meta_image.js]
  → SAM 3.1 mask/cutout (boxes + masks → overlay + cutout PNG)              [src/tools/segment_image.py]
  → SAM 3D Objects on Modal (masked image → .glb)                           [src/tools/modal_call_3d.py --backend sam3d]
  → Blender cleanup (external tool)
  → Godot / Unity / Three.js preview                                       [src/engine/threejs_runtime.js, src/engine/unity_exporter.js]
```

Godot reference (copy mat karo, sirf dekho): `/home/opencode/project-data/workspace/games/cybersurge` (`project.godot`, `scenes/`, `scripts/` verified).

## 3. Gaps to build (PLANNED — aaj repo me nahi hai)

1. **Proper audio (PLANNED / research).** Chat ne "Meta AudioCraft/MusicGen" bola. Sach: repo me sirf WebAudio oscillator synth hai — **ye Meta AudioCraft NAHI hai** (`src/audio/audiocraft_synth.js` — EXISTS, procedural jump/collect/drone stems). Asli generative audio (AudioCraft/MusicGen open weights) research item hai, koi code nahi hai.
2. **NPC dialogue via Spark (LIVE as CLI tool).** `src/tools/npc_dialogue.js` — `--character/--world/--lines/--out` → JSON array of `{speaker, line, mood}` via Baseten `meta-models/muse-spark-open-1026` (cheapest model for short dialogue; deterministic local fallback if the provider is down). Verified 30 Oct 2026: 5 shopkeeper lines, schema-valid. Game-spec `story/dialogue` injection still PLANNED.
3. **Mixamo-style auto-rig (PLANNED, external).** Note: Mixamo Adobe ka third-party tool hai — tool ki tarah allowed, lekin external dependency; SAM 3D mesh pe skeleton/walk-anim ka koi code repo me nahi hai.
4. **Godot Navigation/physics wiring (PLANNED).** `physics_qa_gate.js` sirf local deterministic checks (BFS reachability, tunneling) karta hai — Godot `NavigationAgent3D` / Rigidbody wiring ka code nahi hai.
5. **LOD/occlusion perf (PLANNED).** LOD + occlusion culling ka koi code nahi hai; Three.js runtime CSP-compliant split (`index.html` + `game.js`) tak hi hai.
6. **Depth Anything V2 (LIVE as local tool).** `src/tools/depth_map.py` — Depth-Anything-V2-Small HF checkpoint (MIT), CPU-only, brighter = nearer PNG + optional `.npy`. Gaussian Splatting still PLANNED (koi code nahi hai). Details: §6 below.

## 4. Rules reminder (Meta hackathon compliance)

- **Meta-models-only (shipped path):** exact IDs — `muse-wonder-1.0` (Meta Model API Responses), `muse-image-1.0` (Meta Model API images), `meta-models/muse-spark-open-1026` (Baseten open-weights). SAM 3.1 / SAM 3D Objects Meta Model API / Modal backends se.
- **Shipped path me FORBIDDEN:** Trellis/TRIPOSR — `src/tools/modal_call_3d.py` me `trellis` backend sirf dev/testing ke liye hai, comment me khud likha hai "NOT hackathon-compliant". Submission hamesha `--backend sam3d`.
- **No trademarked IP:** prompt/spec me koi trademarked character, brand, film/game IP mat daalo — Wonder director biome + original assets banata hai, existing IP nahi.
- Blender / Godot / Unity **tools** hain (model nahi) — allowed; judges line: "Meta models for reasoning/assets/understanding, open tooling for render."

## 5. Submission pitch

> "Agentic Game Studio ek prompt se playable 3D game banata hai — Meta Muse Wonder world reasoning, Muse Spark Open asset planning, Muse Image concept art, aur SAM-family (3.1 segmentation + 3D Objects) image-to-3D ke liye — deterministic layout aur physics QA gate ke saath. Koi third-party end-to-end world model shipped path me nahi hai (Trellis dev-only hai)."

## 6. World-expansion tools (LIVE — tools only, never the shipped path)

Depth → novel-view → Blender-projection chain. MIT/open tooling + own code;
koi third-party generative weight shipped path me nahi jaata. Verified
30 Oct 2026 on `storage/.uploads/sunrise_valley.jpg` (1920×1280):

```bash
# 1. depth map (CPU, 8-core VM): infer ~6s, total ~7s → 768×512 PNG (44 KB) + .npy (1.5 MB)
python3 src/tools/depth_map.py --image storage/.uploads/sunrise_valley.jpg \
    --out /tmp/depth.png --npy /tmp/depth.npy --max-side 768
# sanity: brighter = nearer; foreground-bottom mean 166.5 vs sky-top mean 1.0

# 2. novel view warp (zero ML, ~0.5s): same-size output, holes 1.72% (<2%), cv2-Telea fill
python3 src/tools/novel_view.py --image storage/.uploads/sunrise_valley.jpg \
    --depth /tmp/depth.png --px 24 --out /tmp/novel.png

# 3. Blender projection (~3s + one-time `sudo apt-get install -y blender`, v3.4.1):
#    subdivided plane displaced by depth + image texture → .glb (6.8 MB, glTF magic OK)
PYTHONPATH=/home/opencode/.local/lib/python3.11/site-packages \
blender --background --python src/tools/blender_project.py -- \
    --image storage/.uploads/sunrise_valley.jpg --depth /tmp/depth.png \
    --out /tmp/scene.glb --grid 191x127 --strength 0.35
```

Code: `src/tools/depth_map.py`, `src/tools/novel_view.py`, `src/tools/blender_project.py`.

## 7. Mesh cleanup (LIVE — tool only, never the shipped path)

SAM 3D / generated meshes carry dense tris, loose verts, and unapplied
transforms. `src/tools/blender_cleanup.py` normalizes them headless
(Blender 3.4.1, zero ML weights): import `.glb` → COLLAPSE decimate
(`--ratio`, default 0.5) → merge doubles (dist 0.0001) + delete loose
verts/edges → root `--scale` + apply rotation/scale → export `.glb`.

```bash
# Verified 30 Oct 2026 on storage/.uploads/drone.glb (133888 B):
# → /tmp/drone_clean.glb (103632 B, glTF magic OK), roundtrip re-clean OK
PYTHONPATH=/home/opencode/.local/lib/python3.11/site-packages \
blender --background --python src/tools/blender_cleanup.py -- \
    --in storage/.uploads/drone.glb --out /tmp/drone_clean.glb \
    --ratio 0.5 --scale 1.0
```

Code: `src/tools/blender_cleanup.py`.

## 8. Scope decision: bounded worlds win (open explorable worlds out of scope)

We cannot fully replace Hunyuan World 2.0 open explorable worlds — so we build specific bounded 3D games (single arena / track / room / island, `worldBound:72` pattern) instead: bounded quality over open mediocrity.
