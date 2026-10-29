/**
 * Game Architecture Director — model routing:
 *   - High reasoning: Meta Muse Wonder 1.0 (Meta Model API) designs the
 *     structured game: title, biome, physics numbers, objective, assets.
 *   - Open weights: Baseten `meta-models/muse-spark-open-1026` enriches the
 *     focal asset prompts (genuine open-weight usage in every run).
 *   - Fallback: deterministic local heuristics if a provider is down.
 * Every run records which models actually answered in the spec.
 */

import { BasetenMuseClient } from "./baseten_muse.js";
import { MetaWonderClient } from "./meta_wonder.js";

const BIOMES = [
  "cyber-orbital",
  "desert-canyon",
  "subzero-glacier",
  "bioluminescent-canopy",
];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export class MuseWonderDirector {
  constructor() {
    this.wonder = new MetaWonderClient();
    this.baseten = new BasetenMuseClient();
  }

  async architectGame(prompt) {
    if (!prompt || typeof prompt !== "string") {
      throw new Error("Game prompt must be a non-empty string");
    }
    const cleanPrompt = prompt.trim();

    let design = null;
    let architectModel = "local-heuristics";
    let reasoning = "";

    // 1) High-reasoning architect: Muse Wonder.
    try {
      const wonderResult = await this.wonder.designGame(cleanPrompt);
      if (wonderResult.design) {
        design = wonderResult.design;
        architectModel = "muse-wonder-1.0";
        reasoning = wonderResult.text.slice(0, 400);
      }
    } catch {
      design = null;
    }

    // 2) Open-weight enrichment: Baseten Muse Spark Open.
    let enrichmentModel = null;
    let enrichedPrompts = [];
    try {
      const aiResponse = await this.baseten.generateCompletion(
        "You list vivid 3D game asset prompts. Reply with exactly 3 lines, one asset prompt per line, no numbering, no explanation.",
        `Game concept: ${cleanPrompt}\nBiome: ${design?.biome || this.detectBiome(cleanPrompt)}\nList a player avatar, a collectible, and an obstacle asset prompt.`,
        1500,
      );
      const text = aiResponse.content || "";
      enrichedPrompts = text
        .split("\n")
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(
          (line) =>
            line.length > 15 &&
            !/^(we need|user wants|the user|list a|reply|exactly)/i.test(line),
        )
        .slice(-3);
      if (enrichedPrompts.length)
        enrichmentModel = "meta-models/muse-spark-open-1026";
      if (!reasoning) reasoning = text.slice(0, 400);
    } catch {
      enrichedPrompts = [];
    }

    const biome = BIOMES.includes(design?.biome)
      ? design.biome
      : this.detectBiome(cleanPrompt);

    const wonderAssets = Array.isArray(design?.focalAssets)
      ? design.focalAssets
      : [];
    const roles = ["player", "collectible", "obstacle"];
    const focalAssets = roles.map((role, i) => {
      const fromWonder =
        wonderAssets.find((a) => a?.role === role) || wonderAssets[i] || {};
      return {
        id: ["player_avatar", "energy_cell", "pylon_barrier"][i],
        role,
        category: ["character", "prop", "structure"][i],
        prompt:
          enrichedPrompts[i] ||
          fromWonder.prompt ||
          [
            "Futuristic humanoid explorer with kinetic energy core",
            "Luminous crystalline energy orb floating in air",
            "Angular titanium pylon barrier with glowing caution strips",
          ][i],
        scale: [
          [1, 1, 1],
          [0.6, 0.6, 0.6],
          [1.2, 2.5, 1.2],
        ][i],
      };
    });

    const lowerPrompt = cleanPrompt.toLowerCase();
    const heuristicGravity = /low.gravity|low gravity|moon|lunar|floaty/.test(
      lowerPrompt,
    )
      ? -7
      : /heavy gravity|high gravity/.test(lowerPrompt)
        ? -24
        : -16;
    const heuristicSpeed = /speedway|racing|fast|speed/.test(lowerPrompt)
      ? 20
      : 14;
    const heuristicJump = /floaty|low.gravity|low gravity|lunar|moon/.test(
      lowerPrompt,
    )
      ? 13
      : 9.5;

    return {
      title:
        typeof design?.title === "string" && design.title.trim()
          ? design.title.trim().slice(0, 60)
          : this.deriveTitle(cleanPrompt),
      prompt: cleanPrompt,
      objective:
        typeof design?.objective === "string" && design.objective.trim()
          ? design.objective.trim().slice(0, 200)
          : "Collect the energy orbs scattered across the world.",
      metaModel: architectModel,
      architectModel,
      enrichmentModel,
      reasoning: reasoning.slice(0, 400),
      timestamp: new Date().toISOString(),
      world: {
        biome,
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
          gravity: clamp(design?.gravity, -30, -5, heuristicGravity),
          playerSpeed: clamp(design?.playerSpeed, 6, 24, heuristicSpeed),
          jumpVelocity: clamp(design?.jumpVelocity, 6, 16, heuristicJump),
          friction: 0.92,
        },
        controls: {
          desktop: ["KeyW", "KeyA", "KeyS", "KeyD", "Space"],
          mobile: ["VirtualJoystick", "TouchJumpButton"],
        },
      },
      focalAssets,
      targets: { webgl: true, unity: true },
    };
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
    if (
      p.includes("forest") ||
      p.includes("nature") ||
      p.includes("jungle") ||
      p.includes("canopy")
    )
      return "bioluminescent-canopy";
    if (
      p.includes("ice") ||
      p.includes("snow") ||
      p.includes("glacier") ||
      p.includes("lunar") ||
      p.includes("moon") ||
      p.includes("crater")
    )
      return "subzero-glacier";
    return "cyber-orbital";
  }
}
