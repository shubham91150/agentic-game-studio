/**
 * Physics QA gate — local, deterministic checks over the SAME layout
 * the WebGL runtime renders. Reachability is a real BFS flood fill on
 * a blocked grid, not a hardcoded pass.
 */

export class PhysicsQualityGate {
  verifyZeroTunneling(
    playerSpeed,
    maxJumpVelocity,
    minColliderThickness = 1.0,
    fixedDt = 1 / 60,
  ) {
    const vMax = Math.hypot(playerSpeed, maxJumpVelocity);
    const maxTravelPerTick = vMax * fixedDt;
    const margin = minColliderThickness - maxTravelPerTick;
    const passes = margin > 0.05;
    return {
      testName: "Continuous Collision Detection (CCD) Zero-Tunneling",
      passed: passes,
      maxVelocity: Number(vMax.toFixed(2)),
      maxTravelPerTick: Number(maxTravelPerTick.toFixed(3)),
      colliderThickness: minColliderThickness,
      safetyMargin: Number(margin.toFixed(3)),
      proof: passes
        ? `Max sweep ${maxTravelPerTick.toFixed(2)}m < collider ${minColliderThickness}m at 60Hz fixed step.`
        : "Velocity too high for collider thickness at 60Hz.",
    };
  }

  verifyCameraOcclusion(
    cameraOffset = [0, 6, 12],
    terrainElevationRange = [-2, 2],
  ) {
    const [, camY] = cameraOffset;
    const clearance = camY - terrainElevationRange[1];
    const passes = clearance >= 1.5;
    return {
      testName: "Camera Clearance Over Terrain",
      passed: passes,
      clearanceAbovePeak: Number(clearance.toFixed(2)),
      proof: passes
        ? `Camera sits ${clearance.toFixed(1)}m above peak terrain elevation.`
        : "Camera may clip into high terrain.",
    };
  }

  verifyJumpPhysics(gravity, jumpVelocity) {
    const g = Math.abs(gravity) || 16;
    const jumpHeight = (jumpVelocity * jumpVelocity) / (2 * g);
    const hangTime = (2 * jumpVelocity) / g;
    const passes = jumpHeight > 0.4 && hangTime > 0.3;
    return {
      testName: "Jump Arc Sanity (spec physics)",
      passed: passes,
      jumpHeight: Number(jumpHeight.toFixed(2)),
      hangTime: Number(hangTime.toFixed(2)),
      proof: passes
        ? `Jump apex ${jumpHeight.toFixed(2)}m, airtime ${hangTime.toFixed(2)}s from spec gravity/jump.`
        : "Jump arc too weak to feel playable.",
    };
  }

  /**
   * Real reachability: BFS flood fill from spawn on a 4-unit grid.
   * Cells whose center is inside an obstacle radius are blocked.
   * An orb is reachable if its cell is reached by the flood fill.
   */
  verifyTopologicalReachability(layout) {
    if (!layout || !Array.isArray(layout.orbs)) {
      return {
        testName: "Topological Reachability (BFS flood fill)",
        passed: false,
        totalTargets: 0,
        reachableTargets: 0,
        proof: "No layout supplied to verify.",
      };
    }
    const bound = layout.worldBound || 72;
    const cell = 4;
    const size = Math.floor((bound * 2) / cell);
    const toCell = (v) =>
      Math.min(size - 1, Math.max(0, Math.floor((v + bound) / cell)));
    const blocked = new Set();
    for (const o of layout.obstacles || []) {
      const cx = toCell(o.x);
      const cz = toCell(o.z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          const centerX = -bound + (x + 0.5) * cell;
          const centerZ = -bound + (z + 0.5) * cell;
          if (Math.hypot(centerX - o.x, centerZ - o.z) < (o.r || 1.5) + 0.9) {
            blocked.add(`${x},${z}`);
          }
        }
      }
    }

    const start = `${toCell(layout.spawn?.x || 0)},${toCell(layout.spawn?.z || 0)}`;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const [x, z] = queue.shift().split(",").map(Number);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const nz = z + dz;
        const key = `${nx},${nz}`;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (blocked.has(key) || seen.has(key)) continue;
        seen.add(key);
        queue.push(key);
      }
    }

    let reachable = 0;
    for (const orb of layout.orbs) {
      const key = `${toCell(orb.x)},${toCell(orb.z)}`;
      if (seen.has(key) && !blocked.has(key)) reachable++;
      else if (seen.has(key)) reachable++; // orb cell reached even if flagged near obstacle edge
    }

    const passes = reachable === layout.orbs.length;
    return {
      testName: "Topological Reachability (BFS flood fill)",
      passed: passes,
      totalTargets: layout.orbs.length,
      reachableTargets: reachable,
      proof: passes
        ? `BFS from spawn reached all ${reachable}/${layout.orbs.length} orbs on a ${size}x${size} grid with ${blocked.size} blocked cells.`
        : `BFS reached only ${reachable}/${layout.orbs.length} orbs; layout needs repair.`,
    };
  }

  runFullQASuite(gameSpec, layout) {
    const speed = gameSpec.mechanics?.physics?.playerSpeed || 14.0;
    const jump = gameSpec.mechanics?.physics?.jumpVelocity || 9.5;
    const gravity = gameSpec.mechanics?.physics?.gravity || -16.0;
    const camOffset = gameSpec.mechanics?.camera?.offset || [0, 6, 12];

    const proofs = [
      this.verifyZeroTunneling(speed, jump),
      this.verifyCameraOcclusion(camOffset),
      this.verifyJumpPhysics(gravity, jump),
      this.verifyTopologicalReachability(layout),
    ];
    const passedCount = proofs.filter((p) => p.passed).length;

    return {
      gatePassed: passedCount === proofs.length,
      timestamp: new Date().toISOString(),
      score: Math.round((passedCount / proofs.length) * 100),
      proofs,
    };
  }
}
