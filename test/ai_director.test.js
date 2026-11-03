import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildDirectorSignature,
  heuristicDirector,
  clampDirector,
  AI_DIRECTOR_MODEL_FALLBACK,
} from "../src/server.js";

// AI Director unit + route tests. The scratch server runs with
// STUDIO_AI_DIRECTOR_OFFLINE=1 so every miss deterministically resolves to
// the heuristic fallback (no Baseten credits, no network flakes).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3223;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = `ags-dir-${process.pid}`;

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
  throw new Error("scratch server did not boot");
}

function postDirector(body, ip) {
  return fetch(`${BASE}/api/studio/ai/director`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: SCRATCH,
      STUDIO_AI_DIRECTOR_OFFLINE: "1",
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (server) server.kill("SIGKILL");
  server = null;
});

const TELEMETRY = {
  room: "Classroom B",
  noise: 34,
  torchOn: true,
  crouch: false,
  hasKey: false,
  enemyState: "PATROL",
  dist: 9.5,
  survivalSec: 120,
};

test("signature is stable for identical states", () => {
  const a = buildDirectorSignature(TELEMETRY);
  const b = buildDirectorSignature({ ...TELEMETRY });
  assert.equal(a, b);
  assert.equal(a, "Classroom B|PATROL|0|1|4|3");
});

test("signature buckets near-identical dist/noise, splits on key fields", () => {
  const base = buildDirectorSignature(TELEMETRY);
  // Same buckets: dist 9.5 vs 9.9 (bucket 4), noise 34 vs 39 (bucket 3).
  assert.equal(
    buildDirectorSignature({ ...TELEMETRY, dist: 9.9, noise: 39 }),
    base,
  );
  // Different buckets / fields split the signature.
  assert.notEqual(
    buildDirectorSignature({ ...TELEMETRY, dist: 12.0 }),
    base,
  );
  assert.notEqual(
    buildDirectorSignature({ ...TELEMETRY, room: "Chapel" }),
    base,
  );
  assert.notEqual(
    buildDirectorSignature({ ...TELEMETRY, hasKey: true }),
    base,
  );
  assert.notEqual(
    buildDirectorSignature({ ...TELEMETRY, enemyState: "CHASE" }),
    base,
  );
});

test("heuristic fallback is deterministic and <5ms", () => {
  const first = heuristicDirector(TELEMETRY);
  const start = Date.now();
  const second = heuristicDirector({ ...TELEMETRY });
  const elapsed = Date.now() - start;
  assert.deepEqual(second, first);
  assert.ok(elapsed < 5, `fallback took ${elapsed}ms, want <5ms`);
});

test("heuristic fallback rules pick tactic + envEvent", () => {
  const key = heuristicDirector({ ...TELEMETRY, hasKey: true });
  assert.equal(key.tactic, "cut_off_chapel");
  assert.equal(key.envEvent, "chapel_omen");
  assert.equal(key.targetRoom, "Chapel");

  const ambush = heuristicDirector({
    ...TELEMETRY,
    torchOn: true,
    dist: 4,
  });
  assert.equal(ambush.tactic, "ambush_room");
  assert.equal(ambush.envEvent, "lantern_blackout");

  const hideout = heuristicDirector({
    ...TELEMETRY,
    torchOn: false,
    crouch: true,
    dist: 7,
  });
  assert.equal(hideout.tactic, "inspect_hideout");
  assert.equal(hideout.envEvent, "ash_vortex");

  const stalk = heuristicDirector({
    ...TELEMETRY,
    torchOn: false,
    crouch: false,
    dist: 30,
  });
  assert.equal(stalk.tactic, "stalk_shadow");
  assert.equal(stalk.envEvent, "storm_surge");

  // Whispers reference the exact room.
  for (const d of [key, ambush, hideout, stalk]) {
    assert.ok(
      d.whisper.includes("Classroom B") || d.whisper.includes("Chapel"),
      `whisper missing room: ${d.whisper}`,
    );
  }
});

test("clampDirector clamps numbers and validates enums", () => {
  const d = clampDirector({
    tactic: "teleport_behind_you",
    targetRoom: "",
    alertBoost: 999,
    whisper: "",
    envEvent: "meteor_strike",
    fogDensity: 9.9,
    lightDim: -3,
    ashTurbulence: 100,
  });
  assert.equal(d.tactic, "stalk_shadow");
  assert.equal(d.envEvent, "storm_surge");
  assert.equal(d.alertBoost, 25);
  assert.equal(d.fogDensity, 0.065);
  assert.equal(d.lightDim, 0.25);
  assert.equal(d.ashTurbulence, 2.8);
  assert.ok(d.targetRoom.length > 0);
  assert.ok(d.whisper.length > 0);

  const lo = clampDirector({
    alertBoost: -5,
    fogDensity: 0,
    lightDim: 99,
    ashTurbulence: -1,
  });
  assert.equal(lo.alertBoost, 0);
  assert.equal(lo.fogDensity, 0.038);
  assert.equal(lo.lightDim, 1.0);
  assert.equal(lo.ashTurbulence, 1.0);
});

test("POST /api/studio/ai/director is public and returns fallback decision", async () => {
  const r = await postDirector({ ...TELEMETRY, room: "Library" }, "10.9.0.1");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.model, AI_DIRECTOR_MODEL_FALLBACK);
  assert.equal(body.cached, false);
  assert.equal(body.tactic, "stalk_shadow");
  assert.equal(body.targetRoom, "Library");
  assert.ok(body.whisper.includes("Library"));
  assert.ok(body.alertBoost >= 0 && body.alertBoost <= 25);
  assert.ok(body.fogDensity >= 0.038 && body.fogDensity <= 0.065);
  assert.ok(body.lightDim >= 0.25 && body.lightDim <= 1.0);
  assert.ok(body.ashTurbulence >= 1.0 && body.ashTurbulence <= 2.8);
});

test("repeat state returns cached:true with no model call, fast", async () => {
  const ip = "10.9.0.2";
  const first = await postDirector({ ...TELEMETRY, room: "Gym" }, ip);
  const firstBody = await first.json();
  assert.equal(firstBody.cached, false);
  assert.equal(firstBody.model, AI_DIRECTOR_MODEL_FALLBACK);

  const start = Date.now();
  const second = await postDirector({ ...TELEMETRY, room: "Gym" }, ip);
  const elapsed = Date.now() - start;
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.cached, true);
  assert.equal(secondBody.model, AI_DIRECTOR_MODEL_FALLBACK);
  assert.equal(secondBody.tactic, firstBody.tactic);
  assert.equal(secondBody.whisper, firstBody.whisper);
  // Cache hit serves locally with no outbound fetch: must be near-instant.
  assert.ok(elapsed < 500, `cached hit took ${elapsed}ms`);
});

test("rate limit: 30th request passes, 31st is 429 with retryAfter", async () => {
  const ip = "10.9.0.3";
  for (let i = 0; i < 30; i++) {
    const r = await postDirector({ ...TELEMETRY, room: `Room${i}` }, ip);
    assert.equal(r.status, 200, `request ${i + 1} should pass`);
    await r.json();
  }
  const limited = await postDirector(TELEMETRY, ip);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  const body = await limited.json();
  assert.ok(typeof body.retryAfter === "number" && body.retryAfter >= 1);
});
