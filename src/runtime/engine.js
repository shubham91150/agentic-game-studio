/**
 * Universal 3D Runtime - Three.js WebGL Engine
 */

export function createSceneConfig(options = {}) {
  return {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    camera: {
      fov: 65,
      near: 0.1,
      far: 1000,
      position: [0, 5, 12],
    },
    lighting: {
      ambient: { color: 0xffffff, intensity: 0.8 },
      directional: { color: 0x00e5ff, intensity: 1.2, position: [10, 20, 10] },
    },
    shadows: true,
  };
}
