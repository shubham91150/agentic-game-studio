/**
 * 3D asset backend dispatcher.
 *
 *   ASSET_3D_BACKEND=trellis  -> Microsoft TRELLIS on Modal (dev/testing ONLY)
 *   ASSET_3D_BACKEND=sam3d    -> Meta SAM 3D Objects on Modal (HACKATHON SUBMISSION)
 *
 * Default is trellis while we iterate cheaply on A10G. Before submission
 * (Nov 4, 9PM ET) this MUST be sam3d: the hackathon requires Meta models
 * only, and Trellis is Microsoft. See REMINDERS.md.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");

export const SUBMISSION_BACKEND = "sam3d";
export const DEV_BACKEND = "trellis";
// Loud blocker: from Nov 3 onward a non-Meta backend is a submission risk.
export const SWAP_DEADLINE_ISO = "2026-11-03T00:00:00Z";

export function activeBackend() {
  const raw = String(process.env.ASSET_3D_BACKEND || DEV_BACKEND).toLowerCase();
  return raw === SUBMISSION_BACKEND ? SUBMISSION_BACKEND : DEV_BACKEND;
}

export function backendStatus() {
  const backend = activeBackend();
  const pastDeadline = Date.now() >= Date.parse(SWAP_DEADLINE_ISO);
  const compliant = backend === SUBMISSION_BACKEND;
  return { backend, compliant, pastDeadline };
}

/**
 * Generate a .glb from an image (+ optional mask PNG) via Modal.
 * @returns {{backend: string, glbPath: string, compliant: boolean}}
 */
export function generate3DAsset(imagePath, maskPath) {
  const { backend, compliant, pastDeadline } = backendStatus();
  if (!compliant) {
    const msg = pastDeadline
      ? "SUBMISSION BLOCKER: ASSET_3D_BACKEND is still trellis (non-Meta) past the Nov 3 swap deadline. Set ASSET_3D_BACKEND=sam3d NOW."
      : "WARNING: 3D backend is trellis (Microsoft, dev-only). Swap to ASSET_3D_BACKEND=sam3d before submission (see REMINDERS.md).";
    console.warn(`[assets-3d] ${msg}`);
  }
  const id = crypto.randomBytes(4).toString("hex");
  const outDir = path.join(ROOT_DIR, "storage", ".uploads");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `asset3d_${backend}_${id}.glb`);
  const args = [
    path.join(ROOT_DIR, "src", "tools", "modal_call_3d.py"),
    "--backend",
    backend,
    "--image",
    imagePath,
    "--out",
    outPath,
  ];
  if (maskPath) args.push("--mask", maskPath);
  execFileSync("python3", args, { stdio: "inherit", timeout: 15 * 60 * 1000 });
  if (!fs.existsSync(outPath)) {
    throw new Error("3D backend returned no GLB file.");
  }
  return { backend, glbPath: outPath, compliant };
}
