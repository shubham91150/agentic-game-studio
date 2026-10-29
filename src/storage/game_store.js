/**
 * Game Storage & Persistence Engine
 *
 * Manages persistent storage of generated games on disk with metadata indexing.
 * Eliminates external DB overhead while preserving instant zero-latency retrieval.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class GameStorageManager {
  constructor(baseDir) {
    this.baseDir = baseDir || path.resolve(process.cwd(), "storage", "games");
    this.indexFile = path.join(this.baseDir, "index.json");
    this.ensureInitialized();
  }

  ensureInitialized() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.indexFile)) {
      fs.writeFileSync(this.indexFile, JSON.stringify([], null, 2), "utf8");
    }
  }

  /**
   * Saves a newly synthesized game to persistent storage.
   * @param {string} [unityControllerCode] - when given (e.g. written by the
   *   Muse Code CLI), stored verbatim instead of copying from build/unity.
   */
  async saveGame(
    spec,
    worldData,
    gameHtml,
    unityScripts = [],
    unityControllerCode,
    conceptImage,
    gameJs,
  ) {
    const gameId =
      "game_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
    const gameDir = path.join(this.baseDir, gameId);
    fs.mkdirSync(gameDir, { recursive: true });

    const manifest = {
      id: gameId,
      title: spec.title || "Agentic 3D World",
      prompt: spec.prompt || "",
      biome: spec.world?.biome || "cyber-orbital",
      metaModel: spec.architectModel || spec.metaModel || "muse-wonder-1.0",
      enrichmentModel: spec.enrichmentModel || null,
      objective: spec.objective || "",
      createdAt: new Date().toISOString(),
      playUrl: `/studio/games/${gameId}/index.html`,
      imageUrl: conceptImage
        ? `/studio/games/${gameId}/assets/concept.webp`
        : null,
      files: {
        html: "index.html",
        manifest: "manifest.json",
        unity: unityScripts,
      },
    };

    // 1. Write manifest & HTML player
    await fs.promises.writeFile(
      path.join(gameDir, "index.html"),
      gameHtml,
      "utf8",
    );
    if (gameJs) {
      await fs.promises.writeFile(
        path.join(gameDir, "game.js"),
        gameJs,
        "utf8",
      );
      manifest.files.js = "game.js";
    }
    await fs.promises.writeFile(
      path.join(gameDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    // 1b. Concept art (Muse Image) under assets/
    if (conceptImage) {
      const assetsDir = path.join(gameDir, "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(assetsDir, "concept.webp"),
        conceptImage,
      );
    }

    // 2. Write Unity Scripts
    if (unityScripts && unityScripts.length > 0) {
      const unityDir = path.join(gameDir, "unity");
      fs.mkdirSync(unityDir, { recursive: true });
      const sourceDir = path.resolve(
        process.cwd(),
        "build",
        "unity",
        "Assets",
        "Scripts",
      );
      for (const name of unityScripts) {
        if (name === "AgenticPlayerController.cs" && unityControllerCode) {
          await fs.promises.writeFile(
            path.join(unityDir, name),
            unityControllerCode,
            "utf8",
          );
          continue;
        }
        const from = path.join(sourceDir, name);
        if (fs.existsSync(from)) {
          fs.copyFileSync(from, path.join(unityDir, name));
        }
      }
    }

    // 3. Update central registry index
    const index = await this.listGames();
    index.unshift(manifest);
    await fs.promises.writeFile(
      this.indexFile,
      JSON.stringify(index, null, 2),
      "utf8",
    );

    return manifest;
  }

  /**
   * Returns all stored games sorted by newest first
   */
  async listGames() {
    this.ensureInitialized();
    try {
      const data = await fs.promises.readFile(this.indexFile, "utf8");
      return JSON.parse(data || "[]");
    } catch {
      return [];
    }
  }

  /**
   * Retrieves a specific game by ID
   */
  async getGame(gameId) {
    const gameDir = path.join(this.baseDir, gameId);
    const manifestPath = path.join(gameDir, "manifest.json");
    const htmlPath = path.join(gameDir, "index.html");

    if (!fs.existsSync(manifestPath)) return null;

    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, "utf8"),
    );
    const html = fs.existsSync(htmlPath)
      ? await fs.promises.readFile(htmlPath, "utf8")
      : "";

    return { manifest, html };
  }
}
