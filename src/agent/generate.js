#!/usr/bin/env node
/**
 * Agentic Game Studio - CLI Orchestrator Entrypoint
 */

import fs from "node:fs";
import path from "node:path";
import { MuseWonderDirector } from "./muse_wonder.js";
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

  // Step 1: Meta Muse Wonder Planning
  console.log("🧠 Step 1/4: Meta Muse Wonder decomposing game architecture...");
  const director = new MuseWonderDirector();
  const gameSpec = await director.architectGame(prompt);
  console.log(`   ✔ Title: "${gameSpec.title}"`);
  console.log(`   ✔ Biome: ${gameSpec.world.biome}`);
  console.log(`   ✔ Identified ${gameSpec.focalAssets.length} focal 3D assets`);

  // Step 2: Hunyuan World Environment Synthesis
  console.log(
    "\n🌍 Step 2/4: Hunyuan World 2.0 synthesizing spatial terrain...",
  );
  const worldPipeline = new HunyuanWorldPipeline();
  const worldData = worldPipeline.generateWorldGeometry(gameSpec.world);
  console.log(
    `   ✔ Generated ${worldData.gridSize}x${worldData.gridSize} procedural elevation grid`,
  );

  // Step 3: WebGL Three.js Runtime Assembly
  console.log("\n⚡ Step 3/4: Compiling Three.js WebGL instant runtime...");
  const webDir = path.resolve(process.cwd(), "build", "web");
  fs.mkdirSync(webDir, { recursive: true });
  const html = generateThreeJsGameHtml(gameSpec, worldData);
  const webHtmlPath = path.join(webDir, "index.html");
  fs.writeFileSync(webHtmlPath, html, "utf8");
  console.log(`   ✔ Live Web Game saved to: ${webHtmlPath}`);

  // Step 4: Unity 2022.3 LTS C# Project Export
  console.log(
    "\n🕹️ Step 4/4: Exporting Native Unity 2022.3 C# Studio Project...",
  );
  const unityDir = path.resolve(process.cwd(), "build", "unity");
  const unityExporter = new UnityExporter(unityDir);
  const unityResult = unityExporter.exportProject(gameSpec, unityDir);
  console.log(
    `   ✔ Unity Scripts generated: ${unityResult.scripts.join(", ")}`,
  );
  console.log(`   ✔ Unity Project exported to: ${unityResult.path}`);

  console.log("\n============================================================");
  console.log("🎉 GAME CREATION COMPLETED SUCCESSFULLY (Zero Errors)!");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Execution failed:", err.message);
  process.exit(1);
});
