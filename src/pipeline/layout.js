/**
 * Deterministic world layout — single source of truth shared by the
 * WebGL runtime (renders it) and the QA gate (proves it reachable).
 * Seeded from the prompt so the same prompt always builds the same world.
 */

function hashSeed(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateLayout(spec) {
  let state = hashSeed(spec?.prompt || spec?.title || "world") + 12345;
  const rand = () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const obstacles = [];
  while (obstacles.length < 14) {
    const x = Math.round((rand() - 0.5) * 1300) / 10;
    const z = Math.round((rand() - 0.5) * 1300) / 10;
    if (Math.hypot(x, z) < 9) continue; // spawn safe zone
    obstacles.push({ x, z, r: 1.5 });
  }

  const orbs = [];
  while (orbs.length < 12) {
    const x = Math.round((rand() - 0.5) * 1200) / 10;
    const z = Math.round((rand() - 0.5) * 1200) / 10;
    if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1.2))
      continue;
    orbs.push({ x, z });
  }

  return { spawn: { x: 0, z: 0 }, obstacles, orbs, worldBound: 72 };
}
