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
   * Saves a newly synthesized game to persistent storage
   */
  async saveGame(spec, worldData, gameHtml, unityScripts = []) {
    const gameId =
      "game_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
    const gameDir = path.join(this.baseDir, gameId);
    fs.mkdirSync(gameDir, { recursive: true });

    const manifest = {
      id: gameId,
      title: spec.title || "Agentic 3D World",
      prompt: spec.prompt || "",
      biome: spec.world?.biome || "cyber-orbital",
      metaModel: spec.metaModel || "meta-models/muse-spark-open",
      createdAt: new Date().toISOString(),
      playUrl: `/game/${gameId}`,
      files: {
        html: "index.html",
        manifest: "manifest.json",
        unity: unityScripts,
      },
    };

    // 1. Write manifest & HTML player
    await fs.promises.writeFile(
      path.join(gameDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(gameDir, "index.html"),
      gameHtml,
      "utf8",
    );

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
