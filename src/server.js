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
import crypto from "node:crypto";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  AgentRunner,
  ALLOWED_CLI_MODELS,
  resolveMetaApiKey,
} from "./agent/agent_runner.js";
import { GameStorageManager } from "./storage/game_store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STORAGE_DIR = path.join(ROOT_DIR, "storage", "games");
const CHATS_DIR = path.join(ROOT_DIR, "storage", "chats");
const execFileAsync = promisify(execFileCb);

const PORT = Number(process.env.STUDIO_PORT || 3030);
const gameStore = new GameStorageManager(STORAGE_DIR);
const TMUX_SESSION = "muse-studio";
let activeTerminalModel = "muse-spark-1.3";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTmuxSession() {
  try {
    execFileSync("tmux", ["has-session", "-t", TMUX_SESSION], {
      stdio: "ignore",
    });
  } catch {
    const museBin = path.join(
      process.env.HOME || "/home/opencode",
      ".local",
      "bin",
      "muse",
    );
    execFileSync("tmux", [
      "new-session",
      "-d",
      "-s",
      TMUX_SESSION,
      "-x",
      "120",
      "-y",
      "32",
      "-c",
      ROOT_DIR,
      `bash -lc 'while true; do ${museBin} --trust-workspace --yolo --model muse-spark-1.3; sleep 1; done'`,
    ]);
    try {
      execFileSync("tmux", ["set-option", "-t", TMUX_SESSION, "status", "off"]);
      execFileSync("tmux", ["set-option", "-t", TMUX_SESSION, "mouse", "on"]);
    } catch {
      /* ignore */
    }
  }
}

async function sendLineToTmux(line) {
  ensureTmuxSession();
  const clean = String(line || "")
    .replace(/\r?\n+/g, " ")
    .trim();
  if (!clean) return;
  execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "-l", clean]);
  await sleep(300);
  execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "C-m"]);
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

