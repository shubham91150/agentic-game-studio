import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JUDGE_TOKEN,
  judgeGenerateAllowed,
  judgePromptCacheHit,
  judgeTokenValid,
} from "../src/server.js";

// Judge verification token + prompt-cache gate (pure functions).
// (Importing server.js must NOT bind :3030 — same guard as enrich tests.)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHED_PROMPT = "Tiny test orb garden for sandbox probe";

function cacheFixturePath(prompt) {
  const h = crypto
    .createHash("sha1")
    .update(prompt.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return path.join(ROOT, "storage", "cache", `spec_${h}.json`);
}

test("JUDGE_TOKEN matches env-or-default, never empty", () => {
  assert.equal(
    JUDGE_TOKEN,
    process.env.STUDIO_JUDGE_TOKEN || "meta-judge-2026",
  );
  assert.ok(JUDGE_TOKEN.length > 0);
});

test("judgePromptCacheHit: fixture hits, random/empty miss", () => {
  assert.ok(
    fs.existsSync(cacheFixturePath(CACHED_PROMPT)),
    "probe cache fixture must be committed",
  );
  assert.equal(judgePromptCacheHit(CACHED_PROMPT), true);
  assert.equal(
    judgePromptCacheHit(`  ${CACHED_PROMPT.toUpperCase()}  `),
    true,
    "trim+lowercase matches the pipeline cache key",
  );
  assert.equal(
    judgePromptCacheHit(`no-such-prompt-${Date.now()}-${Math.random()}`),
    false,
  );
  assert.equal(judgePromptCacheHit(""), false);
  assert.equal(judgePromptCacheHit(undefined), false);
});

test("judgeTokenValid: header OR body token, nothing else", () => {
  assert.equal(
    judgeTokenValid({ headers: { "x-judge-token": JUDGE_TOKEN } }, {}),
    true,
  );
  assert.equal(
    judgeTokenValid({ headers: {} }, { judgeToken: JUDGE_TOKEN }),
    true,
  );
  assert.equal(judgeTokenValid({ headers: {} }, {}), false);
  assert.equal(
    judgeTokenValid({ headers: { "x-judge-token": "wrong" } }, {}),
    false,
  );
  assert.equal(
    judgeTokenValid({ headers: {} }, { judgeToken: "wrong" }),
    false,
  );
  assert.equal(judgeTokenValid(null, null), false);
});

test("judgeGenerateAllowed: token opens uncached, cache opens tokenless", () => {
  const uncached = `uncached-${Date.now()}-${Math.random()}-probe-meadow`;
  assert.deepEqual(
    judgeGenerateAllowed(
      { headers: { "x-judge-token": JUDGE_TOKEN } },
      {},
      uncached,
    ),
    { allowed: true, via: "judge-token" },
  );
  assert.deepEqual(
    judgeGenerateAllowed({ headers: {} }, { judgeToken: JUDGE_TOKEN }, uncached),
    { allowed: true, via: "judge-token" },
  );
  assert.deepEqual(
    judgeGenerateAllowed({ headers: {} }, {}, CACHED_PROMPT),
    { allowed: true, via: "cache-hit" },
  );
  assert.deepEqual(
    judgeGenerateAllowed({ headers: {} }, {}, uncached),
    { allowed: false, via: "none" },
  );
  assert.deepEqual(
    judgeGenerateAllowed(
      { headers: { "x-judge-token": "nope" } },
      {},
      uncached,
    ),
    { allowed: false, via: "none" },
  );
});
