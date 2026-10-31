# REMINDERS — read before submission (Nov 4, 9PM ET)

## 🔴 CRITICAL: remove Trellis dev backend before submission (Nov 3)

- Dev/testing uses `ASSET_3D_BACKEND=trellis` (Microsoft TRELLIS on Modal).
  Trellis is **NOT a Meta model** — shipping it = breaks the
  "Every project must use Meta's models" rule = disqualification risk.
  Trellis is dev-only and never ships.
- **By Nov 3 latest:** REMOVE the Trellis backend; confirm no trellis
  references ship: `grep -rn "trellis" src/ public/ --include="*.js" -i`
  must show zero live Trellis calls (warnings/comments only).
- SAM 3D stays as VERIFIED-but-limited: integrated, trial-verified
  (2 green runs, evidence in `docs/evidence-sam3d/`), used for hero assets
  subject to GPU availability; shipped game path uses Blender/kit assets.

## Model allowlist (hackathon requires Meta-only)

- Meta Model API: `muse-spark-1.3`, `muse-wonder-1.0`, `muse-image-1.0`,
  `sam-3.1` (+ contributors variants in the CLI catalog)
- Open weights: `meta-models/muse-spark-open-1026` (Baseten, note the
  `-1026` suffix — the un-suffixed id is NOT compliant)
- Coding agent: Muse Code CLI. 3D: SAM 3D Objects (Modal A100).
- Forbidden in shipped path: TRELLIS (Microsoft), TripoSR (StabilityAI).

## Repo hygiene

- `main` branch only, commits inside Oct 26 – Nov 4 window.
- No trademarked IP, no war/weapon themes (safety shield enforces).
- README/docs must match actual code (truthfulness rule).
