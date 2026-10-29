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

`npm test` — 5 passing: deterministic layout, BFS reachability (including a
winnable-layout assertion), safety shield, runtime spec embedding.

## 6. What is NOT in this build

SAM segmentation, learned 3D/GLB generation, learned world models, and
Blender decimation are roadmap items. Earlier README drafts claimed
them; that was incorrect and has been corrected in the current README.
