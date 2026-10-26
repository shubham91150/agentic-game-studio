/**
 * Agentic Game Studio - Studio Web Server & API
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MuseWonderDirector } from "./agent/muse_wonder.js";
import { HunyuanWorldPipeline } from "./pipeline/hunyuan_world.js";
import { generateThreeJsGameHtml } from "./engine/threejs_runtime.js";
import { UnityExporter } from "./engine/unity_exporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BUILD_DIR = path.join(ROOT_DIR, "build");

const PORT = process.env.PORT || 3030;

const director = new MuseWonderDirector();
const worldPipeline = new HunyuanWorldPipeline();

// Ensure initial game exists
const initialWebDir = path.join(BUILD_DIR, "web");
fs.mkdirSync(initialWebDir, { recursive: true });
const initialGamePath = path.join(initialWebDir, "index.html");
if (!fs.existsSync(initialGamePath)) {
  const defaultSpec = await director.architectGame(
    "Futuristic kinetic spatial arena",
  );
  const defaultWorld = worldPipeline.generateWorldGeometry(defaultSpec.world);
  fs.writeFileSync(
    initialGamePath,
    generateThreeJsGameHtml(defaultSpec, defaultWorld),
    "utf8",
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // 1. Studio Dashboard Home
  if (pathname === "/" || pathname === "/studio" || pathname === "/studio/") {
    const htmlPath = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(htmlPath));
    }
  }

  // 2. Live WebGL Game Viewport
  if (pathname === "/game" || pathname === "/game/") {
    if (fs.existsSync(initialGamePath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(initialGamePath));
    }
  }

  // 3. API: Generate Game
  if (pathname === "/api/generate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const prompt = payload.prompt || "Procedural spatial world";

        // Step 1: Meta Muse Wonder Planning
        const spec = await director.architectGame(prompt);

        // Step 2: Hunyuan World 2.0 Synthesis
        const worldData = worldPipeline.generateWorldGeometry(spec.world);

        // Step 3: WebGL Compilation
        const gameHtml = generateThreeJsGameHtml(spec, worldData);
        fs.writeFileSync(initialGamePath, gameHtml, "utf8");

        // Step 4: Unity Export
        const unityDir = path.join(BUILD_DIR, "unity");
        const unityExporter = new UnityExporter(unityDir);
        const unityResult = unityExporter.exportProject(spec, unityDir);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            spec,
            unityScripts: unityResult.scripts,
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Generation failed" }));
      }
    });
    return;
  }

  // 4. API: Download Unity C# Scripts
  if (pathname === "/api/export/unity") {
    const scriptsDir = path.join(BUILD_DIR, "unity", "Assets", "Scripts");
    const playerCs = path.join(scriptsDir, "AgenticPlayerController.cs");
    if (fs.existsSync(playerCs)) {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Disposition":
          "attachment; filename=AgenticPlayerController.cs",
      });
      return res.end(fs.readFileSync(playerCs));
    }
  }

  // 404 Fallback
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Agentic Game Studio] Server running on port ${PORT}`);
});
