/**
 * 3D asset backend dispatcher (100% Meta Open-Weight Models).
 *
 *   ASSET_3D_BACKEND=sam3d -> Meta SAM 3D Objects on Modal (default)
 *   ASSET_3D_BACKEND=vggt  -> Meta VGGT-1B on Modal
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");

export const SUBMISSION_BACKEND = "sam3d";
export const ALLOWED_3D_BACKENDS = ["sam3d", "vggt"];

export function activeBackend() {
  const raw = String(
    process.env.ASSET_3D_BACKEND || SUBMISSION_BACKEND,
  ).toLowerCase();
  return ALLOWED_3D_BACKENDS.includes(raw) ? raw : SUBMISSION_BACKEND;
}

export function backendStatus() {
  const backend = activeBackend();
  return { backend, compliant: true, pastDeadline: false };
}

/**
 * Generate a .glb from an image (+ optional mask PNG) via Meta SAM 3D / VGGT on Modal.
 * @returns {{backend: string, glbPath: string, compliant: boolean}}
 */
export function generate3DAsset(imagePath, maskPath) {
  const { backend, compliant } = backendStatus();
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
