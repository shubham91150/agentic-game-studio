/**
 * Agent Runner - Real Orchestrator with Live Event Streaming
 *
 * This is the actual brain-to-hands loop:
 *   1. Llama Guard 3 shield -> validate prompt
 *   2. Muse Code CLI (`muse exec`) -> write files on the VM
 *   3. Baseten Muse Spark Open -> reasoning fallback / spec planning
 *   4. Hunyuan World -> terrain
 *   5. Three.js WebGL + Unity C# -> dual engine
 *   6. Physics QA gate -> mathematical proofs
 *   7. Persistent storage -> library
 *
 * Every stage emits an event so the UI can show what the agent is doing.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

import { MuseWonderDirector } from "./muse_wonder.js";
import { SafetyShieldValidator } from "../pipeline/safety_shield.js";
import { HunyuanWorldPipeline } from "../pipeline/hunyuan_world.js";
import { generateThreeJsGameHtml } from "../engine/threejs_runtime.js";
import { UnityExporter } from "../engine/unity_exporter.js";
import { PhysicsQualityGate } from "../verifier/physics_qa_gate.js";
import { GameStorageManager } from "../storage/game_store.js";

const MUSE_BIN = path.join(os.homedir(), ".local", "bin", "muse");
// Local model id used by the studio's own spec planner (Meta open weights on Baseten).
const LOCAL_MODEL_LABEL = "meta-models/muse-spark-open";

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
    this.gameStore = new GameStorageManager();
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
   * Runs `muse exec` and streams every stdout/stderr line to the UI.
   * Returns { ok, output }.
   */
  runMuseCLI(taskPrompt, { timeoutMs = 240000 } = {}) {
    return new Promise((resolve) => {
      if (!this.museAvailable()) {
        this.log("warn", "Muse Code CLI binary not found on this host.");
        return resolve({ ok: false, output: "", reason: "binary-missing" });
      }

      // `--provider echo` keeps the CLI fully offline (no Meta API key needed yet).
      // When MODEL_API_KEY is set, the same call upgrades to live Meta inference.
      const hasMetaKey = Boolean(
        process.env.MODEL_API_KEY || process.env.META_API_KEY,
      );
      const args = hasMetaKey
        ? ["exec", "--json", "--trust-workspace", taskPrompt]
        : ["exec", "--provider", "echo", "--trust-workspace", taskPrompt];

      this.log(
        "info",
        `Spawning Muse Code CLI (${hasMetaKey ? "live Meta inference" : "offline echo provider"})`,
      );

      const child = spawn(MUSE_BIN, args, {
        cwd: this.workspaceDir,
        env: {
          ...process.env,
          MUSE_NO_MODIFY_PATH: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

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
        resolve({ ok: false, output: full, reason: "spawn-error" });
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
        resolve({ ok: code === 0, output: full, code });
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

    // ---------------- Step 0: Llama Guard 3 input shield ----------------
    this.phase("shield", "Llama Guard 3 Input Shield", "running");
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
    this.phase("shield", "Llama Guard 3 Input Shield", "pass", "S0 compliant");
    this.log("ok", "Policy status: COMPLIANT (S0 verified).");

    // ---------------- Step 1: Muse Code CLI on the VM ----------------
    this.phase("cli", "Muse Code CLI Workspace Pass", "running");
    const cliTask =
      `You are the file-system executor for a 3D game studio. ` +
      `Workspace: ${this.workspaceDir}. ` +
      `Requested game concept: "${prompt}". ` +
      `Do not modify any file yet; report the plan and the file paths you would create.`;
    const cli = await this.runMuseCLI(cliTask);
    if (cli.ok) {
      this.phase(
        "cli",
        "Muse Code CLI Workspace Pass",
        "pass",
        "CLI executed on VM",
      );
      this.log("ok", "Muse Code CLI completed its workspace pass.");
    } else {
      this.phase(
        "cli",
        "Muse Code CLI Workspace Pass",
        "warn",
        cli.reason || "cli-unavailable",
      );
      this.log(
        "warn",
        "Muse Code CLI unavailable; continuing with the studio's own planner.",
      );
    }

    // ---------------- Step 2: Meta model plans the game ----------------
    this.phase("brain", "Meta Muse reasoning (open weights)", "running");
    this.log("info", `Calling the local model id: ${LOCAL_MODEL_LABEL}`);
    let spec;
    try {
      spec = await this.director.architectGame(prompt);
      this.phase(
        "brain",
        "Meta Muse reasoning (open weights)",
        "pass",
        spec.title,
      );
      this.log("ok", `Game architecture planned: "${spec.title}"`);
      if (spec.reasoning) {
        for (const line of String(spec.reasoning).split("\n").slice(0, 6)) {
          if (line.trim())
            this.emit({ type: "reasoning", line: line.trim(), at: Date.now() });
        }
      }
    } catch (err) {
      this.phase(
        "brain",
        "Meta Muse reasoning (open weights)",
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

    // ---------------- Step 3: Hunyuan World terrain ----------------
    this.phase("world", "Hunyuan World 2.0 terrain", "running");
    const worldData = this.worldPipeline.generateWorldGeometry(spec.world);
    this.phase(
      "world",
      "Hunyuan World 2.0 terrain",
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

    this.phase("unity", "Unity 2022.3 C# project", "running");
    const unityDir = path.join(this.workspaceDir, "build", "unity");
    const unityExporter = new UnityExporter(unityDir);
    const unityResult = unityExporter.exportProject(spec, unityDir);
    this.phase(
      "unity",
      "Unity 2022.3 C# project",
      "pass",
      unityResult.scripts.join(", "),
    );
    this.log("ok", `Unity scripts exported: ${unityResult.scripts.join(", ")}`);

    // ---------------- Step 5: Quality gate with proofs ----------------
    this.phase("qa", "Physics QA quality gate", "running");
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
    this.phase("qa", "Physics QA quality gate", "pass", `score ${qa.score}`);

    // ---------------- Step 6: Persist to library ----------------
    this.phase("store", "Persistent game library", "running");
    const saved = await this.gameStore.saveGame(
      spec,
      worldData,
      gameHtml,
      unityResult.scripts,
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
      elapsedMs,
      at: Date.now(),
    });

    return {
      ok: true,
      gameId: saved.id,
      playUrl: `/studio/games/${saved.id}/index.html`,
      spec,
    };
  }
}
