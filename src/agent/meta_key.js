/**
 * Shared Meta Model API key resolution.
 * Env first (MODEL_API_KEY / META_API_KEY), then the local VM vault.
 * The key value is never logged anywhere.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const VAULT_SCRIPT =
  "/home/opencode/project-data/workspace/.orchestrator/vault.mjs";

export function readVaultKey(name) {
  try {
    if (!fs.existsSync(VAULT_SCRIPT)) return undefined;
    const out = execFileSync("node", [VAULT_SCRIPT, "get", name], {
      encoding: "utf8",
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveMetaApiKey() {
  return (
    process.env.MODEL_API_KEY ||
    process.env.META_API_KEY ||
    readVaultKey("Meta_Key")
  );
}
