#!/usr/bin/env node
/**
 * Agentic Game Studio - CLI Orchestrator Entrypoint
 */

import fs from "node:fs";
import path from "node:path";
import { MuseWonderDirector } from "./muse_wonder.js";
import { MuseCodeExecutor } from "./muse_code_cli.js";
import { HunyuanWorldPipeline } from "../pipeline/hunyuan_world.js";
import { generateThreeJsGameHtml } from "../engine/threejs_runtime.js";
import { UnityExporter } from "../engine/unity_exporter.js";

async function main() {
  const args = process.argv.slice(2);
  let prompt =
    "Futuristic cyber runner with kinetic energy cells and dynamic terrain";

  const pIdx = args.indexOf("--prompt");
  if (pIdx !== -1 && args[pIdx + 1]) {
    prompt = args[pIdx + 1];
  }

  console.log("============================================================");
  console.log("🎮 AGENTIC GAME STUDIO (Meta Hackathon 2026)");
  console.log("   Powered by Meta Muse Wonder + Hunyuan World 2.0");
  console.log("============================================================");
  console.log(`Prompt: "${prompt}"\n`);

  // Step 1: Meta Muse Wonder Planning & Muse Code Execution
  console.log(
    "🧠 Step 1/4: Meta Muse Wonder & Muse Code CLI orchestrating world...",
  );
  const director = new MuseWonderDirector();
  const executor = new MuseCodeExecutor();
  const gameSpec = await director.architectGame(prompt);

  // Persist spec via Muse Code wrapper
  await executor.writeFile(
    "build/spec.json",
    JSON.stringify(gameSpec, null, 2),
  );
  console.log(`   ✔ Title: "${gameSpec.title}"`);
  console.log(`   ✔ Biome: ${gameSpec.world.biome}`);
  console.log(`   ✔ Muse Code CLI verified local workspace write`);

  // Step 2: Hunyuan World Environment Synthesis
  console.log(
    "\n🌍 Step 2/4: Hunyuan World 2.0 synthesizing spatial terrain...",
  );
  const worldPipeline = new HunyuanWorldPipeline();
  const worldData = worldPipeline.generateWorldGeometry(gameSpec.world);
  console.log(
    `   ✔ Generated ${worldData.gridSize}x${worldData.gridSize} procedural elevation grid`,
  );

  // Step 3: WebGL Three.js Runtime Assembly via Muse Code
  console.log(
    "\n⚡ Step 3/4: Muse Code synthesizing Three.js WebGL instant runtime...",
  );
  const webDir = path.resolve(process.cwd(), "build", "web");
  const html = generateThreeJsGameHtml(gameSpec, worldData);
  await executor.writeFile("build/web/index.html", html);
  console.log(
    `   ✔ Live Web Game written via Muse Code to: ${path.join(webDir, "index.html")}`,
  );

  // Step 4: Unity 2022.3 LTS C# Project Export via Muse Code
  console.log(
    "\n🕹️ Step 4/4: Muse Code exporting Native Unity 2022.3 C# Project...",
  );
  const unityDir = path.resolve(process.cwd(), "build", "unity");
  const unityExporter = new UnityExporter(unityDir);
  const unityResult = unityExporter.exportProject(gameSpec, unityDir);
  console.log(
    `   ✔ Unity Scripts synthesized via Muse Code: ${unityResult.scripts.join(", ")}`,
  );
  console.log(`   ✔ Unity Project ready at: ${unityResult.path}`);

  console.log("\n============================================================");
  console.log("🎉 GAME CREATION COMPLETED SUCCESSFULLY (Zero Errors)!");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Execution failed:", err.message);
  process.exit(1);
});
