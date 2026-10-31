# Agentic Game Studio

**Type a sentence. Watch a playable 3D prototype build in stages** — in your browser, with Unity C# to carry forward natively.

Built for the **Meta Global AI Developer Hackathon 2026** · Indie Developer track · Theme: **Push the Frontier**

**[Live studio](https://agentic-game-studio.vercel.app/)** · **[Play a prebuilt game](https://spurcode.duckdns.org/studio/games/game_1793194032409_62ce9b/index.html)** · **[Repo](https://github.com/shubham91150/agentic-game-studio)**

## Judging map

| Criterion                        | What to look at                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impact (30%)**                 | Solo devs and game-jam teams lose days scaffolding a prototype. One prompt here starts a staged build you can watch — playable prototypes in minutes, production quality iteratively. Try two contrasting prompts live.                                                     |
| **Use of Meta AI tooling (25%)** | Muse Wonder 1.0 designs the game, Muse Spark Open (open weights, Baseten) enriches assets, Muse Image 1.0 paints concept art, Muse Code CLI (`muse-spark-1.3`) writes the Unity C# on our VM. Verified pipeline table below.                                                |
| **Demo (25%)**                   | Live site above. Prompt → live agent console (every step streamed) → playable game in the preview, phone-playable via QR. Prebuilt games are linked so you never wait.                                                                                                      |
| **Technical depth (20%)**        | Deterministic shared layout rendered by the game _and_ proven by a BFS reachability gate; CCD tunneling math; scoped CLI workspaces with keys passed over stdin (never argv/logs); prompt-hash caching so repeat builds cost zero API calls. Tests: `npm test` (9 passing). |

## Verified pipeline

Every stage below actually runs in the live path (`src/agent/agent_runner.js`):

| #   | Stage                                                                             | Model / tool                                     | Code                                                |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| 0   | Prompt safety check (local keyword rules — not a model)                           | local                                            | `src/pipeline/safety_shield.js`                     |
| 1   | Game design: title, biome, physics, objective, assets (structured JSON)           | **Muse Wonder 1.0** (Meta Model API)             | `src/agent/meta_wonder.js`                          |
| 2   | Asset-prompt enrichment                                                           | **Muse Spark Open** — open weights via Baseten   | `src/agent/baseten_muse.js`                         |
| 3   | Concept art                                                                       | **Muse Image 1.0** (Meta Model API)              | `src/pipeline/meta_image.js`                        |
| 4   | File pass: writes `SPEC.md` + `AgenticPlayerController.cs` in a scoped run folder | **Muse Code CLI 1.4.14**, model `muse-spark-1.3` | `src/agent/agent_runner.js`                         |
| 5   | Terrain heightmap + deterministic world layout (shared with QA)                   | procedural                                       | `src/pipeline/terrain.js`, `src/pipeline/layout.js` |
| 6   | Playable game (biome palette, spec physics, obstacles, collect-to-win)            | Three.js WebGL                                   | `src/engine/threejs_runtime.js`                     |
| 7   | Unity C# project (openable in Unity 2022.3.11f1)                                  | template + CLI script                            | `src/engine/unity_exporter.js`                      |
| 8   | Physics QA: CCD zero-tunneling, camera clearance, jump arc, **BFS reachability**  | local math                                       | `src/verifier/physics_qa_gate.js`                   |
| 9   | Persistent library with playable links                                            | VM disk + JSON index                             | `src/storage/game_store.js`                         |

Model routing: high-reasoning work goes to **Muse Wonder**, code writing to **Muse Spark 1.3**, open-weight enrichment to **Muse Spark Open**. Identical prompts hit a cache (`storage/cache/`) and cost **zero** API calls — watch for "cache hit" in the console.

One honest note: the Muse Code CLI cannot talk to Baseten directly (its model-catalog fetch gets HTTP 405 from Baseten's OpenAI-style API — we tested it). So Baseten is called by the planner step, and the CLI runs on the Meta Model API. Both are Meta models; the UI labels each step with the model that actually ran.

## Meta model chain

Every model/tool below is Meta (first-party API, open weights, or CLI on the Meta provider). Steps 1–5 run live in the per-run path; the SAM tools ship in-repo and run standalone.

| Step                                                              | Model                                         | Provider                                                                        | Where in code                                                           |
| ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1 · Prompt safety screen (local rules, no model)                  | —                                             | local                                                                           | `src/pipeline/safety_shield.js` via `src/agent/agent_runner.js`         |
| 2 · Game design (title, biome, physics, assets)                   | `muse-wonder-1.0`                             | Meta Model API (`POST /v1/responses`)                                           | `src/agent/meta_wonder.js`, routed by `src/agent/muse_wonder.js`        |
| 3 · Asset-prompt enrichment (open weights)                        | `meta-models/muse-spark-open-1026`            | Baseten (`POST /v1/chat/completions`)                                           | `src/agent/baseten_muse.js`, routed by `src/agent/muse_wonder.js`       |
| 4 · Concept art                                                   | `muse-image-1.0`                              | Meta Model API (`POST /v1/images/generations`)                                  | `src/pipeline/meta_image.js`                                            |
| 5 · File pass (`SPEC.md` + Unity C#)                              | `muse-spark-1.3` (default; allowlist in code) | Meta Model API via Muse Code CLI (`muse exec --provider meta --model … --json`) | `src/agent/agent_runner.js`                                             |
| 6 · Segmentation tool (standalone)                                | `sam-3.1`                                     | Meta Model API (`POST /v1/responses`, SSE)                                      | `src/tools/segment_image.py`                                            |
| 7 · 3D reconstruction tool (standalone, `ASSET_3D_BACKEND=sam3d`) | SAM 3D Objects (`SAM3DObjects.reconstruct`)   | Modal app `spurcode-sam3d-objects`                                              | `src/tools/modal_call_3d.py`, dispatched by `src/pipeline/assets_3d.js` |

Steps 6–7 are **not** invoked by the live per-run path in `src/agent/agent_runner.js` — that path renders with procedural terrain + Three.js (`src/pipeline/terrain.js`, `src/pipeline/layout.js`, `src/engine/threejs_runtime.js`). Repeat prompts hit `storage/cache/` (`spec_`, `concept_`, `unity_` files) and cost zero API calls.

## Try it

1. Open the [live studio](https://agentic-game-studio.vercel.app/), type a game idea, press **Build Game**.
2. Watch the agent console stream the CLI writing files on the VM.
3. Play the result in the preview (WASD + Space, or the touch joystick on mobile), open **Generated Code** to read the exact C# the CLI wrote, and **Assets** for the concept art.
4. Reopen any earlier build from the library — no rebuild needed.

Prebuilt examples (generated by this pipeline, stored on the VM):

- [Low-gravity glacier course](https://spurcode.duckdns.org/studio/games/game_1793194032409_62ce9b/index.html)
- Full library: `GET https://spurcode.duckdns.org/api/studio/games`

## Run it yourself

```bash
git clone https://github.com/shubham91150/agentic-game-studio.git
cd agentic-game-studio
npm install
cp .env.example .env   # add BASETEN_API_KEY and META_API_KEY (Meta Model API)
npm run build

# VM backend (runs the Muse Code CLI + storage):
node src/server.js     # http://localhost:3030  · SSE at /api/studio/generate

# One-shot CLI run (same AgentRunner as the web backend):
node src/agent/generate.js --prompt "Low gravity lunar rover with floaty jumps"
```

## Honest limitations

- The WebGL game is a generated runtime whose palette, physics, terrain, and layout come from the design spec; characters/obstacles are primitive meshes, not generated GLBs. Standalone SAM 3.1 / SAM 3D tooling ships in `src/tools/` (see "Meta model chain" steps 6–7) but is **not wired into the live per-run path** — learned 3D reconstruction and learned world models (HunyuanWorld) stay roadmap. Earlier drafts of this README claimed otherwise; that was wrong and has been corrected.
- Unity output is a real openable project skeleton (version, package manifest, scripts, import notes), not a pre-built scene.
- If a provider is down, the run says so in the console (e.g. "template fallback") instead of faking success.
- Builds depend on our VM backend; the stored library links above keep working even while the studio UI is redeployed.

## Built during the event

All project commits are dated **Oct 26 – Nov 4, 2026** (the hackathon build window) in this public repository. Third-party open source used: Three.js (MIT), Next.js/React (MIT), Lucide icons (ISC). Game assets are generated at runtime; no third-party game IP is used.

Track: Indie Developer · Bonus targets: Best Agentic Use-Case, Best Build on Meta Open Weight Models, Best Creative Build (Muse Image + Muse Wonder).

## License

MIT — see `LICENSE`.
