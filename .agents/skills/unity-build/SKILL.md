---
name: unity-build
description: Generate and validate Unity 2022.3 LTS projects on this VM. Use when the user asks for Unity C# code, a Unity project, or a headless Unity build. Owns the C# scaffolds, project skeleton, and batchmode verification.
license: MIT
metadata:
  version: "1.0.0"
  author: "Agentic Game Studio"
---

# Unity 2022.3 LTS on This VM

## Environment (verified live)

- Binary: `/opt/unity-editor/Editor/Unity` — **2022.3.11f1**
- License: personal ULF activated (`~/.local/share/unity3d/Unity/Unity_lic.ulf`) — batchmode works.
- No GPU — never bake lightmaps; use realtime lights only, low shadow settings.
- Existing exporter: `src/engine/unity_exporter.js` (`UnityExporter` class) already writes `AgenticPlayerController.cs`, `AgenticGameManager.cs`, `ProjectVersion.txt`, `manifest.json`. Reuse it — don't hand-write boilerplate.

## Workflow

1. **C# code:** player controller (CharacterController, WASD + Space jump + gravity), game manager singleton (score/health/spawn). UnityEngine only, no external packages.
2. **Project skeleton:** `Assets/Scripts/`, `ProjectSettings/` (from a known-good template — copy, don't invent), `ProjectVersion.txt` pinned to `2022.3.11f1`.
3. **Validate (required before saying done):** run the exporter's `validateCompilation()` (Unity `-batchmode -quit -projectPath <proj> -logFile ...`) and confirm exit 0. If Unity is unreachable, say so honestly — never claim a build passed without running it.
4. **Hand to preview:** Unity WebGL builds are heavy — for the browser preview prefer the Three.js runtime; Unity output is the downloadable C# project + build notes.

## Hard Rules

- Never invent `ProjectSettings/` contents — copy from a working project.
- Keep scripts dependency-free (UnityEngine only).
- Batchmode commands must use absolute `-projectPath` and always pass `-logFile`; read the log on failure.
- License file is personal — never copy `Unity_lic.ulf` into the repo or any build artifact.
