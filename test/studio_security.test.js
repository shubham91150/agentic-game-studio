import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Hackathon security hardening: unauthenticated internet visitors (proxied
// via spurcode.duckdns.org, no owner cookie) must not mutate the VM, touch
// the terminal, read chats, or spend API credits — while judges can still
// play library games read-only. Owner = valid opencode_gh_session cookie
// OR direct loopback without proxy headers.
//
// Runs the REAL server on a scratch port with a scratch tmux session.
// Storage + MCP-settings writes are snapshotted and restored in after().

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3222;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = `ags-sec-${process.pid}`;
const SECRET = "sec-test-only-secret";
const CHATS = path.join(ROOT, "storage", "chats");
const GAMES = path.join(ROOT, "storage", "games");
const UPLOADS = path.join(ROOT, "storage", ".uploads");
const LIVE = path.join(ROOT, "public", "live-preview");
const LIVE_BACKUP = path.join(os.tmpdir(), `ags-sec-live-${process.pid}`);
const MCP_FILE = path.join(
  process.env.HOME || "/home/opencode",
  ".config",
  "muse",
  "settings.json",
);
const OWNER_ERR =
  "Owner authentication required. Sign in via GitHub at /terminal/ to control the VM studio.";

let server = null;
let beforeChats = new Set();
let beforeGames = new Set();
let beforeUploads = new Set();
let indexBackup = "[]";
let mcpBackup = null;
let mcpExisted = false;
let gameId = "";
let chatId = "";

function tmux(args) {
  return execFileSync("tmux", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function scratchAlive() {
  try {
    tmux(["has-session", "-t", SCRATCH]);
    return true;
  } catch {
    return false;
  }
}

// Visitor request: arrives via the public proxy (forged Host + forwarding
// headers), optionally with a cookie. Raw http is required because fetch
// forbids overriding the Host header.
function forged(method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {
      host: "spurcode.duckdns.org",
      "x-forwarded-for": "203.0.113.5",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "spurcode.duckdns.org",
    };
    if (cookie) headers.cookie = cookie;
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(data);
    }
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: p, method, headers },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(b || "null");
          } catch {
            j = null;
          }
          resolve({ status: res.statusCode, json: j, text: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function ownerGet(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function ownerPost(p, body) {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function ownerDelete(p) {
  const r = await fetch(BASE + p, { method: "DELETE" });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function mintCookie(payload, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    c.update(JSON.stringify(payload), "utf8"),
    c.final(),
  ]);
  const b64u = (b) => b.toString("base64url");
  return `opencode_gh_session=${b64u(iv)}.${b64u(enc)}.${b64u(c.getAuthTag())}`;
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/studio/health`);
      if (r.ok) return;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("scratch server did not boot");
}

before(async () => {
  try {
    tmux(["kill-session", "-t", SCRATCH]);
  } catch {
    /* no leftover */
  }
  beforeChats = new Set(fs.readdirSync(CHATS));
  beforeGames = new Set(fs.readdirSync(GAMES));
  beforeUploads = new Set(fs.readdirSync(UPLOADS));
  indexBackup = fs.readFileSync(path.join(GAMES, "index.json"), "utf8");
  try {
    mcpBackup = fs.readFileSync(MCP_FILE, "utf8");
    mcpExisted = true;
  } catch {
    mcpBackup = null;
    mcpExisted = false;
  }
  const games = JSON.parse(indexBackup);
  gameId = games[0] && games[0].id;
  assert.ok(gameId, "need at least one library game for tests");
  chatId = [...beforeChats].find((f) => f.endsWith(".log"));
  assert.ok(chatId, "need at least one chat log for tests");
  fs.rmSync(LIVE_BACKUP, { recursive: true, force: true });
  fs.cpSync(LIVE, LIVE_BACKUP, { recursive: true });
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: SCRATCH,
      OPENCODE_SESSION_SECRET: SECRET,
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  // Bulletproof cleanup: every step isolated so one failure can never skip
  // the live-preview restore (a RED-era real activate once stranded the
  // worktree on another game exactly this way).
  const steps = [
    () => {
      if (server) server.kill("SIGKILL");
      server = null;
    },
    () => tmux(["kill-session", "-t", SCRATCH]),
    () => {
      for (const f of fs.readdirSync(CHATS)) {
        if (!beforeChats.has(f)) fs.rmSync(path.join(CHATS, f));
      }
    },
    () => {
      for (const f of fs.readdirSync(GAMES)) {
        if (!beforeGames.has(f)) {
          fs.rmSync(path.join(GAMES, f), { recursive: true, force: true });
        }
      }
      fs.writeFileSync(path.join(GAMES, "index.json"), indexBackup);
    },
    () => {
      for (const f of fs.readdirSync(UPLOADS)) {
        if (!beforeUploads.has(f)) fs.rmSync(path.join(UPLOADS, f));
      }
    },
    () => {
      fs.rmSync(LIVE, { recursive: true, force: true });
      fs.cpSync(LIVE_BACKUP, LIVE, { recursive: true });
      fs.rmSync(LIVE_BACKUP, { recursive: true, force: true });
    },
    () => {
      if (mcpExisted) fs.writeFileSync(MCP_FILE, mcpBackup, "utf8");
      else fs.rmSync(MCP_FILE);
    },
  ];
  for (const s of steps) {
    try {
      s();
    } catch {
      /* keep restoring the rest */
    }
  }
});

function liveSnapshot() {
  const files = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`);
      else files.push(`${rel}${e.name}`);
    }
  };
  walk(LIVE, "");
  files.sort();
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(LIVE, "index.html")))
    .digest("hex");
  return { files, hash };
}

