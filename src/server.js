/**
 * Agentic Game Studio - Backend Server (VM)
 *
 * Serves the studio UI and the live agent API with Server-Sent Events,
 * so the browser can watch the agent work in real time.
 *
 * Routes (all public, no auth):
 *   GET  /                                -> studio UI
 *   GET  /api/studio/health               -> pipeline component health
 *   GET  /api/studio/games                -> stored game library
 *   GET  /api/studio/games/:id            -> single game manifest
 *   POST /api/studio/generate             -> SSE stream of agent events
 *   GET  /studio/games/:id/index.html     -> play a stored game
 *   GET  /api/studio/export/unity/:id     -> download a Unity C# script
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentRunner, resolveMetaApiKey } from "./agent/agent_runner.js";
import { GameStorageManager } from "./storage/game_store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STORAGE_DIR = path.join(ROOT_DIR, "storage", "games");

const PORT = Number(process.env.STUDIO_PORT || 3030);
const gameStore = new GameStorageManager(STORAGE_DIR);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = url.pathname;

  // CORS so the Vercel-hosted UI can also call this backend directly.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // ---------- Studio UI ----------
  if (pathname === "/" || pathname === "/studio" || pathname === "/studio/") {
    return sendFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  // ---------- Health ----------
  if (pathname === "/api/studio/health") {
    let musePresent = false;
    try {
      musePresent = fs.existsSync(
        path.join(process.env.HOME || "/root", ".local", "bin", "muse"),
      );
    } catch {
      musePresent = false;
    }
    return json(res, 200, {
      ok: true,
      service: "agentic-game-studio-backend",
      components: {
        museCodeCLI: musePresent,
        cliModel: process.env.MUSE_CLI_MODEL || "muse-spark-1.3",
        cliProvider: "meta-model-api",
        metaKeyPresent: Boolean(resolveMetaApiKey()),
        plannerModel: "meta-models/muse-spark-open",
        plannerProvider: "baseten",
        basetenKeyPresent: Boolean(
          process.env.BASETEN_API_KEY ||
          fs.existsSync(
            "/home/opencode/project-data/workspace/.orchestrator/vault.mjs",
          ),
        ),
        terrain: "procedural elevation grid",
        engines: ["threejs-webgl", "unity-csharp"],
      },
      time: new Date().toISOString(),
    });
  }

  // ---------- Library list ----------
  if (pathname === "/api/studio/games" && req.method === "GET") {
    const games = await gameStore.listGames();
    return json(res, 200, games);
  }

  // ---------- Single game manifest ----------
  const manifestMatch = pathname.match(/^\/api\/studio\/games\/([\w-]+)$/);
  if (manifestMatch && req.method === "GET") {
    const found = await gameStore.getGame(manifestMatch[1]);
    if (!found) return json(res, 404, { error: "Game not found" });
    return json(res, 200, found.manifest);
  }

  // ---------- Stored game code (Unity C# written for that game) ----------
  const codeMatch = pathname.match(/^\/api\/studio\/games\/([\w-]+)\/code$/);
  if (codeMatch && req.method === "GET") {
    const found = await gameStore.getGame(codeMatch[1]);
    if (!found) return json(res, 404, { error: "Game not found" });
    const unityPath = path.join(
      STORAGE_DIR,
      codeMatch[1],
      "unity",
      "AgenticPlayerController.cs",
    );
    const unity = fs.existsSync(unityPath)
      ? fs.readFileSync(unityPath, "utf8")
      : "";
    return json(res, 200, { manifest: found.manifest, unity, spec: null });
  }

  // ---------- Unity script download ----------
  const unityMatch = pathname.match(/^\/api\/studio\/export\/unity\/([\w-]+)$/);
  if (unityMatch) {
    const scriptPath = path.join(
      STORAGE_DIR,
      unityMatch[1],
      "unity",
      "AgenticPlayerController.cs",
    );
    if (!fs.existsSync(scriptPath)) {
      return json(res, 404, { error: "Unity script not found for this game" });
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": "attachment; filename=AgenticPlayerController.cs",
    });
    return fs.createReadStream(scriptPath).pipe(res);
  }

  // ---------- Play a stored game ----------
  const playMatch = pathname.match(/^\/studio\/games\/([\w-]+)\/index\.html$/);
  if (playMatch) {
    return sendFile(res, path.join(STORAGE_DIR, playMatch[1], "index.html"));
  }

  // ---------- Live agent run (Server-Sent Events) ----------
  if (pathname === "/api/studio/generate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let prompt = "";
      try {
        prompt = JSON.parse(body || "{}").prompt || "";
      } catch {
        prompt = "";
      }

      if (!prompt.trim()) {
        return json(res, 400, { error: "A game prompt is required." });
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let closed = false;
      // NOTE: req "close" fires as soon as the POST body is consumed in
      // Node 20, which would mute the whole stream. Client disconnects
      // surface on the response object instead.
      res.on("close", () => {
        closed = true;
      });

      const emit = (event) => {
        if (closed || res.writableEnded) return;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          closed = true;
        }
      };

      // Keep the connection warm through proxies while long steps run.
      const heartbeat = setInterval(() => {
        if (closed || res.writableEnded) return;
        try {
          res.write(": ping\n\n");
        } catch {
          closed = true;
        }
      }, 15000);

      try {
        const runner = new AgentRunner(ROOT_DIR, emit);
        const result = await runner.run(prompt);
        if (!result.ok) {
          emit({ type: "done", ok: false, at: Date.now() });
        }
      } catch (err) {
        emit({ type: "error", message: "Agent run failed.", at: Date.now() });
        emit({ type: "done", ok: false, at: Date.now() });
      } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) res.end();
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Studio] Agentic Game Studio backend listening on port ${PORT}`);
});
