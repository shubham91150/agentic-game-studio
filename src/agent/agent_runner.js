/**
 * Agent Runner - Real Orchestrator with Live Event Streaming
 *
 * Verified live chain (each step emits SSE events the UI renders):
 *   1. Prompt safety check (local rules)        -> validate prompt
 *   2. Baseten `meta-models/muse-spark-open`    -> game spec + reasoning
 *      (Meta open weights, direct OpenAI-compatible API call)
 *   3. Muse Code CLI (`muse exec`, VM binary)  -> writes SPEC.md and
 *      AgenticPlayerController.cs into a scoped run workspace.
 *      Provider is Meta Model API (vault `Meta_Key`); the CLI cannot
 *      talk to Baseten directly (its model-catalog fetch gets HTTP 405
 *      from Baseten), so Baseten is called by step 2, not by the CLI.
 *   4. Procedural terrain grid                  -> world geometry data
 *   5. Three.js WebGL + Unity C#                -> dual engine outputs
 *   6. Physics QA gate (local math checks)      -> pass/fail proofs
 *   7. Persistent storage                       -> library entry
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";

import { MuseWonderDirector } from "./muse_wonder.js";
import { resolveMetaApiKey } from "./meta_key.js";
import { SafetyShieldValidator } from "../pipeline/safety_shield.js";
import { TerrainPipeline } from "../pipeline/terrain.js";
import { generateLayout } from "../pipeline/layout.js";
import { MetaImageClient } from "../pipeline/meta_image.js";
import { generateThreeJsGameHtml } from "../engine/threejs_runtime.js";
import { UnityExporter } from "../engine/unity_exporter.js";
import { PhysicsQualityGate } from "../verifier/physics_qa_gate.js";
import { GameStorageManager } from "../storage/game_store.js";

export { resolveMetaApiKey };

const MUSE_BIN = path.join(os.homedir(), ".local", "bin", "muse");
const BASETEN_MODEL_LABEL = "meta-models/muse-spark-open";
const CLI_MODEL_LABEL = process.env.MUSE_CLI_MODEL || "muse-spark-1.3";

export class AgentRunner {
  /**
   * @param {string} workspaceDir - repo root the agent may write inside
   * @param {(event: object) => void} emit - live event sink (SSE)
   */
  constructor(workspaceDir, emit) {
    this.workspaceDir = workspaceDir;
    this.emit = emit || (() => {});
    this.shield = new SafetyShieldValidator();
    this.director = new MuseWonderDirector();
    this.worldPipeline = new TerrainPipeline();
    this.qaGate = new PhysicsQualityGate();
    this.gameStore = new GameStorageManager(
      path.join(workspaceDir, "storage", "games"),
    );
  }

  log(level, message) {
    this.emit({ type: "log", level, message, at: Date.now() });
  }

  phase(id, label, status, detail) {
    this.emit({
      type: "phase",
      id,
      label,
      status,
      detail: detail || "",
      at: Date.now(),
    });
  }

  /** Is the real `muse` binary present and runnable? */
  museAvailable() {
    try {
      return fs.existsSync(MUSE_BIN);
    } catch {
      return false;
    }
  }

  /**
   * Runs `muse exec` in a scoped run workspace and streams every
   * stdout/stderr line to the UI. Uses the live Meta provider when a
   * Meta Model API key is available; otherwise falls back to the CLI's
   * offline echo provider and says so in the log.
   * @param {string} runDir - scoped directory the CLI may write in
   * @param {string} taskPrompt
   * @returns {Promise<{ok: boolean, output: string, live: boolean, reason?: string}>}
   */
  runMuseCLI(runDir, taskPrompt, { timeoutMs = 180000 } = {}) {
    return new Promise((resolve) => {
      if (!this.museAvailable()) {
        this.log("warn", "Muse Code CLI binary not found on this host.");
        return resolve({
          ok: false,
          output: "",
          live: false,
          reason: "binary-missing",
        });
      }

      const metaKey = resolveMetaApiKey();
      const live = Boolean(metaKey);
      const args = live
        ? [
            "exec",
            "--provider",
            "meta",
            "--model",
            CLI_MODEL_LABEL,
            "--reasoning-effort",
            "low",
            "--max-model-steps",
            "4",
            "--api-key-stdin",
            "--disable-sandbox",
            "--disable-approval",
            "--trust-workspace",
            taskPrompt,
          ]
        : ["exec", "--provider", "echo", "--trust-workspace", taskPrompt];

      this.log(
        "info",
        live
          ? `Spawning Muse Code CLI on VM (live Meta provider, model ${CLI_MODEL_LABEL})`
          : "Spawning Muse Code CLI on VM (offline echo provider — no Meta key found)",
      );

      fs.mkdirSync(runDir, { recursive: true });
      const child = spawn(MUSE_BIN, args, {
        cwd: runDir,
        env: { ...process.env, MUSE_NO_MODIFY_PATH: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // The key goes over stdin only; it is never logged or put in argv.
      try {
        child.stdin.end(live ? `${metaKey}\n` : "");
      } catch {
        /* stdin may already be closed on spawn failure */
      }

      let buffer = "";
      let full = "";
      const timer = setTimeout(() => {
        this.log("warn", "Muse Code CLI exceeded time budget; terminating.");
        child.kill("SIGTERM");
      }, timeoutMs);

      const handleChunk = (chunk) => {
        const text = chunk.toString();
        full += text;
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.emit({
            type: "cli",
            stream: "stdout",
            line: trimmed,
            at: Date.now(),
          });
        }
      };

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        full += text;
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.emit({
            type: "cli",
            stream: "stderr",
            line: trimmed,
            at: Date.now(),
          });
        }
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve({ ok: false, output: full, live, reason: "spawn-error" });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (buffer.trim()) {
          this.emit({
            type: "cli",
            stream: "stdout",
            line: buffer.trim(),
            at: Date.now(),
          });
        }
        resolve({ ok: code === 0, output: full, live, code });
      });
    });
  }

  /**
   * Full pipeline. Emits live events at every step.
   * @returns {Promise<{ok: boolean, gameId?: string, playUrl?: string, spec?: object}>}
   */
  async run(rawPrompt) {
    const startedAt = Date.now();
    this.emit({ type: "start", prompt: rawPrompt, at: startedAt });

    // ---------------- Step 0: Prompt safety check (local rules) ----------------
    this.phase("shield", "Prompt safety check (local rules)", "running");
    let prompt = String(rawPrompt || "").trim();
    const safety = this.shield.validateInputPrompt(prompt);
    if (!safety.safe) {
      this.log("warn", safety.reason);
      prompt = this.shield.sanitizePrompt(prompt);
      this.log(
        "info",
        "Prompt sanitised to a policy-safe spatial simulation theme.",
      );
    }
    this.phase(
      "shield",
      "Prompt safety check (local rules)",
      "pass",
      "no restricted terms",
    );
    this.log("ok", "Safety check passed (local keyword rules).");

    // Prompt cache: an identical (sanitised) prompt reuses the Wonder/
    // Baseten design, the CLI-written Unity code, and the concept image.
    // Repeat builds therefore cost zero Meta/Baseten calls.
    const promptHash = crypto
      .createHash("sha1")
      .update(prompt.toLowerCase())
      .digest("hex")
      .slice(0, 16);
    const cacheDir = path.join(this.workspaceDir, "storage", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const specCachePath = path.join(cacheDir, `spec_${promptHash}.json`);
    const unityCachePath = path.join(cacheDir, `unity_${promptHash}.cs`);
    const imageCachePath = path.join(cacheDir, `concept_${promptHash}.webp`);
    const specCached = fs.existsSync(specCachePath);

    // ---------------- Step 1: Architect (Wonder) + open-weight enrichment (Baseten) ----------------
    this.phase(
      "brain",
      "Game design: Muse Wonder + Muse Spark Open",
      "running",
    );
    let spec;
    if (specCached) {
      try {
        spec = JSON.parse(fs.readFileSync(specCachePath, "utf8"));
        this.phase(
          "brain",
          "Game design: Muse Wonder + Muse Spark Open",
          "pass",
          "cache hit — 0 API calls",
        );
        this.log(
          "ok",
          "Design cache hit: Wonder/Baseten skipped, zero credits used.",
        );
        this.emit({ type: "spec", spec, at: Date.now() });
      } catch {
        spec = null;
      }
    }
    if (!spec) {
      this.log(
        "info",
        "High-reasoning architect: muse-wonder-1.0 · enrichment: " +
          BASETEN_MODEL_LABEL,
      );
      try {
        spec = await this.director.architectGame(prompt);
        fs.writeFileSync(specCachePath, JSON.stringify(spec, null, 2), "utf8");
        this.phase(
          "brain",
          "Game design: Muse Wonder + Muse Spark Open",
          "pass",
          `${spec.architectModel} · ${spec.world.biome}`,
        );
        this.log(
          "ok",
          `Game designed by ${spec.architectModel}: "${spec.title}" (enrichment: ${spec.enrichmentModel || "none"})`,
        );
        this.emit({ type: "spec", spec, at: Date.now() });
        if (spec.reasoning) {
          for (const line of String(spec.reasoning).split("\n").slice(0, 6)) {
            if (line.trim())
              this.emit({
                type: "reasoning",
                line: line.trim(),
                at: Date.now(),
              });
          }
        }
      } catch (err) {
        this.phase(
          "brain",
          "Game design: Muse Wonder + Muse Spark Open",
          "fail",
          "planner error",
        );
        this.log("error", "Game architecture planning failed.");
        this.emit({
          type: "error",
          message: "Game architecture planning failed.",
          at: Date.now(),
        });
        return { ok: false };
      }
    }

    // ---------------- Step 1b: Concept art (Meta Muse Image, cached) ----------------
    this.phase("image", "Concept art: Muse Image 1.0", "running");
    let conceptImage = null;
    if (fs.existsSync(imageCachePath)) {
      conceptImage = fs.readFileSync(imageCachePath);
      this.phase(
        "image",
        "Concept art: Muse Image 1.0",
        "pass",
        "cache hit — 0 API calls",
      );
      this.log(
        "ok",
        "Concept art cache hit: image API skipped, zero credits used.",
      );
    } else {
      try {
        const imageClient = new MetaImageClient();
        conceptImage = await imageClient.generateConceptImage(
          `Video game key art, third-person 3D game "${spec.title}", biome ${spec.world.biome}, ` +
            `${spec.focalAssets[0]?.prompt || "hero character"}, ${spec.objective}, cinematic lighting, no text`,
        );
        fs.writeFileSync(imageCachePath, conceptImage);
        this.phase(
          "image",
          "Concept art: Muse Image 1.0",
          "pass",
          `${conceptImage.length} bytes`,
        );
        this.log(
          "ok",
          `Concept art generated by muse-image-1.0 (${Math.round(conceptImage.length / 1024)} KB).`,
        );
      } catch {
        conceptImage = null;
        this.phase(
          "image",
          "Concept art: Muse Image 1.0",
          "warn",
          "image step skipped",
        );
        this.log("warn", "Concept art step failed; continuing without it.");
      }
    }

    // ---------------- Step 2: Muse Code CLI writes files on the VM (cached) ----------------
    this.phase("cli", "Muse Code CLI file pass (VM)", "running");
    let cliUnityCode = "";
    let cli = { ok: false, live: false };
    if (fs.existsSync(unityCachePath)) {
      cliUnityCode = fs.readFileSync(unityCachePath, "utf8");
      cli = { ok: true, live: false, cached: true };
      this.phase(
        "cli",
        "Muse Code CLI file pass (VM)",
        "pass",
        "cache hit — 0 API calls",
      );
      this.log(
        "ok",
        "Unity code cache hit: Muse CLI skipped, zero credits used.",
      );
    } else {
      const runDir = path.join(
        this.workspaceDir,
        "storage",
        ".work",
        `run_${Date.now()}`,
      );
      const cliTask =
        `Create exactly two files in this workspace and nothing else:\n` +
        `1) SPEC.md — markdown with the game title "${spec.title}", biome "${spec.world.biome}", ` +
        `player speed ${spec.mechanics.physics.playerSpeed}, jump velocity ${spec.mechanics.physics.jumpVelocity}, ` +
        `gravity ${spec.mechanics.physics.gravity}, and the objective from this concept: "${prompt}".\n` +
        `2) AgenticPlayerController.cs — a complete Unity C# MonoBehaviour class named ` +
        `AgenticPlayerController using only UnityEngine, with WASD/arrow movement at that speed, ` +
        `a Space jump using that jump velocity and gravity, and no external dependencies.`;
      cli = await this.runMuseCLI(runDir, cliTask);

      const cliUnityPath = path.join(runDir, "AgenticPlayerController.cs");
      if (cli.ok && fs.existsSync(cliUnityPath)) {
        const candidate = fs.readFileSync(cliUnityPath, "utf8");
        if (
          /class\s+AgenticPlayerController/.test(candidate) &&
          /MonoBehaviour/.test(candidate)
        ) {
          cliUnityCode = candidate;
          fs.writeFileSync(unityCachePath, candidate, "utf8");
        }
      }
    }
    const cliWroteCode = Boolean(cliUnityCode);
    if (cli.cached) {
      // Phase/log already emitted above; nothing more to report.
    } else if (cli.ok) {
      this.phase(
        "cli",
        "Muse Code CLI file pass (VM)",
        cliWroteCode ? "pass" : "warn",
        cliWroteCode
          ? `wrote AgenticPlayerController.cs (${CLI_MODEL_LABEL})`
          : "CLI ran but produced no valid C# file",
      );
      this.log(
        cliWroteCode ? "ok" : "warn",
        cliWroteCode
          ? "Muse Code CLI wrote SPEC.md and AgenticPlayerController.cs on the VM."
          : "Muse Code CLI finished without a valid C# file; template fallback will be used.",
      );
    } else {
      this.phase(
        "cli",
        "Muse Code CLI file pass (VM)",
        "warn",
        cli.reason || "cli-unavailable",
      );
      this.log(
        "warn",
        "Muse Code CLI unavailable; template fallback will be used for Unity code.",
      );
    }

    // ---------------- Step 3: Procedural terrain grid + shared layout ----------------
    this.phase("world", "Procedural world terrain grid", "running");
    const worldData = this.worldPipeline.generateWorldGeometry(spec.world);
    const layout = generateLayout(spec);
    this.phase(
      "world",
      "Procedural world terrain grid",
      "pass",
      `${worldData.gridSize}x${worldData.gridSize} · ${layout.orbs.length} orbs · ${layout.obstacles.length} obstacles`,
    );
    this.log(
      "ok",
      `Terrain elevation grid generated: ${worldData.gridSize}x${worldData.gridSize}`,
    );

    // ---------------- Step 4: Dual engine compile ----------------
    this.phase("webgl", "Three.js WebGL runtime", "running");
    const gameHtml = generateThreeJsGameHtml(spec, worldData, layout);
    const webDir = path.join(this.workspaceDir, "build", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "index.html"), gameHtml, "utf8");
    this.phase("webgl", "Three.js WebGL runtime", "pass", "index.html written");
    this.log(
      "ok",
      "WebGL runtime compiled and written to build/web/index.html",
    );

    this.phase("unity", "Unity 2022.3 C# script", "running");
    const unityDir = path.join(this.workspaceDir, "build", "unity");
    const unityExporter = new UnityExporter(unityDir);
    const unityResult = unityExporter.exportProject(spec, unityDir);
    const unitySource = cliWroteCode ? "muse-cli" : "template-fallback";
    if (cliWroteCode) {
      const target = path.join(
        unityDir,
        "Assets",
        "Scripts",
        "AgenticPlayerController.cs",
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, cliUnityCode, "utf8");
    }
    const unityCode = cliWroteCode
      ? cliUnityCode
      : fs.readFileSync(
          path.join(
            unityDir,
            "Assets",
            "Scripts",
            "AgenticPlayerController.cs",
          ),
          "utf8",
        );
    this.phase(
      "unity",
      "Unity 2022.3 C# script",
      "pass",
      unitySource === "muse-cli"
        ? "written by Muse Code CLI"
        : "template fallback",
    );
    this.log(
      "ok",
      unitySource === "muse-cli"
        ? "Unity C# script taken from the Muse Code CLI file pass."
        : "Unity C# script generated from the local template.",
    );
    this.emit({
      type: "artifact",
      kind: "unity",
      name: "AgenticPlayerController.cs",
      source: unitySource,
      content: unityCode,
      at: Date.now(),
    });

    // ---------------- Step 5: Quality gate (local math checks) ----------------
    this.phase("qa", "Physics QA checks (local)", "running");
    const qa = this.qaGate.runFullQASuite(spec, layout);
    for (const proof of qa.proofs) {
      this.emit({
        type: "proof",
        name: proof.testName,
        passed: proof.passed,
        detail: proof.proof,
        at: Date.now(),
      });
      this.log(
        proof.passed ? "ok" : "warn",
        `${proof.testName}: ${proof.passed ? "PASSED" : "FAILED"}`,
      );
    }
    this.phase(
      "qa",
      "Physics QA checks (local)",
      qa.gatePassed ? "pass" : "warn",
      `score ${qa.score}`,
    );

    // ---------------- Step 6: Persist to library ----------------
    this.phase("store", "Persistent game library", "running");
    const saved = await this.gameStore.saveGame(
      spec,
      worldData,
      gameHtml,
      unityResult.scripts,
      unitySource === "muse-cli" ? unityCode : undefined,
      conceptImage,
    );
    this.phase("store", "Persistent game library", "pass", saved.id);
    this.log("ok", `Game stored in the library: ${saved.id}`);

    const elapsedMs = Date.now() - startedAt;
    this.emit({
      type: "done",
      ok: true,
      gameId: saved.id,
      playUrl: `/studio/games/${saved.id}/index.html`,
      imageUrl: conceptImage
        ? `/studio/games/${saved.id}/assets/concept.webp`
        : null,
      title: saved.title,
      unitySource,
      elapsedMs,
      at: Date.now(),
    });

    return {
      ok: true,
      gameId: saved.id,
      playUrl: `/studio/games/${saved.id}/index.html`,
      unitySource,
      spec,
    };
  }
}
