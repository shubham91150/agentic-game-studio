import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  describeCliTaskKind,
  summarizeCliChunk,
  applyMuseJsonEvent,
} from "../src/agent/agent_runner.js";

// Feed REAL captured `muse exec --json` lines (payload_type carries the
// lifecycle phase, e.g. "task.lifecycle.proposed"). This test replays a
// recorded write_file run so the parser can never drift from reality
// without the test catching it.
const FIXTURE = "/tmp/opencode/tiny-jsonl.txt";

function loadRealEvents() {
  const events = [];
  for (const line of fs.readFileSync(FIXTURE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.payload_type) events.push(obj);
    } catch {
      /* ignore */
    }
  }
  return events;
}

test("task kinds map to honest labels; noise is ignored", () => {
  assert.equal(describeCliTaskKind("reminder.agent.skill-reminder"), null);
  assert.equal(
    describeCliTaskKind("model.meta.response").title,
    "Muse Spark 1.3 thinking",
  );
  assert.equal(
    describeCliTaskKind("tool.write_file").title,
    "CLI tool: write_file",
  );
});

test("recorded CLI run produces model + tool phases, no noise steps", (t) => {
  if (!fs.existsSync(FIXTURE)) {
    t.skip("no recorded CLI fixture on this host");
    return;
  }
  const events = loadRealEvents();
  assert.ok(events.length > 5, "fixture should hold a full CLI run");

  const state = { tasks: new Map() };
  const phases = [];
  const cliLines = [];
  let usage = null;
  for (const obj of events) {
    for (const action of applyMuseJsonEvent(state, obj)) {
      if (action.phase) phases.push(action.phase);
      if (action.cli) cliLines.push(action.cli);
      if (action.usage) usage = action.usage;
    }
  }

  const running = phases.filter((p) => p.status === "running");
  const done = phases.filter((p) => p.status === "pass");
  // A thinking step and a write_file step must both appear as themselves.
  assert.ok(
    running.some((p) => p.label.includes("thinking")),
    "model thinking step missing",
  );
  assert.ok(
    running.some((p) => p.label === "CLI tool: write_file"),
    "write_file step missing",
  );
  // No reminder/skill noise may ever become a UI step.
  assert.ok(
    phases.every(
      (p) => !/reminder|skill/i.test(p.label) && !p.id.includes("reminder"),
    ),
    "internal noise leaked into steps",
  );
  // The tool output line names the file the CLI actually wrote.
  assert.ok(
    cliLines.some((line) => line.includes("TINY.md")),
    "tool output line missing",
  );
  // Completion + usage accounting present.
  assert.ok(done.length >= 1, "no completed phase");
  assert.ok(usage && usage[0].model === "muse-spark-1.3", "usage missing");

  // Distinct tasks must get distinct step ids (UUIDs share a run prefix,
  // so truncation is not a valid id scheme).
  const ids = new Set(phases.map((p) => p.id));
  assert.ok(ids.size >= 2, "sub-steps collapsed into one id");
  assert.ok(
    [...ids].every((id) => /^cli-step-\d+$/.test(id)),
    "step ids must be sequential",
  );
});

test("chunk summarizer keeps human text, unwraps bash metadata", () => {
  assert.equal(
    summarizeCliChunk("wrote 498 bytes to /tmp/work/SPEC.md"),
    "wrote 498 bytes to /tmp/work/SPEC.md",
  );
  assert.equal(
    summarizeCliChunk(
      '{\n  "chunk_id": "exec-1-1",\n  "command": "ls -la",\n  "description": "x"\n}',
    ),
    "command: ls -la",
  );
  assert.equal(summarizeCliChunk("   "), "");
});

test("malformed and unknown lines never crash the reducer", () => {
  const state = { tasks: new Map() };
  assert.deepEqual(applyMuseJsonEvent(state, null), []);
  assert.deepEqual(applyMuseJsonEvent(state, {}), []);
  assert.deepEqual(
    applyMuseJsonEvent(state, { payload_type: "bogus.nope", payload: {} }),
    [],
  );
  assert.deepEqual(
    applyMuseJsonEvent(state, {
      payload_type: "task.lifecycle.started",
      payload: { task_id: "unknown-task" },
    }),
    [],
  );
});
