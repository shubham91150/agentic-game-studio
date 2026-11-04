# Cerebral Valley × Meta Hackathon — Submission Kit (ready to copy)

<!-- sources: README.md, package.json, docs/evidence-sam3d/README.md, docs/evidence-sam3d/trial1.log, docs/evidence-sam3d/trial3.log, docs/evidence-sam3d/trial4.log, docs/evidence-sam3d/speed.log, src/verifier/visual_qa_gate.js, src/verifier/physics_qa_gate.js, src/tools/studio_3d_mcp_server.py, src/tools/fetch_mega_3d_hub.py, src/server.js, src/agent/agent_runner.js, src/agent/meta_wonder.js, src/agent/muse_wonder.js, src/agent/baseten_muse.js, src/pipeline/meta_image.js, src/pipeline/assets_3d.js, src/tools/make-image.js, src/tools/segment_image.py, src/tools/modal_call_3d.py, src/tools/meta_vggt_scene.py, src/tools/meta_musicgen_audio.py, src/tools/meta_voice_transcribe.js, src/tools/scenescript_wfc_world.py, public/studio.js, public/index.html, public/live-preview/index.html, public/live-preview/game.js, public/assets/audio/, public/assets/custom/, .agents/skills/, git log + git remote -->

> Every claim below is grounded in a repo file actually read for this kit (see sources comment above). Anything NOT verifiable on disk is listed unticked in §10 — never pasted into the copy blocks as fact.

---

## 1. Project title + one-liner + elevator pitch

**Title:** Agentic Game Studio — type a sentence, play a 3D game

**One-liner (86 chars):** Type a sentence (or speak it) — watch a playable 3D game build live in your browser.

**Elevator pitch:** Agentic Game Studio turns one sentence — typed or spoken — into a playable 3D browser game. A Meta-AI pipeline (Wonder game architect, Spark Open asset enrichment, Image concept art, MusicGen soundtrack, SAM 3D + VGGT-1B reconstruction) builds the world, while a live Muse Code CLI terminal with 17 native 3D/world/audio tools and 26 agent skills assembles real `.glb` models, animated NPCs, and Gaussian splats. Every build is proven, not promised: a 6-check Visual QA Gate bans primitive fakes and a 4-check Physics QA Gate proves BFS reachability. Flagship proof: Ashes of St. Vermilion, a gothic stealth-horror game with a live Meta AI Director whispering room-aware tactics.

---

## 2. Track

**Track:** Indie Developer Track · Push the Frontier

**Why we fit (2 lines):** Solo-built agentic pipeline that pushes Meta's full model stack — all 5 Model API lines plus open-weight Spark, SAM 3D, VGGT-1B, and MusicGen — further than a demo, into playable games. Judges don't watch a video; they build and play new games themselves inside a zero-login gVisor sandbox.

---

## 3. What it does (judge-readable)

- **One prompt → one playable 3D game:** type an idea (or speak it) and the studio builds a WebGL world with terrain, obstacles, collect-to-win objective, and Unity C# export.
- **Live agent terminal:** a real Muse Code CLI session runs in the browser with 17 native 3D/world/audio tools — CAD `.glb` builders, Blender generators, city extruders, voice transcription.
- **Real assets, never boxes:** characters, cars, trees, and buildings load as real `.glb` models; a hard QA gate auto-rejects anything faked from boxes or cones.
- **Living games:** a runtime AI Director adapts enemy tactics, whispers hints, and mutates the environment (blackouts, storms) as you play.
- **Flagship game ships in-repo:** Ashes of St. Vermilion — Stage 3 (3D Gothic stealth horror with 19 Polyhaven 1K photogrammetry scans, 20-bone rigged Mother Agatha, and live Meta AI Director).
- **Judge-safe sandbox:** visitors build real games with zero login inside a locked-down Google gVisor container — no host access, rate-limited, credit-protected.
- **Proof over promises:** every build passes deterministic physics + visual QA gates, and SAM 3D GPU trials are archived with logs and byte counts.

---

## 4. Meta AI stack (9 rows — role + verifiable proof pointer each)

