#!/usr/bin/env node
/**
 * Agentic Game Studio - CLI entrypoint.
 * Delegates to the same AgentRunner the web backend uses, so CLI, VM
 * server, and Vercel-triggered runs all produce identical artifacts.
 * Usage: node src/agent/generate.js --prompt "your game idea"
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRunner } from "./agent_runner.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function main() {
  const args = process.argv.slice(2);
  let prompt =
    "Futuristic spatial runner with kinetic energy cells and dynamic terrain";
  const pIdx = args.indexOf("--prompt");
  if (pIdx !== -1 && args[pIdx + 1]) prompt = args[pIdx + 1];

  console.log("Agentic Game Studio — live agent run");
  console.log(`Prompt: "${prompt}"\n`);

  const emit = (evt) => {
    if (evt.type === "phase")
      console.log(
        `[${evt.id}] ${evt.status}${evt.detail ? " — " + evt.detail : ""}`,
      );
    else if (evt.type === "log") console.log(`  ${evt.message}`);
    else if (evt.type === "cli") console.log(`  $ ${evt.line}`);
    else if (evt.type === "proof")
      console.log(`  [proof] ${evt.name}: ${evt.passed ? "PASSED" : "FAILED"}`);
    else if (evt.type === "done")
      console.log(
        `\nDone: ${evt.title} (${evt.gameId}) unity=${evt.unitySource}`,
      );
  };

  const runner = new AgentRunner(ROOT, emit);
  const result = await runner.run(prompt);
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error("Run failed:", err.message);
  process.exit(1);
});
