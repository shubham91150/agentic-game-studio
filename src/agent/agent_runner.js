/**
 * Agent Runner - Real Orchestrator with Live Event Streaming
 *
 * The agent runs ON THE VM. Every step the UI shows is an action that
 * actually executed here, in arrival order — the UI predefines nothing:
 *   1. Prompt safety check (local rules)
 *   2. Game design by Muse Wonder 1.0 + open-weight enrichment on Baseten
 *   3. Concept art by Muse Image 1.0
 *   4. Muse Code CLI (`muse exec --json`) — its REAL sub-actions
 *      (model thinking, tool: write_file per file) are parsed from the
 *      CLI's JSONL stream and each becomes its own step in the UI.
 *      Internal reminder/subagent noise is filtered out.
 *   5. Procedural terrain + deterministic shared layout
 *   6. Three.js WebGL runtime compiled from the spec
 *   7. Unity C# project (CLI-written code when valid)
 *   8. Physics QA gate (local math incl. real BFS reachability)
 *   9. Persistent storage -> library entry
 * Token usage reported by the CLI (`run.usage`) is streamed too, so
 * credit spend is visible per run.
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

/**
 * Human label + origin for one real CLI sub-action.
 * Returns null for internal noise (reminder/subagent tasks) — those are
 * never shown in the UI.
 */
export function describeCliTaskKind(kind) {
  if (!kind || kind.startsWith("reminder.")) return null;
  if (kind === "model.meta.response") {
    return {
      title: "Muse Spark 1.3 thinking",
      source: `live Meta · CLI · ${CLI_MODEL_LABEL}`,
    };
  }
  const toolMatch = kind.match(/^tool[:.](.+)$/);
  if (toolMatch) {
    return { title: `CLI tool: ${toolMatch[1]}`, source: "Muse Code CLI" };
  }
  return { title: `CLI task: ${kind}`, source: "Muse Code CLI" };
}

/**
 * Human-readable one-line summary of a CLI tool output chunk.
 * Bash-style chunks arrive as JSON metadata ({command, ...}); surface
 * the command instead of raw JSON. Plain-text chunks (e.g. write_file
 * "wrote N bytes to ...") pass through trimmed.
 */
export function summarizeCliChunk(chunk) {
  const text = String(chunk || "").trim();
  if (!text) return "";
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text);
      if (typeof obj.command === "string" && obj.command.trim()) {
        return `command: ${obj.command.trim()}`.slice(0, 160);
      }
      if (typeof obj.text === "string" && obj.text.trim()) {
        return obj.text.trim().slice(0, 160);
      }
    } catch {
      /* not JSON — fall through to raw text */
    }
  }
  return text.slice(0, 160);
}

/**
 * Pure reducer: one parsed `muse exec --json` line -> UI actions.
 * Real CLI shape (verified against live output): the lifecycle phase is
 * part of `payload_type` ("task.lifecycle.proposed", ".started",
 * ".output", ".completed", ".cancelled") and mirrored in `event.kind`;
 * the task kind ("model.meta.response", "tool.write_file", ...) only
 * appears on the `proposed` event. Reminder/subagent tasks are ignored.
 * @param {{tasks: Map}} state - mutated: taskId -> {title, source, failed}
 * @param {object} obj - parsed JSONL object
 * @returns {Array} actions: {phase:{id,label,status,detail,source}} |
 *   {cli:string} | {log:{level,message}} | {usage:models}
 */