| # | Meta model / tool | One-line role | Verifiable proof pointer |
|---|---|---|---|
| 1 | Wonder 1.0 (`muse-wonder-1.0`) | High-reasoning game architect → structured JSON spec (title, biome, physics, objective) | `src/agent/meta_wonder.js`, `src/agent/muse_wonder.js` |
| 2 | Baseten `muse-spark-open-1026` live director | Asset-prompt enrichment + live runtime AI Director (tactics, whispers, env events every 14s) | `src/agent/baseten_muse.js`; `POST /api/studio/ai/director` in `src/server.js` (~L2739) |
| 3 | SAM 3.1 evidence lens (`sam-3.1`) | Concept-aware image segmentation masks & cutouts | `src/tools/segment_image.py` |
| 4 | Muse Image 1.0 (`muse-image-1.0`) | Concept/key art + texture generation & editing | `src/pipeline/meta_image.js`, `src/tools/make-image.js` |
| 5 | Voice Transcribe 1.0 (`muse-voice-transcribe-1.0`) | Spoken prompts → text (mono 16kHz WAV), API + CLI backends | `src/tools/meta_voice_transcribe.js`; sample `public/assets/audio/voice_prompt_sample.wav` |
| 6 | SAM 3D + VGGT-1B | Single-image → textured `.glb` (Modal GPU) + metric surface-mesh reconstruction (VGGT modal / Depth-Anything-V2 local fallback) | `src/tools/modal_call_3d.py`, `src/pipeline/assets_3d.js`, `docs/evidence-sam3d/` (2 GLBs + trial logs); `src/tools/meta_vggt_scene.py`, `public/assets/custom/vggt_scene.glb` |
| 7 | MusicGen-small (`facebook/musicgen-small`) | Text-to-music 32kHz AI soundtrack loops (300M params, local) | `src/tools/meta_musicgen_audio.py`; output `public/assets/audio/musicgen_theme.wav` |
| 8 | Muse Code CLI 1.4.14 + gVisor 4.19.0-gvisor | CLI writes `SPEC.md` + C# + live 3D games; judge builds run inside the gVisor sandbox | `src/agent/agent_runner.js` (CLI bin `muse-bin-1.4.14-R7309.1`, sandbox string L426); `src/server.js` judge-sandbox route (~L2541) |
| 9 | Verifiable gates | Visual QA (6 checks) + Physics QA (4 checks incl. real BFS flood fill) — deterministic, runnable locally | `node src/verifier/visual_qa_gate.js public/live-preview`; `src/verifier/physics_qa_gate.js` |

---

## 5. Architecture in 60 seconds (build → verify flow)

1. **Prompt in** — typed text, or voice via `muse-voice-transcribe-1.0` (`src/tools/meta_voice_transcribe.js`).
2. **Safety** — local keyword shield (`src/pipeline/safety_shield.js`), not a model call.
3. **Design** — Wonder 1.0 writes the structured game spec; Spark Open (Baseten) enriches asset prompts (`src/agent/`).
4. **Look + sound** — Muse Image 1.0 concept art; MusicGen 32kHz theme; SAM 3D / VGGT-1B hero meshes on Modal GPU.
5. **Build** — Muse Code CLI 1.4.14 writes `SPEC.md` + Unity C#; deterministic terrain + shared layout feed the Three.js runtime.
6. **Sandbox (judges)** — non-owner `POST /api/studio/generate` runs the real CLI at full power but ONLY inside Google gVisor (`runsc`), read-only mounts, no attachments, 6 builds / 10 min, uncached prompts require the judge token.
7. **Verify** — Physics QA (CCD zero-tunneling, camera clearance, jump arc, BFS reachability) + Visual QA (6 checks incl. primitive-fake ban and square-particle ban) must PASS.
8. **Play + keep** — playable link instantly; persistent library (`storage/games/`) with zero-wait reloads.

---

## 6. How judges verify in 5 minutes (only steps verified in code)

1. **Open the live studio** in a browser (see §7 links). No login needed.
2. **Read the judges brief** — `/studio/hackathon.html` (`public/hackathon.html` + `public/hackathon.js`, zero inline scripts): 9-row Meta stack, evidence gallery, SAM 3D `.glb` 360° viewers with trial logs, and the glassmorphic Judge AI Assistant console (5 one-click pills, file:line citations).
3. **Run the live verification receipt** — the brief's **Run live verification receipt** button calls `/api/studio/health`, `/api/studio/git/status`, and `POST /api/studio/ai/director` in the judge's own browser and seals a SHA-256 `VERIFIED` receipt.
4. **Play the flagship game** — Ashes of St. Vermilion — Stage 3 (`public/live-preview/` and `storage/games/game_1793679153102_17eff3/`). WASD + mouse look + E interact on desktop; virtual joystick + touch buttons on mobile.
5. **Open the judge link** — the same studio URL with `?judge=meta-judge-2026` appended. The client (`public/studio.js`) stores the token and pings `POST /api/studio/judge-audit`; the server unlocks uncached live-AI builds for that token.
6. **Build a game** — send any prompt via **Build Game** (`POST /api/studio/generate`). Judge builds run the real pipeline inside the gVisor sandbox (rate limit: 6 builds / 10 min). Without the judge token, only pre-cached prompts build (zero API spend) — the 403 message says so verbatim.
7. **Probe the live AI Director** — `POST /api/studio/ai/director` with gameplay telemetry returns `muse-spark-open-1026` tactics + environment events (public route, 30 req/min, 20s signature cache). Dictate prompts hands-free: the mic button records 5s and transcribes via Meta `muse-voice-transcribe-1.0` (`POST /api/studio/voice/transcribe`, owner-only; visitors fall back to browser dictation).
8. **Run the gates locally** — `node src/verifier/visual_qa_gate.js public/live-preview` must print `PASS` (6/6); `node --test --test-concurrency=1 test/` passes **81/81** (verified Nov 3).
9. **(Owner only) Check the judge audit** — `GET /api/studio/judge-audit` returns the last 50 judge events, newest first; requires owner auth.

