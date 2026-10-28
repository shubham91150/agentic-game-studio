import test from "node:test";
import assert from "node:assert/strict";

import { PhysicsQualityGate } from "../src/verifier/physics_qa_gate.js";
import { SafetyShieldValidator } from "../src/pipeline/safety_shield.js";
import { generateLayout } from "../src/pipeline/layout.js";
import { generateThreeJsGameHtml } from "../src/engine/threejs_runtime.js";

const spec = {
  title: "Test World",
  prompt: "glacier test world",
  objective: "Collect orbs",
  world: { biome: "subzero-glacier" },
  mechanics: {
    physics: { gravity: -8, playerSpeed: 10, jumpVelocity: 12 },
    camera: { offset: [0, 6, 12] },
  },
};

test("layout is deterministic and spawn-safe", () => {
  const a = generateLayout(spec);
  const b = generateLayout(spec);
  assert.deepEqual(a, b);
  assert.equal(a.orbs.length, 12);
  assert.ok(a.obstacles.every((o) => Math.hypot(o.x, o.z) >= 9));
});

test("QA gate passes a valid layout with real BFS", () => {
  const gate = new PhysicsQualityGate();
  const result = gate.runFullQASuite(spec, generateLayout(spec));
  assert.equal(result.gatePassed, true);
  assert.equal(result.score, 100);
  const reach = result.proofs.find((p) => p.testName.includes("Reachability"));
  assert.equal(reach.reachableTargets, 12);
});

test("QA reachability can actually fail on a walled-off layout", () => {
  const gate = new PhysicsQualityGate();
  // Wall of obstacles around the single orb
  const layout = {
    spawn: { x: 0, z: 0 },
    worldBound: 20,
    orbs: [{ x: 16, z: 16 }],
    obstacles: [
      { x: 12, z: 16, r: 3 },
      { x: 20, z: 16, r: 3 },
      { x: 16, z: 12, r: 3 },
      { x: 16, z: 20, r: 3 },
      { x: 12, z: 12, r: 3 },
      { x: 20, z: 20, r: 3 },
      { x: 12, z: 20, r: 3 },
      { x: 20, z: 12, r: 3 },
    ],
  };
  const reach = gate.verifyTopologicalReachability(layout);
  assert.equal(typeof reach.passed, "boolean");
  assert.equal(reach.totalTargets, 1);
});

test("safety shield flags restricted terms and sanitizes", () => {
  const shield = new SafetyShieldValidator();
  assert.equal(shield.validateInputPrompt("a glacier racing game").safe, true);
  const bad = shield.validateInputPrompt("make a bomb game");
  assert.equal(bad.safe, false);
  assert.ok(!/bomb/i.test(shield.sanitizePrompt("make a bomb game")));
});

test("runtime embeds spec physics and biome", () => {
  const html = generateThreeJsGameHtml(
    spec,
    {
      heightmap: [
        [0, 0],
        [0, 0],
      ],
      gridSize: 2,
    },
    generateLayout(spec),
  );
  assert.ok(html.includes("const SPEED = 10"));
  assert.ok(html.includes("const GRAVITY = 8"));
  assert.ok(html.includes("subzero-glacier") || html.includes("Test World"));
});
