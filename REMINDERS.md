# REMINDERS — read before submission (Nov 4, 9PM ET)

## 🔴 CRITICAL: swap 3D backend Trellis → SAM 3D before submission

- Dev/testing uses `ASSET_3D_BACKEND=trellis` (Microsoft TRELLIS on Modal).
  Trellis is **NOT a Meta model** — shipping it = breaks the
  "Every project must use Meta's models" rule = disqualification risk.
- **By Nov 3 latest:** set `ASSET_3D_BACKEND=sam3d` (Meta SAM 3D Objects)
  in the VM env + `startup.sh`, rebuild one asset end-to-end to confirm,
  then submit.
- After Nov 3, `src/pipeline/assets_3d.js` prints a SUBMISSION BLOCKER
  warning on every Trellis call. Do not ignore it.
- Pre-submit checklist: `grep -rn "trellis" src/ public/ --include="*.js" -i`
  must show only warnings/comments, zero live Trellis calls.

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