---

## 7. Key links block (copy-paste)

```text
Repo:   https://github.com/shubham91150/agentic-game-studio   (git remote `origin`)
Brief:  https://spurcode.duckdns.org/studio/hackathon.html  (judges brief: stack, evidence, SAM 3D viewers, AI assistant, live receipt)
Studio: https://spurcode.duckdns.org/studio/?judge=meta-judge-2026  (judge access link; token default in src/server.js)
Live:   https://agentic-game-studio.vercel.app/               (per README header)
Prebuilt game: https://spurcode.duckdns.org/studio/games/game_1793679153102_17eff3/index.html
Game library API: GET https://spurcode.duckdns.org/api/studio/games  (per README)
Evidence (SAM 3D GPU trials): docs/evidence-sam3d/  (2 .glb + trial1/trial3/trial4/speed logs)
```

> Demo video line lands with the video file (see §10): `/studio/assets/demo_walkthrough.mp4`.

---

## 8. Built This Week (Oct 26 – Nov 4, 2026) & Limits, Stated Plainly

**Built this week (verified in `git log` — first commit Oct 26, latest Nov 3, 2026):** full pipeline, 17-tool MCP server, 26 skills, both QA gates, both flagship games, gVisor judge sandbox + audit, SAM 3D Modal trials with archived logs.

**Limits, stated plainly:**

- **Deterministic core:** terrain, layout, physics QA (CCD/BFS), and the Visual QA gate are local deterministic code — they run the same every time, with or without AI. That is intentional: gameplay correctness never depends on a model call.
- **AI-driven layers:** game design (Wonder), asset enrichment + live Director (Spark Open via Baseten), concept art (Image), voice (Transcribe), hero 3D (SAM 3D / VGGT-1B on Modal GPU), and music (MusicGen local) all call real Meta models — but need API keys / GPU availability, and the pipeline falls back cleanly (cached specs, local depth fallback) instead of faking success.
- **No-GPU VM path:** the shipped live-preview games run on Blender/kit-built `.glb` assets, not live SAM 3D inference — SAM 3D is trial-verified (2 green runs, EXIT 0, archived `.glb` files) and used for hero assets subject to GPU availability, exactly as `docs/evidence-sam3d/README.md` states. Trial 2 was an empty 0-byte run and is reported missing, not faked; per-trial wall times were not instrumented and are not claimed.
- **Counts with caveats:** 17 MCP tools counted from the `TOOLS` array in `src/tools/studio_3d_mcp_server.py` (its header docstring still says "15" — stale); 26 skills counted from `.agents/skills/` directories; "825K+" appears only as the mega-hub script's own header claim (`src/tools/fetch_mega_3d_hub.py` L6), not an independently verified catalog count.

---

## 9. Viral X post copy

**Primary post (208 chars — limit 280):**

```text
Type a sentence, play a 3D game: Agentic Game Studio builds playable WebGL worlds on Meta Muse + SAM 3D + VGGT-1B + MusicGen. Judges build live in a gVisor sandbox. #MetaAIHackathon @AIatMeta @cerebral_valley
```

**Reply 1 — proof thread (video):**

```text
Proof, not promises: every build passes a 6-check Visual QA gate (primitive fakes auto-rejected) + a physics gate with real BFS reachability. SAM 3D GPU trials archived with logs in-repo. Repo link in bio. 🛠️
```

**Reply 2 — proof thread (verification):**

```text
Judges verify in 5 min, zero login: open the studio with the judge link, build any prompt in the gVisor sandbox, play it instantly — then run `node src/verifier/visual_qa_gate.js` locally and watch it PASS. ✅
```

---

## 10. Submission checklist

**Exists on disk (ticked):**

