import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  judgeAssistantFallback,
  buildAssistantSignature,
  judgeAssistantAllowed,
  AI_ASSISTANT_MODEL_FALLBACK,
} from "../src/server.js";

// Judge AI assistant: deterministic KB fallback + public POST route.
// Live route tests run the REAL server on scratch port 3225 with
// STUDIO_JUDGE_ASSISTANT_OFFLINE=1 (KB only, zero API spend).
// The judge audit file is snapshotted and restored in after().

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3225;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = `ags-ja-${process.pid}`;
const JUDGE_RUNS = path.join(ROOT, "storage", ".judge-runs");
const AUDIT_FILE = path.join(JUDGE_RUNS, "judge_audit.json");

const PILLS = [
  "9-Model Meta Stack Proof",
  "SAM 3.1 & 20-Bone Rig",
  "gVisor 4.19.0 Kernel Sandbox",
  "Verifiable Agent Gates",
  "5 Bonus Prizes Eligibility",
];

let server = null;
let auditBackup = null;
let auditExisted = false;

function tmuxKill() {
  try {
    execFileSync("tmux", ["kill-session", "-t", SCRATCH], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    /* no leftover or no tmux */
  }
}

// Visitor request via the public proxy (forged Host + forwarding
// headers, no cookie): proves the endpoint is truly public.
function visitorPost(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: p,
        method: "POST",
        headers: {
          host: "spurcode.duckdns.org",
          "x-forwarded-for": "203.0.113.9",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "spurcode.duckdns.org",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
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
          resolve({ status: res.statusCode, json: j });
        });
      },
    );
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/studio/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("scratch server never came up");
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  tmuxKill();
  try {
    auditBackup = fs.readFileSync(AUDIT_FILE, "utf8");
    auditExisted = true;
  } catch {
    auditBackup = null;
    auditExisted = false;
  }
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: SCRATCH,
      STUDIO_JUDGE_ASSISTANT_OFFLINE: "1",
      OPENCODE_SESSION_SECRET: "ja-test-only-secret",
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  try {
    if (server) server.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  server = null;
  tmuxKill();
  try {
    if (auditExisted) fs.writeFileSync(AUDIT_FILE, auditBackup);
    else fs.rmSync(AUDIT_FILE, { force: true });
  } catch {
    /* best effort restore */
  }
});

// ---------- Pure fallback unit tests (no server) ----------

test("fallback is deterministic for the same question", () => {
  const a = judgeAssistantFallback("Tell me about the gVisor sandbox");
  const b = judgeAssistantFallback("Tell me about the gVisor sandbox");
  assert.deepEqual(a, b);
  assert.ok(a.answer.length > 50);
  assert.ok(Array.isArray(a.citations) && a.citations.length > 0);
});

test("fallback averages under 5ms", () => {
  const N = 50;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    judgeAssistantFallback("Verifiable Agent Gates and physics BFS?");
  }
  const avg = (performance.now() - t0) / N;
  assert.ok(avg < 5, `avg ${avg.toFixed(3)}ms must be < 5ms`);
});

test("fallback never throws on hostile input", () => {
  for (const bad of [null, undefined, 123, {}, [], ""]) {
    const r = judgeAssistantFallback(bad);
    assert.equal(typeof r.answer, "string");
    assert.ok(r.answer.length > 0);
    assert.ok(Array.isArray(r.citations));
  }
});

test("fallback covers all 5 pill questions with real-file citations", () => {
  for (const pill of PILLS) {
    const r = judgeAssistantFallback(pill);
    assert.ok(
      r.answer.length > 100,
      `pill "${pill}" needs a substantive answer`,
    );
    assert.ok(r.citations.length > 0, `pill "${pill}" needs citations`);
    for (const c of r.citations) {
      const file = String(c).split(":")[0];
      assert.ok(
        fs.existsSync(path.join(ROOT, file)),
        `citation file must exist: ${c}`,
      );
    }
  }
});

test("fallback answers an off-topic question generically", () => {
  const r = judgeAssistantFallback("what is the weather on mars?");
  assert.match(r.answer, /grounded repo-facts base/);
  assert.ok(r.citations.length > 0);
});

test("assistant signature normalizes case and whitespace", () => {
  assert.equal(
    buildAssistantSignature("  Hello   WORLD "),
    buildAssistantSignature("hello world"),
  );
  assert.notEqual(
    buildAssistantSignature("gates"),
    buildAssistantSignature("sandbox"),
  );
});

test("assistant rate limit allows 30 then blocks", () => {
  const ip = `ja-rate-${process.pid}`;
  for (let i = 0; i < 30; i++) {
    assert.equal(judgeAssistantAllowed(ip).allowed, true);
  }
  const verdict = judgeAssistantAllowed(ip);
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.retryAfter >= 1);
});

// ---------- Live route tests (scratch server, OFFLINE=1) ----------

test("route is public: visitor gets 200 with the KB model label", async () => {
  const { status, json } = await visitorPost("/api/studio/judge-assistant", {
    question: "9-Model Meta Stack Proof",
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.model, AI_ASSISTANT_MODEL_FALLBACK);
  assert.ok(json.answer.length > 100);
  assert.ok(Array.isArray(json.citations) && json.citations.length > 0);
  assert.equal(json.cached, false);
});

test("route 400s on empty or missing question", async () => {
  const empty = await visitorPost("/api/studio/judge-assistant", {
    question: "   ",
  });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /question/);
  const missing = await visitorPost("/api/studio/judge-assistant", {});
  assert.equal(missing.status, 400);
});

test("route serves repeats from cache", async () => {
  const q = `cache probe ${process.pid} gates`;
  const first = await visitorPost("/api/studio/judge-assistant", {
    question: q,
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.cached, false);
  const t0 = performance.now();
  const second = await visitorPost("/api/studio/judge-assistant", {
    question: q,
  });
  const ms = performance.now() - t0;
  assert.equal(second.status, 200);
  assert.equal(second.json.cached, true);
  assert.equal(second.json.answer, first.json.answer);
  assert.ok(ms < 1000, `cached repeat took ${ms.toFixed(0)}ms`);
});

test("route appends every question to the judge audit", async () => {
  const marker = `ja-audit-marker-${process.pid}`;
  const { status } = await visitorPost("/api/studio/judge-assistant", {
    question: `Do bonus prizes apply? ${marker}`,
  });
  assert.equal(status, 200);
  const raw = fs.readFileSync(AUDIT_FILE, "utf8");
  const entries = JSON.parse(raw);
  const found = entries.find(
    (e) =>
      e &&
      e.event === "judge_assistant_ask" &&
      String(e.prompt || "").includes(marker),
  );
  assert.ok(found, "audit must contain our judge_assistant_ask entry");
});
