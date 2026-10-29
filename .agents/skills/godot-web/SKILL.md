---
name: godot-web
description: Build and export Godot 4 web games on this VM. Use when the user asks for a Godot game, GDScript logic, or a playable web export. Owns the headless export workflow, project layout, and preview handoff.
license: MIT
metadata:
  version: "1.0.0"
  author: "Agentic Game Studio"
---

# Godot 4 Web Games on This VM

## Environment (verified live)

- Binary: `/usr/local/bin/godot` — **Godot 4.7.2 stable**
- Export templates: installed (`~/.local/share/godot/export_templates/4.7.2.stable/`)
- No GPU on VM — headless export works fine CPU-only. Never use `--rendering-driver opengl3` for export; default headless is correct.
- Reference project: `/home/opencode/project-data/workspace/games/cybersurge/` (Player/Crystal/Obstacle scenes, GameManager with score/health/spawn, working `build/web/` export). Read its `scripts/*.gd` before writing new gameplay — reuse proven mechanics, don't invent from zero.

## Workflow

1. **New game:** `godot --headless --path <proj> --quit` once to init `.godot/`, or copy the cybersurge skeleton (project.godot, scenes/, scripts/) and rename.
2. **Write GDScript:** player movement, spawner, collectibles, HUD (Score/Health/GameOver), signals (`hit_obstacle`, `collected_crystal`). Keep scripts small and single-purpose like cybersurge's (15–100 lines each).
3. **Import check:** `godot --headless --path <proj> --import` — fix errors before export.
4. **Web export:** `godot --headless --path <proj> --export-release "Web" <out>/index.html` (preset name must match `export_presets.cfg`).
5. **Preview handoff:** copy the exported `index.html` + assets into `public/live-preview/` — the right-side Game Preview pane auto-reloads within ~2s. Serve test locally first if needed: `python3 -m http.server` in the export dir (COOP/COEP not required for basic Godot 4 web export viewing).

## Hard Rules

- Web export dir must stay self-contained (relative paths only).
- `.glb` models go in project `models/`; keep each under 5MB for fast preview loads (decimate in Blender if bigger).
- Gameplay tuning (speed, spawn interval, jump) lives in exported constants at top of scripts — never bury magic numbers.
- Do NOT commit `build/web/` cache noise (`.import` churn) — export fresh on demand.
