/**
 * Vercel Serverless Function - /api/generate
 *
 * Powered by Meta Muse Spark Open via Baseten ($100 Hackathon Credits)
 */

import { MuseWonderDirector } from "../src/agent/muse_wonder.js";
import { HunyuanWorldPipeline } from "../src/pipeline/hunyuan_world.js";
import { generateThreeJsGameHtml } from "../src/engine/threejs_runtime.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { prompt } = req.body || {};
    const cleanPrompt = prompt || "Procedural spatial world";

    // 1. Meta Muse Wonder Planning (via Baseten)
    const director = new MuseWonderDirector();
    const spec = await director.architectGame(cleanPrompt);

    // 2. Hunyuan World 2.0 Spatial Terrain Synthesis
    const worldPipeline = new HunyuanWorldPipeline();
    const worldData = worldPipeline.generateWorldGeometry(spec.world);

    // 3. Three.js WebGL Code Compilation
    const gameHtml = generateThreeJsGameHtml(spec, worldData);

    return res.status(200).json({
      success: true,
      spec,
      gameHtml,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Generation error",
    });
  }
}