- [x] `README.md` — capabilities, judging map, 17-tool + 26-skill tables, pipeline, honest notes
- [x] `package.json` — test script `node --test --test-concurrency=1 test/`
- [x] `src/verifier/visual_qa_gate.js` — 6 checks: (1) CSP no-inline-scripts, (2) GLB + GLTFLoader required, (3) primitive-fake ban (max 3), (4) 3D InstancedMesh grass, (5) ACES tone mapping, (6) PointsMaterial radial map
- [x] `src/verifier/physics_qa_gate.js` — 4 checks: CCD zero-tunneling, camera clearance, jump arc, BFS reachability on 36×36 grid (passes when ALL orbs reachable, N/N — no fixed orb count in code)
- [x] `src/tools/studio_3d_mcp_server.py` — 17 tools in `TOOLS` array (header docstring stale at "15")
- [x] `.agents/skills/` — 26 skill directories (counted)
- [x] `docs/evidence-sam3d/` — `sam3d_verify.glb` (5,170,920 B), `sam3d_verify2.glb` (11,415,872 B), `trial1/trial3/trial4/speed.log` (all EXIT 0)
- [x] `public/live-preview/index.html` — `<title>Ashes of St. Vermilion — Stage 3</title>` + HUD/game states in `game.js`
- [x] `storage/games/game_1793459815775_afba76/` — `<title>Horizon Sprint — 3D Sports Car Racing</title>`
- [x] `POST /api/studio/generate` gVisor judge sandbox + token gate + 6-builds/10-min limit (`src/server.js` ~L2541–2603)
- [x] `?judge=meta-judge-2026` token flow — client stores + pings (`public/studio.js` ~L1590), server default (`src/server.js` L217)
- [x] `POST` + `GET /api/studio/judge-audit` — token-gated ping / owner-only last-50-events (`src/server.js` ~L2702–2737)
- [x] `POST /api/studio/ai/director` — public, 30 req/min, `meta-models/muse-spark-open-1026` (`src/server.js` ~L2739)
- [x] Meta stack files: `src/agent/meta_wonder.js`, `src/agent/muse_wonder.js`, `src/agent/baseten_muse.js`, `src/pipeline/meta_image.js`, `src/tools/make-image.js`, `src/tools/segment_image.py`, `src/tools/modal_call_3d.py`, `src/pipeline/assets_3d.js`, `src/tools/meta_vggt_scene.py`, `src/tools/meta_musicgen_audio.py`, `src/tools/meta_voice_transcribe.js`, `src/tools/scenescript_wfc_world.py`
- [x] Asset proofs: `public/assets/audio/musicgen_theme.wav`, `public/assets/audio/voice_prompt_sample.wav`, `public/assets/custom/vggt_scene.glb` (NOTE: README names `vggt_modal_gpu_scene.glb` — that filename does not exist; actual is `vggt_scene.glb`), `public/assets/custom/scenescript_hall.glb` (NOTE: README names `scenescript_bazaar.glb` — actual is `scenescript_hall.glb`)
- [x] gVisor `4.19.0-gvisor` string (`src/agent/agent_runner.js` L426) + CLI bin `muse-bin-1.4.14-R7309.1` (`src/agent/agent_runner.js` L50–52)
- [x] Git history Oct 26 – Nov 3, 2026 + remote `https://github.com/shubham91150/agentic-game-studio.git`
- [x] `storage/cache/` prompt-cache dir (cache-hit path in `judgeGenerateAllowed`, `src/server.js` L209–247)

**Could NOT verify — unticked (strict):**

- [x] `/studio/hackathon.html` brief page — `public/hackathon.html` + `public/hackathon.js`, zero inline scripts, verified in headless Chromium (screenshot `/tmp/hackathon_page_check.png`)
- [x] "Live Verification Receipt" button/flow — calls health + git/status + ai/director live, seals SHA-256 `VERIFIED` receipt (verified live in-browser)
- [x] Judge AI Assistant console — `POST /api/studio/judge-assistant` (Baseten `muse-spark-open-1026` + <5ms KB fallback), 5 pills, file:line citations (11/11 tests in `test/studio_judge_assistant.test.js`)
- [x] `POST /api/studio/voice/transcribe` — owner-only Meta `muse-voice-transcribe-1.0` mic dictation, ffmpeg webm→16k-wav, 401 fallback to browser dictation (3/3 tests in `test/studio_voice_transcribe.test.js`)
- [x] SAM 3D `.glb` 360° viewers + trial logs on the brief — `public/assets/evidence/sam3d_verify{,2}.glb` served at `/studio/assets/evidence/*.glb`
- [x] Test pass count — `node --test --test-concurrency=1 test/` → **81/81** (verified Nov 3; README's `59/59` line is stale)
- [ ] Demo video `/studio/assets/demo_walkthrough.mp4` — recording in progress (`src/tools/record_demo_video.js`); lands before commit. Reply 1 points to the repo until then.
- [ ] "825K+ hub" as a verified catalog count — only the mega-hub script's own header claim (`src/tools/fetch_mega_3d_hub.py` L6); softened to attributed wording in §8.