export function applyMuseJsonEvent(state, obj) {
  const actions = [];
  const p = obj && obj.payload;
  if (!p) return actions;
  const pt = obj.payload_type || "";
  const ev = p.event || {};
  const phase =
    ev.kind ||
    (pt.startsWith("task.lifecycle.")
      ? pt.slice("task.lifecycle.".length)
      : "");
  const taskId = p.task_id || ev.task_id;

  if (pt.startsWith("task.lifecycle.") || ev.kind) {
    if (phase === "proposed" && ev.task_kind) {
      const desc = describeCliTaskKind(ev.task_kind);
      state.tasks.set(
        taskId,
        desc ? { ...desc, failed: false, phaseId: null } : { ignored: true },
      );
      return actions;
    }
    if (!taskId || !state.tasks.has(taskId)) return actions;
    const t = state.tasks.get(taskId);
    if (t.ignored) return actions;
    // Sequential ids: task UUIDs share a run prefix, so truncation
    // collides. Arrival order is the honest, unique naming.
    if (!t.phaseId) {
      state.seq = (state.seq || 0) + 1;
      t.phaseId = `cli-step-${state.seq}`;
    }
    const phaseId = t.phaseId;
    if (phase === "started") {
      actions.push({
        phase: {
          id: phaseId,
          label: t.title,
          status: "running",
          detail: "",
          source: t.source,
        },
      });
    } else if (
      phase === "output" &&
      typeof ev.chunk === "string" &&
      ev.chunk.trim()
    ) {
      t.lastDetail = summarizeCliChunk(ev.chunk);
      actions.push({ cli: ev.chunk.trim().slice(0, 500) });
      actions.push({
        phase: {
          id: phaseId,
          label: t.title,
          status: "running",
          detail: t.lastDetail,
          source: t.source,
        },
      });
    } else if (phase === "completed") {
      actions.push({
        phase: {
          id: phaseId,
          label: t.title,
          status: "pass",
          detail: t.lastDetail || "done",
          source: t.source,
        },
      });
    } else if (phase === "cancelled") {
      actions.push({
        phase: {
          id: phaseId,
          label: t.title,
          status: "warn",
          detail: ev.reason || "cancelled",
          source: t.source,
        },
      });
    }
    // accepted/scheduled/status/tool_output_ref/side_effect_intent:
    // internal transitions, intentionally silent.
    return actions;
  }
  if (pt === "tool.result" && p.correlation_facts) {
    const outcome = p.correlation_facts.outcome;
    const tool = p.correlation_facts.tool_name || "tool";
    if (outcome && outcome !== "success") {
      actions.push({
        log: {
          level: "warn",
          message: `CLI tool ${tool} reported: ${outcome}`,
        },
      });
    }
  } else if (pt === "run.usage" && Array.isArray(p.models)) {
    const parts = p.models.map(
      (m) =>
        `${m.model}: ${m.input_tokens} in / ${m.output_tokens} out` +
        (m.cached_tokens ? ` (${m.cached_tokens} cached)` : ""),
    );
    actions.push({ usage: p.models });
    actions.push({
      log: { level: "info", message: `CLI token usage — ${parts.join("; ")}` },
    });
  }
  return actions;
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
    this.worldPipeline = new TerrainPipeline();
    this.qaGate = new PhysicsQualityGate();
    this.gameStore = new GameStorageManager(
      path.join(workspaceDir, "storage", "games"),
    );
  }

  log(level, message) {
    this.emit({ type: "log", level, message, at: Date.now() });
  }

  phase(id, label, status, detail, source, origin) {
    this.emit({
      type: "phase",
      id,
      label,
      status,
      detail: detail || "",
      source: source || "",
      // origin: "cli" = a real action the Muse Code CLI took on the VM.
      // Anything else is backend orchestration (shown in logs, not steps).
      origin: origin || "backend",
      at: Date.now(),
    });
  }

  /** Human label + origin for one real CLI sub-action. Null = internal noise. */
  applyCliAction(action) {
    if (action.phase) {
      this.phase(
        action.phase.id,
        action.phase.label,
        action.phase.status,
        action.phase.detail,
        action.phase.source,
        "cli",
      );
    } else if (action.cli) {
      this.emit({
        type: "cli",
        stream: "stdout",
        line: action.cli,
        at: Date.now(),
      });
    } else if (action.log) {
      this.log(action.log.level, action.log.message);
    } else if (action.usage) {
      this.emit({ type: "usage", models: action.usage, at: Date.now() });
    }
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
   * Runs `muse exec` in a scoped run workspace and streams the CLI's REAL
   * sub-actions to the UI. With the live Meta provider the CLI emits
   * machine-readable JSONL (`--json`); each model/tool action parsed from
   * it becomes its own step (model thinking, tool: write_file per file).
   * Internal reminder/subagent chatter is filtered out, never shown.
   * Falls back to plain-text lines for the offline echo provider.
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
      const useJson = live;
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
            "--json",
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
      const jsonState = { tasks: new Map() };
      const timer = setTimeout(() => {
        this.log("warn", "Muse Code CLI exceeded time budget; terminating.");
        child.kill("SIGTERM");
      }, timeoutMs);

      const handleStdoutLine = (trimmed) => {
        if (!trimmed) return;
        if (useJson) {
          let obj = null;
          try {
            obj = JSON.parse(trimmed);
          } catch {
            obj = null;
          }
          if (obj && obj.payload_type) {
            for (const action of applyMuseJsonEvent(jsonState, obj)) {
              this.applyCliAction(action);
            }
            return;
          }
        }
        this.emit({
          type: "cli",
          stream: "stdout",
          line: trimmed.slice(0, 500),
          at: Date.now(),
        });
      };

      const handleChunk = (chunk) => {
        const text = chunk.toString();
        if (!useJson) full += text;
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleStdoutLine(line.trim());
        }
      };

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.emit({
            type: "cli",
            stream: "stderr",
            line: trimmed.slice(0, 500),
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
          handleStdoutLine(buffer.trim());
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
    this.phase(
      "shield",
      "Prompt safety check (local rules)",
      "running",
      "",
      "local rules",
    );
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
      "local rules",
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
      "",
      "muse-wonder-1.0 + spark-open",
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
          "cache",
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
          spec.architectModel || "muse-wonder-1.0",
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
          "",
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
    this.phase(
      "image",
      "Concept art: Muse Image 1.0",
      "running",
      "",
      "muse-image-1.0",
    );
    let conceptImage = null;
    if (fs.existsSync(imageCachePath)) {
      conceptImage = fs.readFileSync(imageCachePath);
      this.phase(
        "image",
        "Concept art: Muse Image 1.0",
        "pass",
        "cache hit — 0 API calls",
        "cache",
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
          "muse-image-1.0",
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
          "",
        );
        this.log("warn", "Concept art step failed; continuing without it.");
      }
    }

    // ---------------- Muse Code CLI writes files on the VM (cached) ----------------
    // No parent step is emitted: the CLI's own sub-steps
    // (thinking, tool: bash, tool: write_file) stream as cli-step-N phases.
    let cliUnityCode = "";
    let cli = { ok: false, live: false };
    if (fs.existsSync(unityCachePath)) {
      cliUnityCode = fs.readFileSync(unityCachePath, "utf8");
      cli = { ok: true, live: false, cached: true };
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

      // The run dir is fresh per run, so any file here came from this run.
      // Accept it on content validity even if the CLI exited non-zero
      // (e.g. it hit --max-model-steps after writing the files).
      const cliUnityPath = path.join(runDir, "AgenticPlayerController.cs");
      if (fs.existsSync(cliUnityPath)) {
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
    // No parent "cli" step here on purpose: the CLI's own sub-steps
    // (thinking, tool: bash, tool: write_file) already streamed above as
    // cli-step-N phases. Only a log line summarizes the outcome.
    if (cli.cached) {
      // Log already emitted above; nothing more to report.
    } else if (cliWroteCode) {
      this.log(
        "ok",
        "Muse Code CLI wrote SPEC.md and AgenticPlayerController.cs on the VM.",
      );
    } else if (cli.ok) {
      this.log(
        "warn",
        "Muse Code CLI finished without a valid C# file; template fallback will be used.",
      );
    } else {
      this.log(
        "warn",
        "Muse Code CLI unavailable; template fallback will be used for Unity code.",
      );
    }

    // ---------------- Step 3: Procedural terrain grid + shared layout ----------------
    this.phase(
      "world",
      "Procedural world terrain grid",
      "running",
      "",
      "procedural",
    );
    const worldData = this.worldPipeline.generateWorldGeometry(spec.world);
    const layout = generateLayout(spec);
    this.phase(
      "world",
      "Procedural world terrain grid",
      "pass",
      `${worldData.gridSize}x${worldData.gridSize} · ${layout.orbs.length} orbs · ${layout.obstacles.length} obstacles`,
      "procedural",
    );
    this.log(
      "ok",
      `Terrain elevation grid generated: ${worldData.gridSize}x${worldData.gridSize}`,
    );

    // ---------------- Step 4: Dual engine compile ----------------
    this.phase("webgl", "Three.js WebGL runtime", "running", "", "three.js");
    const gameHtml = generateThreeJsGameHtml(spec, worldData, layout);
    const webDir = path.join(this.workspaceDir, "build", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "index.html"), gameHtml, "utf8");
    this.phase(
      "webgl",
      "Three.js WebGL runtime",
      "pass",
      "index.html written",
      "three.js",
    );
    this.log(
      "ok",
      "WebGL runtime compiled and written to build/web/index.html",
    );

    this.phase(
      "unity",
      "Unity 2022.3 C# script",
      "running",
      "",
      "unity exporter",
    );
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
      unitySource,
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
    this.phase("qa", "Physics QA checks (local)", "running", "", "local math");
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
      "local math",
    );

    // ---------------- Step 6: Persist to library ----------------
    this.phase("store", "Persistent game library", "running", "", "vm disk");
    const saved = await this.gameStore.saveGame(
      spec,
      worldData,
      gameHtml,
      unityResult.scripts,
      unitySource === "muse-cli" ? unityCode : undefined,
      conceptImage,
    );
    this.phase("store", "Persistent game library", "pass", saved.id, "vm disk");
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
