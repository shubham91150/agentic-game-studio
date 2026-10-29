#!/usr/bin/env node
/**
 * Agentic Game Studio - Publish a HAND-MADE game into the library.
 *
 * Copies an existing game folder VERBATIM (no regeneration, no template)
 * into storage/games/<id>/ and registers it in storage/games/index.json
 * using the exact GameStorageManager manifest schema.
 *
 * Usage:
 *   node src/tools/publish-game.js --dir <game-folder> --title "..." [--prompt "..."]
 *   [--biome "..."] [--objective "..."] [--id <game-id>]
 *
 * NEVER use src/tools/build-game.js for hand-made games — that tool
 * REGENERATES a template orb-collector from the prompt and would
 * overwrite the real game. build-game.js is ONLY for fresh
 * pipeline-generated ideas.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const GAMES_DIR = path.join(ROOT, "storage", "games");
const INDEX_FILE = path.join(GAMES_DIR, "index.json");

// Co-located asset extensions copied verbatim (flat, top level of --dir).
const ASSET_EXTS = new Set([
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".json",
  ".glb",
  ".mp3",
  ".wav",
  ".ogg",
]);

// Titles that indicate template junk / placeholder instead of a real game.
const JUNK_TITLE =
  /^(untitled|test|game|demo|my game|cyber orbital.*|.*orb rush.*)$/i;

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1] !== undefined)
    return process.argv[idx + 1];
  return fallback;
}

function fail(msg) {
  console.error(`[publish-game] FAILED: ${msg}`);
  process.exit(1);
}

function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "game"
  );
}

async function main() {
  const dirArg = argValue("--dir", "");
  const title = String(argValue("--title", "")).trim();
  const prompt = String(argValue("--prompt", "")).trim();
  const biome = String(argValue("--biome", "hand-made")).trim() || "hand-made";
  const objective = String(argValue("--objective", prompt)).trim();
  const forcedId = String(argValue("--id", "")).trim();

  // ---- Validate ----
  if (!dirArg) fail("missing --dir <game-folder>. Nothing was published.");
  const srcDir = path.resolve(ROOT, dirArg);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    fail(`game folder not found: ${srcDir}. Nothing was published.`);
  }
  const indexHtml = path.join(srcDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    fail(
      `no index.html in ${srcDir}. A publishable game must have index.html.`,
    );
  }
  if (!title)
    fail("missing --title. A publishable game must have a real title.");
  if (title.length < 3 || JUNK_TITLE.test(title)) {
    fail(
      `refusing junk title "${title}". Pass a real game title via --title. Nothing was published.`,
    );
  }
  let gameId = forcedId;
  if (gameId && !/^[\w-]+$/.test(gameId)) {
    fail(`bad --id "${gameId}". Use letters, digits, _ or -.`);
  }
  if (!gameId) {
    gameId = "game_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  const gameDir = path.join(GAMES_DIR, gameId);
  if (fs.existsSync(gameDir) && !forcedId) {
    fail(
      `collision: ${gameDir} already exists. Re-run to retry with a fresh id.`,
    );
  }
  fs.mkdirSync(gameDir, { recursive: true });

  // ---- Copy index.html + co-located assets verbatim ----
  const copied = [];
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (entry.name === "index.html" || ASSET_EXTS.has(ext)) {
      fs.copyFileSync(
        path.join(srcDir, entry.name),
        path.join(gameDir, entry.name),
      );
      copied.push(entry.name);
    }
  }
  // Recurse into assets/ if the hand-made game ships one.
  const srcAssets = path.join(srcDir, "assets");
  if (fs.existsSync(srcAssets) && fs.statSync(srcAssets).isDirectory()) {
    const destAssets = path.join(gameDir, "assets");
    fs.mkdirSync(destAssets, { recursive: true });
    for (const entry of fs.readdirSync(srcAssets, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      fs.copyFileSync(
        path.join(srcAssets, entry.name),
        path.join(destAssets, entry.name),
      );
      copied.push(`assets/${entry.name}`);
    }
  }
  if (!copied.includes("index.html"))
    fail("index.html copy failed. Nothing was published.");

  // ---- Manifest in the EXACT GameStorageManager schema ----
  const hasJs = copied.some((f) => f.endsWith(".js"));
  const hasConcept =
    copied.includes("assets/concept.webp") ||
    copied.includes("assets/concept.png") ||
    copied.includes("assets/concept.jpg");
  const manifest = {
    id: gameId,
    title,
    prompt,
    biome,
    metaModel: "hand-made",
    enrichmentModel: null,
    objective,
    createdAt: new Date().toISOString(),
    playUrl: `/studio/games/${gameId}/index.html`,
    imageUrl: hasConcept
      ? `/studio/games/${gameId}/assets/${copied.find((f) => f.startsWith("assets/concept"))}`
      : null,
    files: {
      html: "index.html",
      manifest: "manifest.json",
      unity: [],
    },
  };
  if (hasJs) {
    const main = copied.includes("game.js")
      ? "game.js"
      : copied.find((f) => f.endsWith(".js"));
    manifest.files.js = main;
  }

  await fs.promises.writeFile(
    path.join(gameDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  // ---- Upsert index.json entry (newest first) ----
  let index = [];
  try {
    index = JSON.parse(
      (await fs.promises.readFile(INDEX_FILE, "utf8")) || "[]",
    );
    if (!Array.isArray(index)) index = [];
  } catch {
    index = [];
  }
  index = index.filter((e) => e && e.id !== gameId);
  index.unshift(manifest);
  await fs.promises.writeFile(
    INDEX_FILE,
    JSON.stringify(index, null, 2),
    "utf8",
  );

  console.log(
    `[publish-game] published "${title}" (${copied.length} files copied verbatim)`,
  );
  console.log(`[publish-game] id: ${gameId}`);
  console.log(`[publish-game] playUrl: ${manifest.playUrl}`);
}

main().catch((err) => {
  console.error(`[publish-game] FAILED: ${err.message}`);
  process.exit(1);
});
