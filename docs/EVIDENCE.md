# Evidence — verifiable artifacts from live runs

All items below were produced by the pipeline in this repo and can be
re-checked against the live VM (`https://spurcode.duckdns.org`).

## 1. Backend health (live)

`GET https://spurcode.duckdns.org/api/studio/health` returns:

```json
{
  "ok": true,
  "service": "agentic-game-studio-backend",
  "components": {
    "museCodeCLI": true,
    "cliModel": "muse-spark-1.3",
    "cliProvider": "meta-model-api",
    "metaKeyPresent": true,
    "plannerModel": "meta-models/muse-spark-open-1026",
    "plannerProvider": "baseten",
    "basetenKeyPresent": true,
    "terrain": "procedural elevation grid",
    "engines": ["threejs-webgl", "unity-csharp"]
  }
}
```

## 2. Full public run (SSE, unedited summary)

Prompt: "Signal garden exploration with scattered beacons"

Event counts over `POST /api/studio/generate` (public gateway):
`start 1 · spec 1 · reasoning 5 · cli 5 · phase 16 · proof 3 · artifact 1 · log 12 · done 1`

Final event:

```json
{
  "type": "done",
  "ok": true,
  "gameId": "game_1793194475264_81152d",
  "playUrl": "/studio/games/game_1793194475264_81152d/index.html",
  "title": "Signal Garden Exploration With",
  "unitySource": "muse-cli",
  "elapsedMs": 19113
}
```

`unitySource: "muse-cli"` means the stored `AgenticPlayerController.cs`
was written by the Muse Code CLI on the VM in that run (not the template).

Play it: https://spurcode.duckdns.org/studio/games/game_1793194475264_81152d/index.html

## 3. Muse Wonder design output (structured JSON, real call)

Prompt: "Low gravity lunar rover with slow floaty jumps" →

```json
{
  "title": "Lunar Rover Orb Run",
  "biome": "cyber-orbital",
  "gravity": -6,
  "playerSpeed": 11,
  "jumpVelocity": 8,
  "objective": "Drive the lunar rover with WASD or touch joystick to collect all glowing orbs across the orbital moon base."
}
```

These numbers flow into the generated game's physics and the QA gate.

## 4. Cache proof (zero credits on repeat)

A repeated prompt logs:

```
Design cache hit: Wonder/Baseten skipped, zero credits used.
Concept art cache hit: image API skipped, zero credits used.
Unity code cache hit: Muse CLI skipped, zero credits used.
```

Verified end-to-end in 26 ms with all QA proofs passing.

## 5. Tests

`npm test` — 9 passing: CLI JSONL reducer (4), deterministic layout, BFS reachability (including a
winnable-layout assertion), safety shield, runtime spec embedding.

## 6. What is NOT in this build

## 6. What is NOT in the live per-run path

Standalone SAM 3.1 / SAM 3D tooling ships in `src/tools/` (see §7), but
segmentation cutouts and learned 3D/GLB assets are not wired into the
live per-run game path — shipped games use procedural terrain and
primitive meshes. Earlier README drafts claimed otherwise; that was
incorrect and has been corrected in the current README.

## 7. Meta model chain (one-line proof each)

Same chain as `README.md` § "Meta model chain" — one verifiable fact per step:

1. **Safety screen** — `SafetyShieldValidator` in `src/pipeline/safety_shield.js` is a local banned-keyword list; it makes zero network calls (covered by `npm test`: "safety shield flags restricted terms and sanitizes").
2. **Wonder design** — `MetaWonderClient` in `src/agent/meta_wonder.js` POSTs model `muse-wonder-1.0` to `https://api.meta.ai/v1/responses`; a repeat prompt logs `Design cache hit: Wonder/Baseten skipped, zero credits used` (`storage/cache/spec_<hash>.json`).
3. **Spark Open enrichment** — `BasetenMuseClient` in `src/agent/baseten_muse.js` POSTs model `meta-models/muse-spark-open-1026` to `https://inference.baseten.co/v1/chat/completions`; covered by the same spec cache hit as step 2.
4. **Concept art** — `MetaImageClient` in `src/pipeline/meta_image.js` POSTs model `muse-image-1.0` to `https://api.meta.ai/v1/images/generations` (edits: `/v1/images/edits`); a repeat prompt logs `Concept art cache hit: image API skipped, zero credits used` (`storage/cache/concept_<hash>.webp`).
5. **CLI file pass** — `AgentRunner.runMuseCLI` in `src/agent/agent_runner.js` spawns `muse exec --provider meta --model <cliModel> --json`, default `<cliModel>` = `muse-spark-1.3` (`ALLOWED_CLI_MODELS` allowlist in the same file); a repeat prompt logs `Unity code cache hit: Muse CLI skipped, zero credits used` (`storage/cache/unity_<hash>.cs`); per-model token spend streams back via `run.usage` events.
6. **SAM 3.1 segmentation** — `src/tools/segment_image.py` POSTs model `sam-3.1` to `https://api.meta.ai/v1/responses` (SSE stream) and caches the wire output at `storage/.uploads/<stem>_wire_<concept>.txt` (`--reuse-wire` replays it with zero API calls); standalone tool, not invoked by the per-run path.
7. **SAM 3D Objects** — `src/tools/modal_call_3d.py --backend sam3d` calls Modal app `spurcode-sam3d-objects`, class `SAM3DObjects`, method `reconstruct`, dispatched by `src/pipeline/assets_3d.js` (`SUBMISSION_BACKEND = "sam3d"`, `ASSET_3D_BACKEND=sam3d`); standalone tool, not invoked by the per-run path.