test("visitor terminal/send|stop|scroll → 401, exact error", async () => {
  for (const p of [
    "/api/studio/terminal/send",
    "/api/studio/terminal/stop",
    "/api/studio/terminal/scroll",
  ]) {
    const r = await forged("POST", p, { prompt: "rm -rf /" });
    assert.equal(r.status, 401, p);
    assert.equal(r.json && r.json.error, OWNER_ERR);
  }
});

test("visitor session/new → 401 and touches no tmux session", async () => {
  const r = await forged("POST", "/api/studio/session/new");
  assert.equal(r.status, 401);
  assert.equal(r.json && r.json.error, OWNER_ERR);
  assert.equal(scratchAlive(), false, "no tmux side effect for visitors");
});

test("visitor chats list|detail|continue → 401", async () => {
  const l = await forged("GET", "/api/studio/chats");
  assert.equal(l.status, 401);
  const d = await forged("GET", `/api/studio/chats/${chatId}`);
  assert.equal(d.status, 401);
  const c = await forged("POST", `/api/studio/chats/${chatId}/continue`);
  assert.equal(c.status, 401);
});

test("visitor mcp POST|DELETE → 401 (auth before validation)", async () => {
  const p = await forged("POST", "/api/studio/mcp", {
    name: "evil",
    url: "https://x.example.com/",
  });
  assert.equal(p.status, 401);
  const d = await forged("DELETE", "/api/studio/mcp/nope99");
  assert.equal(d.status, 401, "unknown name must still 401, not 404");
});

test("visitor upload → 401 and writes no file", async () => {
  const r = await forged("POST", "/api/studio/upload?name=x.txt", "hi");
  assert.equal(r.status, 401);
  assert.deepEqual(new Set(fs.readdirSync(UPLOADS)), beforeUploads);
});

test("visitor publish → 401 and library index unchanged", async () => {
  const r = await forged("POST", "/api/studio/publish");
  assert.equal(r.status, 401);
  assert.equal(fs.readFileSync(path.join(GAMES, "index.json"), "utf8"), indexBackup);
});

// Judge Sandbox probe prompt. Its design/image cache fixtures are committed
// (gitignored path, force-added) so every suite run is a cache hit with
// ZERO API calls. The fixture guard below fails fast — no spend — if the
// fixtures ever go missing.
const JUDGE_PROMPT = "Tiny test orb garden for sandbox probe";

function judgePromptHash() {
  return crypto
    .createHash("sha1")
    .update(JUDGE_PROMPT.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function readSandboxStream(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ prompt });
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/api/studio/generate",
        method: "POST",
        headers: {
          host: "spurcode.duckdns.org",
          "x-forwarded-for": "203.0.113.5",
          "x-forwarded-proto": "https",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          const events = [];
          for (const chunk of b.split("\n\n")) {
            for (const line of chunk.split("\n")) {
              const t = line.trim();
              if (t.startsWith("data:")) {
                try {
                  events.push(JSON.parse(t.slice(5).trim()));
                } catch {
                  /* ignore partial */
                }
              }
            }
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: b,
            events,
          });
        });
      },
    );
    r.on("error", reject);
    r.setTimeout(120000, () => r.destroy(new Error("sandbox stream timeout")));
    r.write(data);
    r.end();
  });
}

test("visitor generate → sandboxed SSE build, zero VM writes", async () => {
  const fixture = path.join(
    ROOT,
    "storage",
    "cache",
    `spec_${judgePromptHash()}.json`,
  );
  assert.ok(
    fs.existsSync(fixture),
    "probe cache fixture missing — run the probe build once, never spend blindly",
  );
  const before = liveSnapshot();
  const r = await readSandboxStream(JUDGE_PROMPT);
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"] || ""), /text\/event-stream/);
  assert.ok(
    r.events.some((e) => e.type === "phase" && e.id === "brain"),
    "design phase streamed",
  );
  assert.ok(
    r.text.includes("cache hit"),
    "design served from cache — zero API calls",
  );
  assert.ok(
    !r.events.some((e) => e.type === "cli"),
    "no subprocess CLI steps in sandbox",
  );
  const done = r.events.find((e) => e.type === "done");
  assert.ok(done && done.ok, "build completed");
  assert.match(
    String(done.playUrl || ""),
    /^\/studio\/games\/[\w-]+\/index\.html$/,
  );
  assert.deepEqual(liveSnapshot(), before, "sandbox never writes live-preview");
  const play = await forged("GET", done.playUrl);
  assert.equal(play.status, 200, "saved judge game is playable");
});

