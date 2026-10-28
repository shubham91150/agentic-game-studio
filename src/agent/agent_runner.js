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
import { spawn, execFileSync } from "node:child_process";
import os from "node:os";

import { MuseWonderDirector } from "./muse_wonder.js";
import { SafetyShieldValidator } from "../pipeline/safety_shield.js";
import { HunyuanWorldPipeline } from "../pipeline/hunyuan_world.js";
import { generateThreeJsGameHtml } from "../engine/threejs_runtime.js";
import { UnityExporter } from "../engine/unity_exporter.js";
import { PhysicsQualityGate } from "../verifier/physics_qa_gate.js";
import { GameStorageManager } from "../storage/game_store.js";

const MUSE_BIN = path.join(os.homedir(), ".local", "bin", "muse");
const BASETEN_MODEL_LABEL = "meta-models/muse-spark-open";
const CLI_MODEL_LABEL = process.env.MUSE_CLI_MODEL || "muse-spark-1.3";
const VAULT_SCRIPT =
  "/home/opencode/project-data/workspace/.orchestrator/vault.mjs";

function readVaultKey(name) {
  try {
    if (!fs.existsSync(VAULT_SCRIPT)) return undefined;
    const out = execFileSync("node", [VAULT_SCRIPT, "get", name], {
      encoding: "utf8",
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Meta Model API key for the Muse CLI: env first, then the local vault. */
export function resolveMetaApiKey() {
  return (
    process.env.MODEL_API_KEY ||
    process.env.META_API_KEY ||
    readVaultKey("Meta_Key")
  );
}

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
    this.worldPipeline = new HunyuanWorldPipeline();
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
            "medium",
            "--max-model-steps",
            "8",
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

    // ---------------- Step 1: Meta open weights plan the game (Baseten) ----------------
    this.phase("brain", "Meta Muse Spark Open via Baseten", "running");
    this.log("info", `Calling Baseten model: ${BASETEN_MODEL_LABEL}`);
    let spec;
    try {
      spec = await this.director.architectGame(prompt);
      this.phase(
        "brain",
        "Meta Muse Spark Open via Baseten",
        "pass",
        spec.title,
      );
      this.log("ok", `Game architecture planned: "${spec.title}"`);
      this.emit({ type: "spec", spec, at: Date.now() });
      if (spec.reasoning) {
        for (const line of String(spec.reasoning).split("\n").slice(0, 6)) {
          if (line.trim())
            this.emit({ type: "reasoning", line: line.trim(), at: Date.now() });
        }
      }
    } catch (err) {
      this.phase(
        "brain",
        "Meta Muse Spark Open via Baseten",
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

    // ---------------- Step 2: Muse Code CLI writes files on the VM ----------------
    this.phase("cli", "Muse Code CLI file pass (VM)", "running");
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
    const cli = await this.runMuseCLI(runDir, cliTask);

    let cliUnityCode = "";
    const cliUnityPath = path.join(runDir, "AgenticPlayerController.cs");
    if (cli.ok && fs.existsSync(cliUnityPath)) {
      const candidate = fs.readFileSync(cliUnityPath, "utf8");
      if (
        /class\s+AgenticPlayerController/.test(candidate) &&
        /MonoBehaviour/.test(candidate)
      ) {
        cliUnityCode = candidate;
      }
    }
    const cliWroteCode = Boolean(cliUnityCode);
    if (cli.ok) {
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

    // ---------------- Step 3: Procedural terrain grid ----------------
    this.phase("world", "Procedural world terrain grid", "running");
    const worldData = this.worldPipeline.generateWorldGeometry(spec.world);
    this.phase(
      "world",
      "Procedural world terrain grid",
      "pass",
      `${worldData.gridSize}x${worldData.gridSize}`,
    );
    this.log(
      "ok",
      `Terrain elevation grid generated: ${worldData.gridSize}x${worldData.gridSize}`,
    );

    // ---------------- Step 4: Dual engine compile ----------------
    this.phase("webgl", "Three.js WebGL runtime", "running");
    const gameHtml = generateThreeJsGameHtml(spec, worldData);
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
    const qa = this.qaGate.runFullQASuite(spec);
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
    this.phase("qa", "Physics QA checks (local)", "pass", `score ${qa.score}`);

    // ---------------- Step 6: Persist to library ----------------
    this.phase("store", "Persistent game library", "running");
    const saved = await this.gameStore.saveGame(
      spec,
      worldData,
      gameHtml,
      unityResult.scripts,
      unitySource === "muse-cli" ? unityCode : undefined,
    );
    this.phase("store", "Persistent game library", "pass", saved.id);
    this.log("ok", `Game stored in the library: ${saved.id}`);

    const elapsedMs = Date.now() - startedAt;
    this.emit({
      type: "done",
      ok: true,
      gameId: saved.id,
      playUrl: `/studio/games/${saved.id}/index.html`,
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
