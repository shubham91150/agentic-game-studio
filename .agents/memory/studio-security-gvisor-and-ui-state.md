---
name: Studio Security, gVisor Sandbox, Multi-Window Terminal & UI State
description: Complete record of Owner Auth vs Judge gVisor Sandbox, non-destructive tmux multi-window sessions, library auto-save/activate, UI color locks (#000000 / #121212), and Mother Agatha SAM-3.1 20-bone rig.
type: project
---

# Studio Security, gVisor Sandbox, Multi-Window Terminal & UI State

## 1. Two-Tier Security & Google gVisor (`runsc 4.19.0-gvisor`) Sandbox

- **Cryptographic Owner Authentication (`isOwnerRequest(req)` in `src/server.js`)**:
  - Verifies the `opencode_gh_session` cookie using AES-256-GCM (`OPENCODE_SESSION_SECRET || OPENCODE_SERVER_PASSWORD`), or allows direct local loopback (`localhost`/`127.0.0.1` with zero `x-forwarded-*` headers).
  - Port `:3030` is bound strictly to `127.0.0.1` loopback.
- **Locked Owner-Only Endpoints (`401 Unauthorized` for public visitors)**:
  - `POST /api/studio/terminal/send`, `POST /api/studio/terminal/stop`, `POST /api/studio/terminal/scroll`
  - `POST /api/studio/session/new`
  - `GET /api/studio/chats`, `GET /api/studio/chats/:id`, `POST /api/studio/chats/:id/continue`
  - `POST /api/studio/mcp`, `DELETE /api/studio/mcp/:name` (also restricted to allowlisted commands `npx`, `node`, `python3`, `uvx` with shell metacharacters blocked and secrets redacted on `GET /api/studio/mcp`)
  - `POST /api/studio/upload`, `POST /api/studio/publish`
- **Full-Power Judge Sandbox via Google gVisor (`POST /api/studio/generate` with `useGvisor: true`)**:
  - Host Docker daemon has Google's official `runsc` (`release-20261102.0`, kernel `Linux 4.19.0-gvisor`) registered in `/etc/docker/daemon.json`.
  - When a public Judge submits a prompt in the Studio UI (`terminal/send` returns `401`), `public/studio.js` automatically falls back to `POST /api/studio/generate`.
  - For non-owner requests, `AgentRunner.runMuseCLI` spawns `docker run --rm -i --runtime=runsc --read-only --cap-drop=ALL --security-opt=no-new-privileges` with `/data/opencode/.gvisor-sandbox/bin/muse-bin-1.4.14-R7309.1`, mounting studio `src/`, `.agents/`, and `public/assets/` read-only (`:ro`) and ONLY the per-run work directory (`storage/.work/run_<id>`) read-write (`:rw`). Vault secrets and host filesystem are completely invisible inside gVisor.

## 2. Non-Destructive Multi-Window Terminal (`tmux new-window` + `select-window`)

- Clicking **New chat** (`POST /api/studio/session/new`) NEVER runs `tmux kill-session`.
- Instead, it archives the current window metadata (`windowId`, `gameId`, transcript snapshot) to `storage/chats/` and opens a new tmux window inside `muse-studio` (`tmux new-window`). The old terminal window stays alive in the background so running agents are never killed.
- Clicking **Continue** on a live chat in the Sidebar (`POST /api/studio/chats/:id/continue`) runs `tmux select-window -t muse-studio:<windowId>` and activates its linked `gameId` in preview.

## 3. Game Auto-Save, Library Re-Play (`activate`), & `.zip` Download

- Changes in `public/live-preview/` auto-save/update into `storage/games/` (deduplicated per active title/session so duplicate cards are not spammed).
- Clicking **Play in preview** in the Library drawer calls `POST /api/studio/games/:id/activate`:
  - For the Owner: auto-saves current `public/live-preview/` and copies the selected library game into `public/live-preview/` for playing and continued editing.
  - For Public Judges (`!isOwnerRequest`): returns `readOnly: true` with `url: "/studio/games/<id>/index.html"` so the judge plays the game in `#game-frame` without modifying VM disk state.
- `GET /api/studio/download` zips `public/live-preview/` on the fly via `adm-zip`.

## 4. Locked UI Colors, Controls & Audio Behavior

- **Colors**: App BG and Terminal BG (including `/home/opencode/terminal/app.js` xterm `<canvas>` `_setTheme`) are locked to `#000000` (pure black). Prompt box (`.prompt-box`) is locked to `#121212` with bottom breathing padding on `.dock`.
- **Header & Preview Bar**:
  - `#header-game-title` dynamically syncs with the active game in preview.
  - `.live-pill` shows a Cloud SVG icon + Green (`#4ade80`) / Grey (`#71717a`) status dot.
  - Top bar buttons (`New chat`, `Library`, `GitHub`, `Live CLI`) match the `27px` height of `.preview-actions`.
  - `.preview-actions` merges `Save to Library`, `Refresh`, `Expand` (icon-only 4-corner maximize), and `Download (.zip)` into a single segmented container.
- **Dropdowns & Terminal Scrollbar**:
  - Mobile `.bar-left` uses `overflow: visible` so `+` (`#plus-menu`) and Model (`#model-menu`) dropdowns render cleanly on phones, with strict mutual exclusion.
  - `#term-scrollbar` + `#term-scroll-thumb` provide a draggable thumb handle (invisible track) + mobile touch-scroll wired to `POST /api/studio/terminal/scroll`.
- **Pause / Tab-Switch Audio Silence**:
  - Pausing the game or switching tabs dispatches `ags-pause` and calls `suspendAll()` to immediately silence WebAudio + HTML audio + speechSynthesis.

## 5. Flagship Game: "Ashes of St. Vermilion" (Stages 1–3) & Mother Agatha 3D Rig

- Complete survival horror game in `public/live-preview/` (`index.html`, `game.js`, `levels.js`, `player.js`, `enemy.js`, `audio.js`, `ui.js`, `vfx.js`, `story.js`, `save.js`).
- **Mother Agatha (`public/live-preview/assets/agatha.glb`)**:
  - Calibrated via **Meta SAM 3.1** quadrant boxes from `ref-stvermilion-nun.webp` (`src/tools/build_agatha_sam31.py`).
  - Features a **Real 3D Human Lady Face** + **Deep Crimson Red Glowing Eyes** + black tattered nun habit/hood + rosary crucifix + Polyhaven `Lantern_01` brass lantern.
  - Rigged in Blender 3.4 with a **20-bone humanoid Armature (`1 skin, 20 joints, 11 skinned meshes`)** and baked **`Idle` (48 frames) + `Walk` (32 frames)** animations driven by `THREE.AnimationMixer` in `enemy.js` and `agatha-viewer.js`.