test("judge rate limit: 7th build in 10 min → 429", async () => {
  // 1 build already consumed above; burn 5 more (cache hits, fast).
  for (let i = 0; i < 5; i++) {
    const r = await readSandboxStream(JUDGE_PROMPT);
    assert.ok(
      r.events.some((e) => e.type === "done" && e.ok),
      `build ${i + 2} completes`,
    );
  }
  const over = await forged("POST", "/api/studio/generate", {
    prompt: JUDGE_PROMPT,
  });
  assert.equal(over.status, 429);
  assert.match(String(over.json && over.json.error), /limit reached/i);
  assert.ok((over.json && over.json.retryAfter) > 0);
});

test("visitor activate → 200 readOnly play URL, disk untouched", async () => {
  const before = liveSnapshot();
  const r = await forged("POST", `/api/studio/games/${gameId}/activate`);
  assert.equal(r.status, 200);
  assert.equal(r.json && r.json.readOnly, true);
  assert.equal(r.json && r.json.url, `/studio/games/${gameId}/index.html`);
  assert.ok(r.json && r.json.title);
  assert.deepEqual(liveSnapshot(), before, "live-preview must be untouched");
  const play = await forged("GET", `/studio/games/${gameId}/index.html`);
  assert.equal(play.status, 200, "read-only play URL serves the game");
});

test("valid owner cookie over proxy → owner routes work", async () => {
  const cookie = mintCookie(
    { username: "owner", token: "t", exp: Date.now() + 60000 },
    SECRET,
  );
  const r = await forged("GET", "/api/studio/chats", undefined, cookie);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

test("tampered/expired/wrong-secret cookie → 401", async () => {
  const good = mintCookie(
    { username: "owner", token: "t", exp: Date.now() + 60000 },
    SECRET,
  );
  const tampered = good.slice(0, -1) + (good.endsWith("A") ? "B" : "A");
  assert.equal((await forged("GET", "/api/studio/chats", undefined, tampered)).status, 401);
  const expired = mintCookie(
    { username: "owner", token: "t", exp: Date.now() - 1000 },
    SECRET,
  );
  assert.equal((await forged("GET", "/api/studio/chats", undefined, expired)).status, 401);
  const wrong = mintCookie(
    { username: "owner", token: "t", exp: Date.now() + 60000 },
    "wrong-secret",
  );
  assert.equal((await forged("GET", "/api/studio/chats", undefined, wrong)).status, 401);
});

test("direct loopback without proxy headers stays owner", async () => {
  const c = await ownerGet("/api/studio/chats");
  assert.equal(c.status, 200);
  const s = await ownerPost("/api/studio/session/new");
  assert.equal(s.status, 200);
  assert.equal(s.json && s.json.ok, true);
});

test("mcp command allowlist + shell-metachar block (owner)", async () => {
  const bad = await ownerPost("/api/studio/mcp", {
    name: "sectest",
    command: "rm",
    args: [],
  });
  assert.equal(bad.status, 400);
  assert.match(String(bad.json && bad.json.error), /allowlist/i);
  const meta = await ownerPost("/api/studio/mcp", {
    name: "sectest",
    command: "npx",
    args: ["-y", "x; id"],
  });
  assert.equal(meta.status, 400);
  assert.match(String(meta.json && meta.json.error), /shell|metachar/i);
  const both = await ownerPost("/api/studio/mcp", {
    name: "sectest",
    url: "https://x.example.com/mcp",
    command: "npx",
  });
  assert.equal(both.status, 400);
  const ok = await ownerPost("/api/studio/mcp", {
    name: "sectest",
    command: "npx",
    args: ["-y", "pkg", "token=sekret-1"],
  });
  assert.equal(ok.status, 200);
  const g = await ownerGet("/api/studio/mcp");
  const entry = g.json.servers.find((s) => s.name === "sectest");
  assert.ok(entry);
  assert.equal(entry.transport, "stdio");
  assert.ok(
    entry.args.some((a) => a === "[redacted]"),
    "secret-looking arg redacted in GET",
  );
  const del = await ownerDelete("/api/studio/mcp/sectest");
  assert.equal(del.status, 200);
});

test("mcp GET never exposes env/headers secrets", async () => {
  const g = await ownerGet("/api/studio/mcp");
  assert.equal(g.status, 200);
  const raw = JSON.stringify(g.json);
  assert.ok(!/"env"\s*:/.test(raw), "no env key leaked");
  assert.ok(!/"headers"\s*:/.test(raw), "no headers key leaked");
  for (const s of g.json.servers) {
    assert.deepEqual(
      Object.keys(s).sort(),
      ["args", "command", "enabled", "name", "transport", "url"].sort(),
      "only safe fields returned",
    );
  }
});
