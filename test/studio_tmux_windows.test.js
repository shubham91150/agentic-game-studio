import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Multi-window tmux architecture: New chat must NEVER kill the session.
// It snapshots the current window and opens a NEW window in the same
// session; Continue switches back to a still-live window.
//
// Runs the REAL server on a scratch port against a SCRATCH tmux session
// (STUDIO_TMUX_SESSION), so the live muse-studio session is untouched.
// Storage writes are snapshotted + restored in after().

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3221;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = `ags-test-${process.pid}`;
const CHATS = path.join(ROOT, "storage", "chats");
const GAMES = path.join(ROOT, "storage", "games");
const LIVE = path.join(ROOT, "public", "live-preview");
const LIVE_BACKUP = path.join(os.tmpdir(), `ags-live-backup-${process.pid}`);

let server = null;
let beforeChats = new Set();
let beforeGames = new Set();
let indexBackup = "[]";
let liveTitle = "";
let realWindowsBefore = [];

function tmux(args) {
  return execFileSync("tmux", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function listWindows(session) {
  try {
    return tmux([
      "list-windows",
      "-t",
      session,
      "-F",
      "#{window_id}|#{window_active}|#{window_name}",
    ])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, active, name] = l.split("|");
        return { id, active: active === "1", name };
      });
  } catch {
    return [];
  }
}

function scratchAlive() {
  try {
    tmux(["has-session", "-t", SCRATCH]);
    return true;
  } catch {
    return false;
  }
}

// Guard: fail (never touch the live session) when isolation is missing.
function assertScratchAlive() {
  assert.equal(
    scratchAlive(),
    true,
    "scratch tmux session missing — server ignored STUDIO_TMUX_SESSION?",
  );
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

async function get(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

before(async () => {
  try {
    tmux(["kill-session", "-t", SCRATCH]);
  } catch {
    /* no leftover */
  }
  realWindowsBefore = listWindows("muse-studio");
  beforeChats = new Set(fs.readdirSync(CHATS));
  beforeGames = new Set(fs.readdirSync(GAMES));
  indexBackup = fs.readFileSync(path.join(GAMES, "index.json"), "utf8");
  const m = fs
    .readFileSync(path.join(LIVE, "index.html"), "utf8")
    .match(/<title>([^<]+)<\/title>/i);
  liveTitle = (m && m[1].trim()) || "Untitled Game";
  fs.rmSync(LIVE_BACKUP, { recursive: true, force: true });
  fs.cpSync(LIVE, LIVE_BACKUP, { recursive: true });
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: SCRATCH,
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (server) {
    try {
      server.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    server = null;
  }
  try {
    tmux(["kill-session", "-t", SCRATCH]);
  } catch {
    /* ignore */
  }
  for (const f of fs.readdirSync(CHATS)) {
    if (!beforeChats.has(f)) fs.rmSync(path.join(CHATS, f));
  }
  for (const f of fs.readdirSync(GAMES)) {
    if (!beforeGames.has(f)) {
      fs.rmSync(path.join(GAMES, f), { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(GAMES, "index.json"), indexBackup);
  fs.rmSync(LIVE, { recursive: true, force: true });
  fs.cpSync(LIVE_BACKUP, LIVE, { recursive: true });
  fs.rmSync(LIVE_BACKUP, { recursive: true, force: true });
});

test("server isolates tmux traffic to STUDIO_TMUX_SESSION", async () => {
  const r = await post("/api/studio/session/new");
  assert.equal(r.status, 200);
  assert.equal(r.json && r.json.ok, true);
  assert.equal(scratchAlive(), true, "scratch session was not created");
  assert.deepEqual(
    listWindows("muse-studio").map((w) => w.id),
    realWindowsBefore.map((w) => w.id),
    "live muse-studio windows must be untouched",
  );
});

test("session/new opens a new window and keeps the old one alive", async () => {
  assertScratchAlive();
  const before = listWindows(SCRATCH);
  const prevActive = before.find((w) => w.active);
  assert.ok(prevActive);
  const r = await post("/api/studio/session/new");
  assert.equal(r.status, 200);
  assert.equal(r.json && r.json.ok, true);
  assert.match(String(r.json.windowId || ""), /^@\d+$/);
  assert.equal(r.json.previousWindowId, prevActive.id);
  const afterWins = listWindows(SCRATCH);
  assert.equal(
    afterWins.length,
    before.length + 1,
    "old window must survive New chat",
  );
  const prev = afterWins.find((w) => w.id === prevActive.id);
  assert.ok(prev, "previous window id still listed");
  assert.equal(prev.active, false);
  const active = afterWins.find((w) => w.active);
  assert.equal(active && active.id, r.json.windowId);
});

test("archived chat links the backgrounded window; live windows listed", async () => {
  assertScratchAlive();
  const wins = listWindows(SCRATCH);
  const fg = wins.find((w) => w.active);
  assert.ok(fg);
  const r = await get("/api/studio/chats");
  assert.equal(r.status, 200);
  const fresh = r.json.filter(
    (c) => !beforeChats.has(c.id) && c.transcript !== false,
  );
  assert.ok(fresh.length >= 2, "one archive per New chat");
  for (const f of fresh) {
    assert.match(String(f.windowId || ""), /^@\d+$/);
    assert.equal(f.live, true);
    assert.equal(f.gameTitle, liveTitle);
    const w = wins.find((x) => x.id === f.windowId);
    assert.ok(w, "archived window still listed");
    assert.equal(w.active, false, "archived window is backgrounded");
  }
  const liveOnly = r.json.find((c) => c.id === `live:${fg.id}`);
  assert.ok(liveOnly, "unarchived live window listed");
  assert.equal(liveOnly.transcript, false);
  assert.equal(liveOnly.live, true);
});

test("chats/:id/continue switches back to the live window + game", async () => {
  assertScratchAlive();
  const r = await get("/api/studio/chats");
  const archived = r.json.find(
    (c) => !beforeChats.has(c.id) && c.transcript !== false,
  );
  assert.ok(archived);
  const c = await post(
    `/api/studio/chats/${encodeURIComponent(archived.id)}/continue`,
  );
  assert.equal(c.status, 200);
  assert.equal(c.json && c.json.switched, true);
  assert.equal(c.json.windowId, archived.windowId);
  const active = listWindows(SCRATCH).find((w) => w.active);
  assert.equal(active && active.id, archived.windowId);
  const st = await get("/api/studio/preview-state");
  assert.equal(st.json && st.json.title, liveTitle);
});

test("continue on a dead window returns switched:false", async () => {
  assertScratchAlive();
  const r = await get("/api/studio/chats");
  const archived = r.json.find(
    (c) => !beforeChats.has(c.id) && c.transcript !== false,
  );
  assert.ok(archived);
  tmux(["kill-window", "-t", `${SCRATCH}:${archived.windowId}`]);
  const c = await post(
    `/api/studio/chats/${encodeURIComponent(archived.id)}/continue`,
  );
  assert.equal(c.status, 200);
  assert.equal(c.json && c.json.switched, false);
});
