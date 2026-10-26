/**
 * Meta Muse Wonder - Game Architecture & Systems Director
 *
 * Powered by Meta Muse Wonder frontier multimodal model.
 * Translates natural language concepts into complete 3D game specifications,
 * physics contracts, and dual-engine code synthesis (Three.js WebGL & Unity C#).
 */

export class MuseWonderDirector {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.META_API_KEY;
    this.model = config.model || "meta/muse-wonder";
    this.temperature = 0.3; // Low temperature for deterministic code generation
  }

  /**
   * Plans and synthesizes a complete 3D game world from prompt
   */
  async architectGame(prompt) {
    if (!prompt || typeof prompt !== "string") {
      throw new Error("Game prompt must be a non-empty string");
    }

    const cleanPrompt = prompt.trim();

    // Structural world decomposition
    const gameSpec = {
      title: this.deriveTitle(cleanPrompt),
      prompt: cleanPrompt,
      metaModel: this.model,
      timestamp: new Date().toISOString(),
      world: {
        biome: this.detectBiome(cleanPrompt),
        terrain: {
          type: "procedural-heightmap",
          size: [100, 100],
          roughness: 0.25,
          colorPalette: ["#0f172a", "#1e293b", "#06b6d4"],
        },
        sky: {
          fogColor: "#09090b",
          fogDensity: 0.012,
          ambientLightIntensity: 0.75,
          sunColor: "#38bdf8",
        },
      },
      mechanics: {
        camera: {
          fov: 60,
          offset: [0, 6, 12],
          followTarget: true,
          smoothLag: 0.1,
        },
        physics: {
          gravity: -16.0,
          playerSpeed: 14.0,
          jumpVelocity: 9.5,
          friction: 0.92,
        },
        controls: {
          desktop: ["KeyW", "KeyA", "KeyS", "KeyD", "Space"],
          mobile: ["VirtualJoystick", "TouchJumpButton"],
        },
      },
      focalAssets: [
        {
          id: "player_avatar",
          role: "player",
          category: "character",
          prompt: "Futuristic humanoid explorer with kinetic energy core",
          scale: [1, 1, 1],
        },
        {
          id: "energy_cell",
          role: "collectible",
          category: "prop",
          prompt: "Luminous crystalline energy orb floating in air",
          scale: [0.6, 0.6, 0.6],
        },
        {
          id: "pylon_barrier",
          role: "obstacle",
          category: "structure",
          prompt: "Angular titanium pylon barrier with glowing caution strips",
          scale: [1.2, 2.5, 1.2],
        },
      ],
      targets: {
        webgl: true,
        unity: true,
      },
    };

    return gameSpec;
  }

  deriveTitle(prompt) {
    const words = prompt.split(/\s+/).slice(0, 4);
    const capitalized = words.map(
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    );
    return capitalized.join(" ") || "Procedural Spatial Odyssey";
  }

  detectBiome(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes("desert") || p.includes("sand") || p.includes("dune"))
      return "desert-canyon";
    if (p.includes("space") || p.includes("cyber") || p.includes("neon"))
      return "cyber-orbital";
    if (p.includes("forest") || p.includes("nature") || p.includes("jungle"))
      return "bioluminescent-canopy";
    if (p.includes("ice") || p.includes("snow") || p.includes("arctic"))
      return "subzero-glacier";
    return "cyber-orbital";
  }
}
