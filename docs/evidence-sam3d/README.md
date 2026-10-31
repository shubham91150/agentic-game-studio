# Evidence: SAM 3D Objects trial verification (Meta, Modal A100)

SAM 3D = **integrated, trial-verified (2 green runs below), used for hero
assets subject to GPU availability; the shipped game path uses Blender/kit
assets**. Trellis = dev-only, removed before submission Nov 3.

## Files

| File                | Bytes      | Proves                                                                                              |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `sam3d_verify.glb`  | 5,170,920  | Valid glTF (`glTF` magic + v2 header verified) from trial 3, Modal backend `spurcode-sam3d-objects` |
| `sam3d_verify2.glb` | 11,415,872 | Valid glTF from trial 4 (second green run, larger/denser output)                                    |
| `trial1.log`        | 61         | `[sam3d] saved /tmp/opencode/sam3d_verify.glb (5170920 bytes)` — first save line                    |
| `trial3.log`        | 76         | `[sam3d] saved .../sam3d_verify.glb (5172088 bytes)` + `TRIAL3 EXIT: 0`                             |
| `trial4.log`        | 78         | `[sam3d] saved .../sam3d_verify2.glb (11415872 bytes)` + `TRIAL4 EXIT: 0`                           |
| `speed.log`         | 82         | `[sam3d] saved .../sam3d_speed.glb (4671416 bytes)` + `EXIT: 0 \| WALL: 5242s`                      |

Note: `trial3.log` records 5,172,088 bytes but the preserved
`sam3d_verify.glb` is 5,170,920 bytes — the /tmp file was re-saved by a
later invocation before archival. Both are valid glTF; byte count above is
the archived file. `trial2.log` (`/tmp/opencode/sam3d-trial2.log`) was an
empty (0-byte) run with no output — listed as missing, not faked. The
invoking input image per trial was not recorded in the logs, so inputs are
not claimed here.

## Trial wall-times (honest)

- Trial logs record only the save line + exit code — per-trial wall times
  were **not separately instrumented**, so none are invented here. Trial 3
  and trial 4 file mtimes are ~17 min apart (30 Oct 2026 13:50 → 14:07 UTC),
  which bounds but does not equal per-trial runtime.
- Speed run total wall: **5242 s (~87 min), EXIT 0**. That wall is
  Modal cold-start/queue-dominated on the A100 (image build + weight fetch
  dominate; see `sam3d-deploy*.log` — e.g. `App deployed in 2388.929s`);
  pure inference is minutes. Queue-vs-inference split was not separately
  logged — not claimed.

## numpy fix (one-liner)

Pin `numpy==1.26.4`: kaolin's prebuilt Cython exts were compiled against
numpy 1.x headers (`PyArray_Descr` = 96 bytes); any numpy 2.x at runtime
breaks it with `ValueError: numpy.dtype size changed`. Re-asserted AFTER the
MoGe/gsplat installs, which otherwise upgrade numpy back to 2.x. (Source:
`tools/modal_sam3d_pipeline.py` image definition.)