function sendFile(res, filePath) {
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    try {
      if (!res.writableEnded) res.end();
      else res.destroy();
    } catch {
      /* ignore */
    }
  });
  stream.pipe(res);
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

  // ---------- Studio static assets (studio.js, tailwind.config.js, app.css, etc.) ----------
  if (
    pathname === "/studio/studio.js" ||
    pathname === "/studio.js" ||
    pathname === "/studio/tailwind.config.js" ||
    pathname === "/studio/app.css"
  ) {
    const fname =
      pathname === "/studio/app.css"
        ? "app.css"
        : pathname === "/studio/tailwind.config.js"
          ? "tailwind.config.js"
          : "studio.js";
    return sendFile(res, path.join(PUBLIC_DIR, fname));
  }

  // ---------- Self-hosted fonts + icons (CSP-safe, no CDN) ----------
  const fontsMatch = pathname.match(
    /^\/studio\/fonts\/([\w.\-]+\.(?:woff2|css))$/,
  );
  if (fontsMatch) {
    const target = path.resolve(PUBLIC_DIR, "fonts", fontsMatch[1]);
    if (!target.startsWith(path.resolve(PUBLIC_DIR, "fonts"))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
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
        plannerModel: "meta-models/muse-spark-open-1026",
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

  // ---------- Composer capabilities (skills, MCPs, models) ----------
  if (pathname === "/api/studio/capabilities" && req.method === "GET") {
    const skills = [];
    for (const dir of [".agents/skills", "skills"]) {
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(ROOT_DIR, dir), {
          withFileTypes: true,
        });
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const id = e.name;
        if (skills.some((s) => s.id === id)) continue;
        let description = "";
        try {
          const md = fs.readFileSync(
            path.join(ROOT_DIR, dir, id, "SKILL.md"),
            "utf8",
          );
          const m = md.match(/^description:\s*(.+)$/m);
          if (m) description = m[1].trim().slice(0, 160);
        } catch {
          description = "";
        }
        skills.push({ id, description });
      }
    }
    let mcpServers = [];
    try {
      const settingsPath = path.join(
        process.env.HOME || "/root",
        ".config",
        "muse",
        "settings.json",
      );
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      mcpServers = Object.keys(settings.mcpServers || {});
    } catch {
      mcpServers = [];
    }
    return json(res, 200, { skills, mcpServers, models: ALLOWED_CLI_MODELS });
  }

  // ---------- MCP server management (Muse Code settings) ----------
  // Reads/writes ~/.config/muse/settings.json mcpServers. Secrets (headers,
  // env) are never returned to the client. A new CLI session picks changes up.
  function mcpSettingsPath() {
    return path.join(
      process.env.HOME || "/root",
      ".config",
      "muse",
      "settings.json",
    );
  }
  function readMcpServers() {
    const raw = fs.readFileSync(mcpSettingsPath(), "utf8");
    const settings = JSON.parse(raw);
    const servers = settings.mcpServers || {};
    return Object.entries(servers).map(([name, cfg]) => ({
      name,
      transport: cfg.transport || "streamable_http",
      url: cfg.url || "",
      command: cfg.command || "",
      enabled: cfg.enabled !== false,
    }));
  }
  if (pathname === "/api/studio/mcp" && req.method === "GET") {
    try {
      return json(res, 200, { servers: readMcpServers() });
    } catch {
      return json(res, 500, { error: "Could not read MCP settings." });
    }
  }
  if (pathname === "/api/studio/mcp" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const name = String(payload.name || "")
        .toLowerCase()
        .trim();
      const url = String(payload.url || "").trim();
      if (!/^[a-z0-9][a-z0-9-_]{1,40}$/.test(name)) {
        return json(res, 400, {
          error: "Name must be 2-41 chars: lowercase, digits, - _.",
        });
      }
      let parsed = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (
        !parsed ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username ||
        parsed.password
      ) {
        return json(res, 400, {
          error: "URL must be plain http(s) without credentials.",
        });
      }
      try {
        const file = mcpSettingsPath();
        const settings = JSON.parse(fs.readFileSync(file, "utf8"));
        if (settings.schema_version !== 1) {
          return json(res, 500, { error: "Unsupported settings schema." });
        }
        if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
          settings.mcpServers = {};
        }
        settings.mcpServers[name] = {
          transport: "streamable_http",
          url: parsed.toString(),
        };
        fs.copyFileSync(file, `${file}.bak`);
        fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
        return json(res, 200, { ok: true, servers: readMcpServers() });
      } catch {
        return json(res, 500, { error: "Could not update MCP settings." });
      }
    });
    return;
  }
  const mcpDel = pathname.match(
    /^\/api\/studio\/mcp\/([a-z0-9][a-z0-9-_]{1,40})$/,
  );
  if (mcpDel && req.method === "DELETE") {
    try {
      const file = mcpSettingsPath();
      const settings = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!settings.mcpServers || !settings.mcpServers[mcpDel[1]]) {
        return json(res, 404, { error: "MCP server not found." });
      }
      delete settings.mcpServers[mcpDel[1]];
      fs.copyFileSync(file, `${file}.bak`);
      fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
      return json(res, 200, { ok: true, servers: readMcpServers() });
    } catch {
      return json(res, 500, { error: "Could not update MCP settings." });
    }
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

  // ---------- Vendor assets (Three.js, Phaser, etc.) ----------
  if (pathname === "/studio/vendor/three.min.js") {
    const vendorPath = path.join(
      ROOT_DIR,
      "src",
      "engine",
      "vendor",
      "three.min.js",
    );
    return sendFile(res, vendorPath);
  }
  if (pathname === "/studio/vendor/phaser.min.js") {
    const vendorPath = path.join(
      ROOT_DIR,
      "src",
      "engine",
      "vendor",
      "phaser.min.js",
    );
    return sendFile(res, vendorPath);
  }

  // ---------- Live CLI preview stage (public/live-preview/*) ----------
  const livePreviewDir = path.join(PUBLIC_DIR, "live-preview");
  if (pathname === "/api/studio/preview-state" && req.method === "GET") {
    const indexPath = path.join(livePreviewDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      return json(res, 200, { ready: false, updatedAt: 0 });
    }
    let updatedAt = 0;
    let title = "Game Preview";
    try {
      for (const f of fs.readdirSync(livePreviewDir)) {
        const st = fs.statSync(path.join(livePreviewDir, f));
        if (st.mtimeMs > updatedAt) updatedAt = Math.floor(st.mtimeMs);
      }
      const html = fs.readFileSync(indexPath, "utf8");
      const m = html.match(/<title>([^<]+)<\/title>/i);
      if (m && m[1].trim()) title = m[1].trim();
    } catch {
      /* ignore */
    }
    return json(res, 200, {
      ready: true,
      updatedAt,
      title,
      url: "/studio/live-preview/index.html",
    });
  }

  const livePreviewMatch = pathname.match(
    /^\/studio\/live-preview\/([\w.\-/]+)$/,
  );
  if (livePreviewMatch) {
    const target = path.resolve(livePreviewDir, livePreviewMatch[1]);
    if (!target.startsWith(path.resolve(livePreviewDir))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Uploaded reference files (/studio/uploads/* or /storage/.uploads/*) ----------
  const uploadServeMatch = pathname.match(
    /^\/(?:studio\/uploads|storage\/\.uploads)\/([\w.\-]+)$/,
  );
  if (uploadServeMatch) {
    const uploadDir = path.join(ROOT_DIR, "storage", ".uploads");
    const target = path.resolve(uploadDir, uploadServeMatch[1]);
    if (!target.startsWith(path.resolve(uploadDir))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Play a stored game (HTML or game.js) ----------
  const playMatch = pathname.match(
    /^\/studio\/games\/([\w-]+)\/(index\.html|game\.js)$/,
  );
  if (playMatch) {
    return sendFile(res, path.join(STORAGE_DIR, playMatch[1], playMatch[2]));
  }

  // ---------- Stored game assets (concept art etc.) ----------
  const assetMatch = pathname.match(
    /^\/studio\/games\/([\w-]+)\/(assets\/[\w.\-]+)$/,
  );
  if (assetMatch) {
    const assetPath = path.join(STORAGE_DIR, assetMatch[1], assetMatch[2]);
    if (!path.resolve(assetPath).startsWith(path.resolve(STORAGE_DIR))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, assetPath);
  }

  // ---------- File upload for prompt attachments (raw bytes) ----------
  // POST /api/studio/upload?name=foo.png with Content-Type:
  // application/octet-stream. Max 10MB. Files land in storage/.uploads
  // and the CLI reads them from its scoped run dir.
  if (pathname === "/api/studio/upload" && req.method === "POST") {
    const rawName = String(url.searchParams.get("name") || "");
    const safeName =
      path
        .basename(rawName)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 100) || "file.bin";
    const uploadDir = path.join(ROOT_DIR, "storage", ".uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const id = crypto.randomBytes(6).toString("hex");
    const dest = path.join(uploadDir, `${id}_${safeName}`);
    const MAX_BYTES = 10 * 1024 * 1024;
    let received = 0;
    let tooBig = false;
    const out = fs.createWriteStream(dest);
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BYTES) {
        tooBig = true;
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        try {
          out.destroy();
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        if (!res.writableEnded) {
          json(res, 413, { error: "File too large (max 10MB)." });
        }
        return;
      }
      out.write(chunk);
    });
    req.on("end", () => {
      if (tooBig || res.writableEnded) return;
      out.end(() => {
        json(res, 200, { id, name: safeName, size: received });
      });
    });
    req.on("error", () => {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      if (!res.writableEnded) json(res, 400, { error: "Upload failed." });
    });
    return;
  }

  // ---------- Send prompt / model switch into live Muse Code CLI terminal ----------
  if (pathname === "/api/studio/terminal/send" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const prompt = String(payload.prompt || "").trim();
      const model =
        typeof payload.model === "string" &&
        ALLOWED_CLI_MODELS.includes(payload.model)
          ? payload.model
          : null;
      const attachments = Array.isArray(payload.attachments)
        ? payload.attachments
            .filter(
              (a) =>
                a && typeof a.id === "string" && /^[0-9a-f]{12,64}$/.test(a.id),
            )
            .map((a) => {
              const dir = path.join(ROOT_DIR, "storage", ".uploads");
              try {
                for (const f of fs.readdirSync(dir)) {
                  if (f.startsWith(`${a.id}_`)) {
                    return `storage/.uploads/${f}`;
                  }
                }
              } catch {
                /* ignore */
              }
              return null;
            })
            .filter(Boolean)
        : [];

      try {
        if (model && model !== activeTerminalModel) {
          await sendLineToTmux(`/model ${model}`);
          activeTerminalModel = model;
          await sleep(400);
        }
        if (prompt) {
          const finalPrompt = attachments.length
            ? `${prompt} (Reference files: ${attachments.join(", ")})`
            : prompt;
          await sendLineToTmux(finalPrompt);
        }
        return json(res, 200, {
          ok: true,
          session: TMUX_SESSION,
          model: activeTerminalModel,
          sent: Boolean(prompt),
        });
      } catch {
        return json(res, 500, {
          ok: false,
          error: "Failed to dispatch prompt to live CLI terminal.",
        });
      }
    });
    return;
  }

  // ---------- Fresh terminal session (new chat) ----------
  // Archive the live pane, kill the session, recreate it fresh exactly
  // like the launcher script. ttyd clients auto-reconnect; no ttyd restart.
  if (pathname === "/api/studio/session/new" && req.method === "POST") {
    // Drain any request body; nothing in it is used or logged.
    req.resume();
    let archived = null;
    let note = null;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `chat_${stamp}.log`;
      fs.mkdirSync(CHATS_DIR, { recursive: true });
      const dest = path.join(CHATS_DIR, fileName);
      try {
        const { stdout } = await execFileAsync(
          "tmux",
          ["capture-pane", "-t", TMUX_SESSION, "-p", "-S", "-"],
          { timeout: 15000 },
        );
        fs.writeFileSync(dest, stdout || "", "utf8");
      } catch {
        note = "previous session missing; nothing to archive";
        fs.writeFileSync(
          dest,
          `No previous tmux session '${TMUX_SESSION}' to archive.\n`,
          "utf8",
        );
      }
      archived = path.join("storage", "chats", fileName);
    } catch {
      return json(res, 500, { ok: false, error: "Could not archive session." });
    }
    try {
      await execFileAsync("tmux", ["kill-session", "-t", TMUX_SESSION], {
        timeout: 15000,
      });
    } catch {
      /* ignore missing session */
    }
    try {
      const museBin = path.join(
        process.env.HOME || "/home/opencode",
        ".local",
        "bin",
        "muse",
      );
      await execFileAsync(
        "tmux",
        [
          "new-session",
          "-d",
          "-s",
          TMUX_SESSION,
          "-x",
          "120",
          "-y",
          "32",
          "-c",
          ROOT_DIR,
          `bash -lc 'while true; do ${museBin} --trust-workspace --yolo --model muse-spark-1.3; sleep 1; done'`,
        ],
        { timeout: 15000 },
      );
      try {
        await execFileAsync(
          "tmux",
          ["set-option", "-t", TMUX_SESSION, "status", "off"],
          {
            timeout: 15000,
          },
        );
        await execFileAsync(
          "tmux",
          ["set-option", "-t", TMUX_SESSION, "mouse", "on"],
          {
            timeout: 15000,
          },
        );
      } catch {
        /* best-effort */
      }
    } catch {
      return json(res, 500, {
        ok: false,
        error: "Could not start a fresh session.",
        archived,
      });
    }
    activeTerminalModel = "muse-spark-1.3";
    return json(res, 200, {
      ok: true,
      archived,
      session: TMUX_SESSION,
      ...(note ? { note } : {}),
    });
  }

  // ---------- Chat history (archived tmux transcripts) ----------
  // GET /api/studio/chats -> newest-first [{id, createdAt, size, preview}]
  if (pathname === "/api/studio/chats" && req.method === "GET") {
    let files = [];
    try {
      fs.mkdirSync(CHATS_DIR, { recursive: true });
      files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith(".log"));
    } catch {
      files = [];
    }
    const list = files
      .map((f) => {
        const abs = path.join(CHATS_DIR, f);
        let stat = null;
        try {
          stat = fs.statSync(abs);
        } catch {
          stat = null;
        }
        if (!stat || !stat.isFile()) return null;
        let preview = "";
        try {
          const text = fs.readFileSync(abs, "utf8");
          preview = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join("\n")
            .slice(0, 300);
        } catch {
          preview = "";
        }
        return {
          id: f,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          preview,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(res, 200, list);
  }

  // GET /api/studio/chats/:id -> {id, content} capped at 200KB.
  // The live terminal is a ttyd iframe (static files cannot render there),
  // so "resume" = view transcript + seed fresh terminal with context.
  const chatMatch = pathname.match(/^\/api\/studio\/chats\/(.+)$/);
  if (chatMatch && req.method === "GET") {
    const raw = chatMatch[1] || "";
    let id = "";
    try {
      id = decodeURIComponent(raw);
    } catch {
      return json(res, 400, { error: "Invalid chat id." });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      return json(res, 400, { error: "Invalid chat id." });
    }
    const dir = path.resolve(CHATS_DIR);
    const target = path.resolve(dir, id);
    if (target !== path.join(dir, id) || !target.startsWith(dir + path.sep)) {
      return json(res, 400, { error: "Invalid chat id." });
    }
    let stat = null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      return json(res, 404, { error: "Chat not found." });
    }
    let content = "";
    try {
      content = fs.readFileSync(target, "utf8");
    } catch {
      return json(res, 500, { error: "Could not read chat transcript." });
    }
    const MAX_BYTES = 200 * 1024;
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
      content = Buffer.from(content, "utf8")
        .slice(0, MAX_BYTES)
        .toString("utf8");
    }
    return json(res, 200, { id, content });
  }

  // ---------- Live agent run (Server-Sent Events) ----------
  if (pathname === "/api/studio/generate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const prompt = String(payload.prompt || "");
      const model =
        typeof payload.model === "string" ? payload.model : undefined;
      const attachments = Array.isArray(payload.attachments)
        ? payload.attachments
            .filter(
              (a) =>
                a && typeof a.id === "string" && /^[0-9a-f]{12,64}$/.test(a.id),
            )
            .map((a) => {
              const dir = path.join(ROOT_DIR, "storage", ".uploads");
              let found = null;
              try {
                for (const f of fs.readdirSync(dir)) {
                  if (f.startsWith(`${a.id}_`)) {
                    found = path.join(dir, f);
                    break;
                  }
                }
              } catch {
                found = null;
              }
              return found
                ? { name: String(a.name || "file"), path: found }
                : null;
            })
            .filter(Boolean)
        : [];

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
        const result = await runner.run(prompt, {
          model,
          attachments,
          skipSubprocessCli: Boolean(payload.skipSubprocessCli),
        });
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
