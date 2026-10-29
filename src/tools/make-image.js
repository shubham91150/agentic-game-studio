#!/usr/bin/env node
/**
 * Agentic Game Studio - Image tool for the live Muse Code CLI.
 *
 * Lets the CLI generate game images with Meta Muse Image 1.0 no matter
 * which chat model is active (the call goes direct to the Meta Model API
 * with the VM key, not through the CLI session model).
 *
 * Usage:
 *   node src/tools/make-image.js --prompt "sci-fi power crystal, key art" \
 *     [--out storage/.uploads/crystal.webp] [--concept]
 *
 * --concept saves into the pipeline concept-art cache dir instead.
 * Prints the saved file path on success.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { MetaImageClient } from "../pipeline/meta_image.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function safeName(text) {
  return (
    String(text || "image")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 40)
      .replace(/^_+|_+$/g, "") || "image"
  );
}

async function main() {
  const prompt = argValue("--prompt", "");
  if (!prompt.trim()) {
    console.error(
      'Usage: node src/tools/make-image.js --prompt "describe the image" [--out path.webp] [--concept]',
    );
    process.exit(2);
  }
  const explicitOut = argValue("--out", "");
  const conceptMode = process.argv.includes("--concept");

  const client = new MetaImageClient();
  if (!client.available()) {
    console.error("[make-image] FAILED: Meta Model API key is not available.");
    process.exit(1);
  }

  console.log(`[make-image] generating: "${prompt.trim().slice(0, 120)}"`);
  const bytes = await client.generateConceptImage(prompt.trim());

  let dest;
  if (explicitOut) {
    dest = path.resolve(ROOT, explicitOut);
  } else if (conceptMode) {
    const dir = path.join(ROOT, "storage", "cache");
    fs.mkdirSync(dir, { recursive: true });
    dest = path.join(dir, `concept_${safeName(prompt)}.webp`);
  } else {
    const dir = path.join(ROOT, "storage", ".uploads");
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomBytes(6).toString("hex");
    dest = path.join(dir, `${id}_${safeName(prompt)}.webp`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  console.log(
    `[make-image] saved ${path.relative(ROOT, dest)} (${Math.round(bytes.length / 1024)} KB)`,
  );
}

main().catch((err) => {
  console.error(`[make-image] FAILED: ${err.message}`);
  process.exit(1);
});
