import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGvisorDockerArgs,
  mapRunDirToHost,
  shouldUseGvisor,
  GVISOR_IMAGE,
  GVISOR_CLI_BIN,
} from "../src/agent/agent_runner.js";

// Google gVisor (runsc) agent sandbox wiring: pure arg/path/trigger checks
// (zero docker, zero API spend) + one health-flag integration check.
// Real in-sandbox CLI execution is proven by a manual live judge build
// (see run report) — running it per-suite would spend API credits.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("runDir maps from container path to docker-host path", () => {
  assert.equal(
    mapRunDirToHost("/home/opencode/project-data/storage/.work/run_1"),
    "/data/opencode/storage/.work/run_1",
  );
  assert.equal(mapRunDirToHost("/tmp/x"), "/tmp/x");
});

test("gVisor docker args lock down the sandbox exactly", () => {
  const args = buildGvisorDockerArgs("/data/opencode/storage/.work/run_1", [
    "exec",
    "task",
  ]);
  const has = (...seq) =>
    args.some((_, i) => seq.every((s, j) => args[i + j] === s));
  assert.equal(args[0], "run");
  assert.ok(args.includes("--rm"));
  assert.ok(args.includes("-i"));
  assert.ok(args.includes("--runtime=runsc"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges"));
  assert.ok(args.includes("--pids-limit=256"));
  assert.ok(args.includes("--memory=3g"));
  assert.ok(args.includes("--cpus=2"));
  assert.ok(has("--tmpfs", "/tmp:rw,exec,size=512m"));
  assert.ok(has("--tmpfs", "/home/opencode:rw,exec,size=128m"));
  assert.ok(has("-e", "HOME=/home/opencode"));
  assert.ok(has("-e", "MUSE_NO_MODIFY_PATH=1"));
  assert.ok(has("-v", "/data/opencode/.gvisor-sandbox/bin:/sandbox-bin:ro"));
  assert.ok(
    has(
      "-v",
      "/data/opencode/workspace/users/shubham91150/agentic-game-studio/src:/studio/src:ro",
    ),
  );
  assert.ok(
    has(
      "-v",
      "/data/opencode/workspace/users/shubham91150/agentic-game-studio/.agents:/workspace/.agents:ro",
    ),
  );
  assert.ok(
    has(
      "-v",
      "/data/opencode/workspace/users/shubham91150/agentic-game-studio/public/assets:/studio/public/assets:ro",
    ),
  );
  assert.ok(
    has("-v", "/data/opencode/storage/.work/run_1:/workspace:rw"),
    "exactly one rw mount: the run dir",
  );
  assert.ok(has("-w", "/workspace"));
  const imgAt = args.indexOf(GVISOR_IMAGE);
  assert.equal(GVISOR_IMAGE, "vm-opencode");
  assert.equal(GVISOR_CLI_BIN, "/sandbox-bin/muse-bin-1.4.14-R7309.1");
  assert.deepEqual(args.slice(imgAt), [
    "vm-opencode",
    "/sandbox-bin/muse-bin-1.4.14-R7309.1",
    "exec",
    "task",
  ]);
  // No shell, no sh -c wrapping, no privileged flags anywhere.
  assert.ok(!args.some((a) => /sh\b|bash|privileged|cap-add|network=host/.test(a)));
});

test("gVisor triggers on explicit flag or MUSE_GVISOR_SANDBOX=1", () => {
  const prev = process.env.MUSE_GVISOR_SANDBOX;
  try {
    delete process.env.MUSE_GVISOR_SANDBOX;
    assert.equal(shouldUseGvisor(true), true);
    assert.equal(shouldUseGvisor(false), false);
    assert.equal(shouldUseGvisor(undefined), false);
    process.env.MUSE_GVISOR_SANDBOX = "1";
    assert.equal(shouldUseGvisor(false), true);
    assert.equal(shouldUseGvisor(undefined), true);
    process.env.MUSE_GVISOR_SANDBOX = "0";
    assert.equal(shouldUseGvisor(undefined), false);
  } finally {
    if (prev === undefined) delete process.env.MUSE_GVISOR_SANDBOX;
    else process.env.MUSE_GVISOR_SANDBOX = prev;
  }
});

const HEALTH_PORT = 3223;
let healthServer = null;

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(
        `http://127.0.0.1:${HEALTH_PORT}/api/studio/health`,
      );
      if (r.ok) return r.json();
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("scratch server did not boot");
}

before(async () => {
  healthServer = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(HEALTH_PORT),
      STUDIO_TMUX_SESSION: `ags-gv-${process.pid}`,
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (healthServer) {
    try {
      healthServer.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    healthServer = null;
  }
});

test("health reports gvisorSandbox flag", async () => {
  const r = await fetch(`http://127.0.0.1:${HEALTH_PORT}/api/studio/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.components.gvisorSandbox, true);
});
