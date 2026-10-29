#!/usr/bin/env node
/**
 * Agentic Game Studio - Pipeline build tool for the live Muse Code CLI.
 *
 * Runs the full deterministic pipeline WITHOUT spawning a nested CLI
 * subprocess (the live interactive CLI session IS the agent already):
 *   safety shield -> Wonder + Baseten design -> concept art ->
 *   terrain + layout -> Three.js files -> Unity C# ->
 *   physics QA gate -> library save.
 * Then copies the built index.html + game.js into public/live-preview/
 * so the right-side Game Preview pane auto-reloads within ~2s.
 *
 * Usage: node src/tools/build-game.js --prompt "your game idea"
 *        [--model muse-spark-1.3]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRunner } from "../agent/agent_runner.js";

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

async function main() {
  const prompt = argValue("--prompt", "");
  const model = argValue("--model", undefined);
  if (!prompt.trim()) {
    console.error('Usage: node src/tools/build-game.js --prompt "game idea"');
    process.exit(2);
  }

  console.log(`[build-game] prompt: "${prompt.trim()}"`);

  const emit = (evt) => {
    if (evt.type === "phase") {
      console.log(
        `[${evt.id}] ${evt.status}${evt.detail ? " — " + evt.detail : ""}`,
      );
    } else if (evt.type === "log") {
      console.log(`  ${evt.message}`);
    } else if (evt.type === "proof") {
      console.log(`  [proof] ${evt.name}: ${evt.passed ? "PASSED" : "FAILED"}`);
    } else if (evt.type === "done" && !evt.ok) {
      console.log("  run finished without a playable game");
    }
  };

  const runner = new AgentRunner(ROOT, emit);
  const result = await runner.run(prompt, {
    model,
    attachments: [],
    skipSubprocessCli: true,
  });
  if (!result.ok) {
    console.error("[build-game] FAILED: pipeline run failed");
    process.exit(1);
  }

  const gameDir = path.join(ROOT, "storage", "games", result.gameId);
  const liveDir = path.join(ROOT, "public", "live-preview");
  fs.mkdirSync(liveDir, { recursive: true });
  for (const file of ["index.html", "game.js"]) {
    const src = path.join(gameDir, file);
    if (!fs.existsSync(src)) {
      console.error(`[build-game] FAILED: missing ${file} in ${gameDir}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(liveDir, file));
  }

  console.log(
    `[build-game] game: ${result.gameId} title="${result.spec?.title || ""}"`,
  );
  console.log("PREVIEW_READY public/live-preview/index.html");
}

main().catch((err) => {
  console.error(`[build-game] FAILED: ${err.message}`);
  process.exit(1);
});
