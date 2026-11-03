import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseGitStatus,
  formatCommit,
  slugifyGitRepoName,
} from "../src/server.js";

// Studio Git & GitHub routes: pure-helper unit cases + live HTTP checks on a
// scratch server (port 3224). Sync/export owner-only; status public.
// Never commits or pushes: the live tests only hit read-only status and the
// 401 owner-guard path (no owner cookie, forged proxy headers).

const REPO = "https://github.com/shubham91150/agentic-game-studio";

// ---------- parseGitStatus unit cases ----------

test("parseGitStatus: empty/blank input -> []", () => {
  assert.deepEqual(parseGitStatus(""), []);
  assert.deepEqual(parseGitStatus("   \n  \n"), []);
  assert.deepEqual(parseGitStatus(null), []);
  assert.deepEqual(parseGitStatus(undefined), []);
});

test("parseGitStatus: modified + untracked + added + deleted", () => {
  const out = parseGitStatus(
    " M src/server.js\n?? test/new.test.js\nA  src/added.js\n D src/gone.js\n",
  );
  assert.deepEqual(out, [
    { status: "M", path: "src/server.js" },
    { status: "??", path: "test/new.test.js" },
    { status: "A", path: "src/added.js" },
    { status: "D", path: "src/gone.js" },
  ]);
});

test("parseGitStatus: staged-modified and rename lines", () => {
  const out = parseGitStatus("MM both.js\nR  old.js -> new.js\n");
  assert.deepEqual(out, [
    { status: "MM", path: "both.js" },
    { status: "R", path: "old.js -> new.js" },
  ]);
});

test("parseGitStatus: skips blank lines, never throws on junk", () => {
  const out = parseGitStatus("\n M a.js\n\n   \n");
  assert.deepEqual(out, [{ status: "M", path: "a.js" }]);
  assert.deepEqual(parseGitStatus(42), []);
});

// ---------- formatCommit unit cases ----------

test("formatCommit: parses sha|short|msg|author|date + commit URL", () => {
  const c = formatCommit(
    "abc123def456|abc123d|Add racing game|Jane Doe|2026-11-03 10:00:00 +0000",
  );
  assert.equal(c.sha, "abc123def456");
  assert.equal(c.shortSha, "abc123d");
  assert.equal(c.message, "Add racing game");
  assert.equal(c.author, "Jane Doe");
  assert.equal(c.date, "2026-11-03 10:00:00 +0000");
  assert.equal(c.url, `${REPO}/commit/abc123def456`);
});

test("formatCommit: message containing pipes survives", () => {
  const c = formatCommit("aaa|bbb|fix: a | b|Ann|2026-01-01");
  assert.equal(c.message, "fix: a | b");
  assert.equal(c.author, "Ann");
  assert.equal(c.date, "2026-01-01");
  assert.equal(c.url, `${REPO}/commit/aaa`);
});

// ---------- slugify unit cases ----------

test("slugifyGitRepoName: lowercase, dashes, [a-z0-9-] only", () => {
  assert.equal(slugifyGitRepoName("My Cool Game!"), "my-cool-game");
  assert.equal(slugifyGitRepoName("  Turbo_Racer 2.0 "), "turbo-racer-2-0");
  assert.equal(slugifyGitRepoName("already-slug-9"), "already-slug-9");
  assert.equal(slugifyGitRepoName("!!!"), "");
  assert.equal(slugifyGitRepoName(""), "");
  assert.equal(slugifyGitRepoName(null), "");
});

// ---------- live HTTP: scratch server on port 3224 ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3224;
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;

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
  throw new Error("scratch git-test server did not boot");
}

// Visitor request via the public proxy (forged Host + forwarding headers),
// mirroring the studio_security forged() pattern. Raw http required (fetch
// forbids overriding Host).
function forged(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {
      host: "spurcode.duckdns.org",
      "x-forwarded-for": "203.0.113.5",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "spurcode.duckdns.org",
    };
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

before(async () => {
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: `ags-git-${process.pid}`,
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (server) server.kill("SIGKILL");
  server = null;
});

test("GET /api/studio/git/status is PUBLIC (200 for forged visitor)", async () => {
  const r = await forged("GET", "/api/studio/git/status");
  assert.equal(r.status, 200);
  assert.ok(r.json, "expected JSON body");
  assert.equal(r.json.ok, true);
  assert.equal(r.json.repoUrl, REPO);
  assert.equal(typeof r.json.branch, "string");
  assert.ok(r.json.head && typeof r.json.head === "object");
  for (const k of ["sha", "shortSha", "message", "author", "date"]) {
    assert.equal(
      typeof r.json.head[k],
      "string",
      `head.${k} should be a string`,
    );
  }
  assert.equal(typeof r.json.dirtyCount, "number");
  assert.ok(Array.isArray(r.json.changedFiles));
  assert.equal(r.json.dirtyCount, r.json.changedFiles.length);
  assert.ok(Array.isArray(r.json.commits));
  assert.ok(r.json.commits.length > 0, "expected at least one commit");
  const c0 = r.json.commits[0];
  for (const k of ["sha", "shortSha", "message", "author", "date", "url"]) {
    assert.equal(typeof c0[k], "string", `commits[0].${k} string`);
  }
  assert.equal(c0.url, `${REPO}/commit/${c0.sha}`);
});

test("POST /api/studio/git/sync REQUIRES owner (forged -> 401)", async () => {
  const r = await forged("POST", "/api/studio/git/sync", { message: "x" });
  assert.equal(r.status, 401);
});

test("POST /api/studio/git/export-game REQUIRES owner (forged -> 401)", async () => {
  const r = await forged("POST", "/api/studio/git/export-game", {
    repoName: "evil-game",
  });
  assert.equal(r.status, 401);
});
