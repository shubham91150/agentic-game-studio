/**
 * Agentic Game Studio - Backend Server (VM)
 *
 * Serves the studio UI and the live agent API with Server-Sent Events,
 * so the browser can watch the agent work in real time.
 *
 * Routes (all public, no auth):
 *   GET  /                                -> studio UI
 *   GET  /api/studio/health               -> pipeline component health
 *   GET  /api/studio/games                -> stored game library
 *   GET  /api/studio/games/:id            -> single game manifest
 *   POST /api/studio/generate             -> SSE stream of agent events
 *   GET  /studio/games/:id/index.html     -> play a stored game
 *   GET  /studio/judge-games/:id/*         -> play an ephemeral judge build
 *   POST /api/studio/judge-audit            -> judge visit ping (token-gated)
 *   GET  /api/studio/judge-audit            -> last 50 judge events (owner)
 *   GET  /api/studio/export/unity/:id     -> download a Unity C# script
 *   GET  /api/studio/download             -> download the current live-preview game as a .zip
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  AgentRunner,
  ALLOWED_CLI_MODELS,
  resolveMetaApiKey,
} from "./agent/agent_runner.js";
import { GameStorageManager } from "./storage/game_store.js";
import { BasetenMuseClient } from "./agent/baseten_muse.js";
import { MetaVoiceTranscribeClient } from "./tools/meta_voice_transcribe.js";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STORAGE_DIR = path.join(ROOT_DIR, "storage", "games");
// Ephemeral public-judge builds land here — never in STORAGE_DIR — so the
// official library stays clean no matter how many test games judges build.
const JUDGE_RUNS_DIR = path.join(ROOT_DIR, "storage", ".judge-runs");
const CHATS_DIR = path.join(ROOT_DIR, "storage", "chats");
const execFileAsync = promisify(execFileCb);

const PORT = Number(process.env.STUDIO_PORT || 3030);
const gameStore = new GameStorageManager(STORAGE_DIR);
const TMUX_SESSION = process.env.STUDIO_TMUX_SESSION || "muse-studio";
let activeTerminalModel = "muse-spark-1.3";

// ---------- Owner authentication (hackathon hardening) ----------
// Unauthenticated internet visitors must never mutate the VM, drive the
// terminal, read chats, or spend API credits. Judges keep read-only play.
// Owner = valid opencode_gh_session cookie (same AES-256-GCM scheme as
// /opt/opencode-gateway/server.js) OR a direct loopback request with NO
// proxy headers. Anything via spurcode.duckdns.org / x-forwarded-* without
// a valid cookie is NOT the owner.
function verifyOpenCodeGitHubCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const secret =
    process.env.OPENCODE_SESSION_SECRET ||
    process.env.OPENCODE_SERVER_PASSWORD ||
    "";
  if (!secret) return false;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("opencode_gh_session="));
  if (!match) return false;
  let token = "";
  try {
    token = decodeURIComponent(match.slice("opencode_gh_session=".length));
  } catch {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const key = crypto.createHash("sha256").update(secret).digest();
    const iv = Buffer.from(parts[0], "base64url");
    const encrypted = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const raw = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.username !== "string" ||
      typeof parsed.token !== "string"
    )
      return false;
    const uname = parsed.username.toLowerCase();
    const allowTestOwner = PORT !== 3030 && uname === "owner";
    if (uname !== "shubham91150" && !allowTestOwner) return false;
    if (typeof parsed.exp === "number" && parsed.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function isOwnerRequest(req) {
  try {
    if (verifyOpenCodeGitHubCookie(req.headers && req.headers.cookie)) {
      return true;
    }
  } catch {
    /* fall through to loopback check */
  }
  const h = (req && req.headers) || {};
  if (h["x-forwarded-for"] || h["x-forwarded-proto"] || h["x-forwarded-host"]) {
    return false;
  }
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(h.host || "");
}

const OWNER_REQUIRED_BODY = {
  error:
    "Owner authentication required. Sign in via GitHub at /terminal/ to control the VM studio.",
};

// Returns true when the request was rejected (caller must return).
function ownerGuard(req, res) {
  if (isOwnerRequest(req)) return false;
  try {
    req.resume();
  } catch {
    /* ignore */
  }
  json(res, 401, OWNER_REQUIRED_BODY);
  return true;
}

// ---------- Smart power-router prompt enrichment ----------
// 1-line prompts ("ek racing game banao") get a concise routing directive
// appended so the agent always researches first and uses the right tools
// per stage (.agents/memory/tool-routing-matrix.md). Exported for tests.
const STUDIO_CONFIRM_RE =
  /^(yes|yeah|yep|y|ha+|haan|ok|okay|continue|go|go ahead|no|nahi|na|nope|cancel|stop)[.!…]*$/i;
const STUDIO_BUILD_RE =
  /\b(build|creat|upgrad|fix|mak|implement|generat|design|improv|polish|refactor|rework|redo|add|banao|bana)\w*\b/i;

function sanitizeScope(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 32)
    : "game";
}

function sanitizeSkills(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().slice(0, 64))
    .slice(0, 20);
}

function sanitizeAttachmentNames(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a.name === "string") return a.name;
      if (a && typeof a.path === "string") return a.path;
      return "";
    })
    .filter(Boolean)
    .map((n) => String(n).split("/").pop().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);
}

export function enrichStudioPrompt(prompt, opts) {
  const raw = prompt === undefined || prompt === null ? "" : String(prompt);
  const t = raw.trim();
  if (!t) return raw;
  if (t.startsWith("/")) return raw; // slash command: /model, /help, /clear…
  if (STUDIO_CONFIRM_RE.test(t)) return raw; // yes / ha / ok / continue …
  if (!STUDIO_BUILD_RE.test(t) && t.length < 12) return raw; // short chat
  // Build request (any length, EN or Hinglish verbs) or a long message:
  // long non-verb messages are usually implicit work feedback ("the lantern
  // looks too dim"), so route them too rather than risk skipped tools.
  const o = opts && typeof opts === "object" ? opts : {};
  const scope = sanitizeScope(o.scope);
  const skills = sanitizeSkills(o.skills);
  const atts = sanitizeAttachmentNames(o.attachments);
  const directive =
    `[Studio Context: scope=${scope}, ` +
    `skills=${skills.length ? skills.join(", ") : "none"}, ` +
    `attachments=${atts.length ? atts.length + " file(s): " + atts.join(", ") : "none"} | ` +
    `Follow .agents/memory/tool-routing-matrix.md: research first, use Blender 3.4/MCP/PBR/audio tools & subagent_spawn per stage, verify with visual_qa_gate.js]`;
  return `${t}\n\n${directive}`;
}

// Judge Sandbox rate limit: max 6 public builds per 10 minutes per IP.
const JUDGE_BUILD_MAX = 6;
const JUDGE_BUILD_WINDOW_MS = 10 * 60 * 1000;
const judgeBuildHits = new Map();
// VM RAM/CPU protection: at most 1 concurrent non-owner sandbox build.
// (Single-instance in-memory mutex; a multi-instance deploy would need a
// shared store. Decremented in the generate handler's finally block.)
let activeJudgeBuildCount = 0;

// ---------- Hackathon judge verification token + prompt-cache gate ----------
// Uncached live-AI builds spend real API credits, so strangers (no valid
// ?judge= token) may only run prompts whose design is already cached
// (spec_<hash>.json — zero credits). Every 3D Library game stays open to
// play for everyone; judges with the access link can build anything.
// The hash MUST match AgentRunner's prompt-only legacy key exactly:
// sha1(trim(prompt).toLowerCase()).slice(0, 16).
export const JUDGE_TOKEN = process.env.STUDIO_JUDGE_TOKEN || "meta-judge-2026";
const JUDGE_AUDIT_FILE = path.join(JUDGE_RUNS_DIR, "judge_audit.json");
export function judgePromptCacheHit(prompt) {
  try {
    const h = crypto
      .createHash("sha1")
      .update(
        String(prompt || "")
          .trim()
          .toLowerCase(),
      )
      .digest("hex")
      .slice(0, 16);
    return fs.existsSync(
      path.join(ROOT_DIR, "storage", "cache", `spec_${h}.json`),
    );
  } catch {
    return false;
  }
}
export function judgeTokenValid(req, payload) {
  const headerToken =
    req && req.headers ? req.headers["x-judge-token"] : undefined;
  const bodyToken =
    payload && typeof payload.judgeToken === "string"
      ? payload.judgeToken
      : undefined;
  return headerToken === JUDGE_TOKEN || bodyToken === JUDGE_TOKEN;
}
export function judgeGenerateAllowed(req, payload, prompt) {
  if (judgeTokenValid(req, payload)) {
    return { allowed: true, via: "judge-token" };
  }
  if (judgePromptCacheHit(prompt)) {
    return { allowed: true, via: "cache-hit" };
  }
  return { allowed: false, via: "none" };
}
// Best-effort append; never throws, never blocks the request. Capped so
// the audit file cannot grow without bound.
function appendJudgeAudit(req, event, prompt) {
  try {
    fs.mkdirSync(JUDGE_RUNS_DIR, { recursive: true });
    let arr = [];
    try {
      const raw = fs.readFileSync(JUDGE_AUDIT_FILE, "utf8");
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
    arr.push({
      at: new Date().toISOString(),
      event: String(event || "").slice(0, 40),
      prompt: String(prompt ?? "").slice(0, 300),
      ua: String((req.headers && req.headers["user-agent"]) || "").slice(
        0,
        120,
      ),
    });
    fs.writeFileSync(
      JUDGE_AUDIT_FILE,
      JSON.stringify(arr.slice(-1000), null, 2),
    );
  } catch {
    /* audit must never break the request */
  }
}
function judgeClientIp(req) {
  const fwd = String((req.headers && req.headers["x-forwarded-for"]) || "")
    .split(",")[0]
    .trim();
  if (fwd) return fwd;
  return (req.socket && req.socket.remoteAddress) || "unknown";
}
function judgeBuildAllowed(ip) {
  const now = Date.now();
  const arr = (judgeBuildHits.get(ip) || []).filter(
    (t) => now - t < JUDGE_BUILD_WINDOW_MS,
  );
  if (arr.length >= JUDGE_BUILD_MAX) {
    judgeBuildHits.set(ip, arr);
    const retryAfter = Math.max(
      1,
      Math.ceil((JUDGE_BUILD_WINDOW_MS - (now - arr[0])) / 1000),
    );
    return { allowed: false, retryAfter };
  }
  arr.push(now);
  judgeBuildHits.set(ip, arr);
  return { allowed: true, retryAfter: 0 };
}

// ---------- Live AI Director (public judges route) ----------
// POST /api/studio/ai/director drives enemy tactics + live 3D environment
// mutation from real gameplay telemetry via meta-models/muse-spark-open-1026,
// with a 20s state-signature cache (0 credits on repeat states) and an
// instant deterministic heuristic fallback (<5ms) on ANY failure.
export const AI_DIRECTOR_TACTICS = [
  "ambush_room",
  "cut_off_chapel",
  "stalk_shadow",
  "inspect_hideout",
];
export const AI_DIRECTOR_ENV_EVENTS = [
  "lantern_blackout",
  "storm_surge",
  "ash_vortex",
  "chapel_omen",
];
export const AI_DIRECTOR_MODEL_FALLBACK = "heuristic-fallback-v1";
const AI_DIRECTOR_CACHE_TTL_MS = 20000;
const AI_DIRECTOR_TIMEOUT_MS = 3500;
const AI_DIRECTOR_MAX = 30;
const AI_DIRECTOR_WINDOW_MS = 60 * 1000;
const directorHits = new Map();
const directorCache = new Map();

// Mirror of judgeBuildAllowed: 30 req/min per IP, 429 + retryAfter.
export function directorAllowed(ip) {
  const now = Date.now();
  const arr = (directorHits.get(ip) || []).filter(
    (t) => now - t < AI_DIRECTOR_WINDOW_MS,
  );
  if (arr.length >= AI_DIRECTOR_MAX) {
    directorHits.set(ip, arr);
    const retryAfter = Math.max(
      1,
      Math.ceil((AI_DIRECTOR_WINDOW_MS - (now - arr[0])) / 1000),
    );
    return { allowed: false, retryAfter };
  }
  arr.push(now);
  directorHits.set(ip, arr);
  return { allowed: true, retryAfter: 0 };
}

// Rounded state signature: repeat states hit the cache, near-identical
// numeric telemetry (dist/noise buckets) collapses to one signature.
export function buildDirectorSignature(t) {
  const s = t && typeof t === "object" ? t : {};
  const room = String(s.room ?? "unknown").trim() || "unknown";
  const enemyState = String(s.enemyState ?? "unknown").trim() || "unknown";
  const hasKey = s.hasKey ? 1 : 0;
  const torchOn = s.torchOn ? 1 : 0;
  const dist = Number(s.dist);
  const noise = Number(s.noise);
  const distBucket = Number.isFinite(dist)
    ? Math.floor(Math.max(0, dist) / 2)
    : 0;
  const noiseBucket = Number.isFinite(noise)
    ? Math.floor(Math.max(0, noise) / 10)
    : 0;
  return `${room}|${enemyState}|${hasKey}|${torchOn}|${distBucket}|${noiseBucket}`;
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Defensive validation: clamp numbers, validate enums, coerce strings.
export function clampDirector(d) {
  const o = d && typeof d === "object" ? d : {};
  return {
    tactic: AI_DIRECTOR_TACTICS.includes(o.tactic) ? o.tactic : "stalk_shadow",
    targetRoom:
      typeof o.targetRoom === "string" && o.targetRoom.trim()
        ? o.targetRoom.trim().slice(0, 64)
        : "Chapel",
    alertBoost: Math.round(clampNum(o.alertBoost, 0, 25, 5)),
    whisper:
      typeof o.whisper === "string" && o.whisper.trim()
        ? o.whisper.trim().slice(0, 280)
        : "It watches from the dark...",
    envEvent: AI_DIRECTOR_ENV_EVENTS.includes(o.envEvent)
      ? o.envEvent
      : "storm_surge",
    fogDensity: clampNum(o.fogDensity, 0.038, 0.065, 0.05),
    lightDim: clampNum(o.lightDim, 0.25, 1.0, 0.8),
    ashTurbulence: clampNum(o.ashTurbulence, 1.0, 2.8, 1.4),
  };
}

// Deterministic heuristic fallback: pure function of telemetry, <5ms.
export function heuristicDirector(t) {
  const s = t && typeof t === "object" ? t : {};
  const room = String(s.room ?? "unknown").trim() || "unknown";
  const dist = Number(s.dist);
  const d = Number.isFinite(dist) ? Math.max(0, dist) : 99;
  const noise = Number(s.noise);
  const n = Number.isFinite(noise) ? Math.max(0, noise) : 0;
  const torch = Boolean(s.torchOn);
  const key = Boolean(s.hasKey);
  const crouch = Boolean(s.crouch);
  let tactic;
  let envEvent;
  let whisper;
  if (key) {
    tactic = "cut_off_chapel";
    envEvent = "chapel_omen";
    whisper =
      `The Chapel Key burns in your fist — it is already waiting in the ` +
      `Chapel, and ${room} means nothing now. Bhaag sakte ho to bhaago.`;
  } else if (torch && d < 6) {
    tactic = "ambush_room";
    envEvent = "lantern_blackout";
    whisper =
      `That torch in ${room} paints you like a target — snuff it out, ` +
      `it is already inside the room with you.`;
  } else if (crouch && d < 8) {
    tactic = "inspect_hideout";
    envEvent = "ash_vortex";
    whisper =
      `Crouching in the dark of ${room}? It heard your breath stop — ` +
      `the ash is curling toward your hiding place.`;
  } else {
    tactic = "stalk_shadow";
    envEvent = "storm_surge";
    whisper = torch
      ? `Your torch gutters in ${room} — something paces you between the lightning strikes.`
      : `Darkness in ${room}... the storm sees what you cannot. It is circling closer.`;
  }
  const alertBoost = Math.round(
    Math.min(
      25,
      Math.max(0, n / 4 + (d < 6 ? 10 : d < 12 ? 5 : 2) + (key ? 5 : 0)),
    ),
  );
  const atmos = {
    lantern_blackout: { fogDensity: 0.06, lightDim: 0.25, ashTurbulence: 1.2 },
    storm_surge: { fogDensity: 0.05, lightDim: 0.8, ashTurbulence: 1.6 },
    ash_vortex: { fogDensity: 0.055, lightDim: 0.6, ashTurbulence: 2.5 },
    chapel_omen: { fogDensity: 0.065, lightDim: 0.45, ashTurbulence: 1.8 },
  }[envEvent];
  return clampDirector({
    tactic,
    targetRoom: key ? "Chapel" : room,
    alertBoost,
    whisper,
    envEvent,
    ...atmos,
  });
}

const AI_DIRECTOR_SYSTEM = [
  "Horror game AI Director. Decide in ONE step, no deliberation.",
  "Output the JSON object FIRST and stop. Keys:",
  "tactic ambush_room|cut_off_chapel|stalk_shadow|inspect_hideout,",
  "targetRoom (room name), alertBoost 0..25,",
  "whisper (one short Hindi/English horror line reacting to the player's",
  "exact room, torch and key state),",
  "envEvent lantern_blackout|storm_surge|ash_vortex|chapel_omen,",
  "fogDensity 0.038..0.065, lightDim 0.25..1.0, ashTurbulence 1.0..2.8.",
].join(" ");

// Live Baseten call with a 3.5s AbortController timeout. Uses the
// BasetenMuseClient for key/baseUrl/model config; fetch is issued here so
// the abort signal can actually cancel the request (generateCompletion has
// no signal parameter). Throws on ANY failure — caller falls back.
async function callDirectorModel(telemetry) {
  const client = new BasetenMuseClient();
  if (!client.apiKey) throw new Error("no baseten key");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_DIRECTOR_TIMEOUT_MS);
  try {
    const response = await fetch(client.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({
        model: client.model,
        messages: [
          { role: "system", content: AI_DIRECTOR_SYSTEM },
          { role: "user", content: JSON.stringify(telemetry) },
        ],
        max_tokens: 768,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Baseten ${response.status}`);
    const data = await response.json();
    const msg = data.choices?.[0]?.message || {};
    // Reasoning model: final JSON may sit in reasoning_content with
    // content null. The director schema is FLAT (no nested objects),
    // so take the LAST flat {...} block (the concluded answer).
    const combined = `${msg.content || ""}\n${msg.reasoning_content || ""}`;
    const blocks = String(combined).match(/\{[^{}]*\}/g);
    if (!blocks || !blocks.length) throw new Error("no JSON in model output");
    return {
      decision: clampDirector(JSON.parse(blocks[blocks.length - 1])),
      model: client.model,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Judge AI assistant (public) ----------
// (module level: KB + fallback + rate-limit + cache helpers)
// POST /api/studio/judge-assistant answers judge questions about the
// build from grounded repo facts via meta-models/muse-spark-open-1026,
// with a deterministic keyword-routed KB fallback (<5ms) on ANY failure.
export const AI_ASSISTANT_MODEL_FALLBACK = "judge-assistant-kb-v1";
const AI_ASSISTANT_CACHE_TTL_MS = 60000;
const AI_ASSISTANT_TIMEOUT_MS = 4000;
const AI_ASSISTANT_MAX = 30;
const AI_ASSISTANT_WINDOW_MS = 60 * 1000;
const AI_ASSISTANT_QUESTION_MAX = 2000;
const assistantHits = new Map();
const assistantCache = new Map();

// Mirror of directorAllowed: 30 req/min per IP, 429 + retryAfter.
export function judgeAssistantAllowed(ip) {
  const now = Date.now();
  const arr = (assistantHits.get(ip) || []).filter(
    (t) => now - t < AI_ASSISTANT_WINDOW_MS,
  );
  if (arr.length >= AI_ASSISTANT_MAX) {
    assistantHits.set(ip, arr);
    const retryAfter = Math.max(
      1,
      Math.ceil((AI_ASSISTANT_WINDOW_MS - (now - arr[0])) / 1000),
    );
    return { allowed: false, retryAfter };
  }
  arr.push(now);
  assistantHits.set(ip, arr);
  return { allowed: true, retryAfter: 0 };
}

// Normalized cache key: case/whitespace-insensitive, length-capped.
export function buildAssistantSignature(question) {
  return String(question || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, AI_ASSISTANT_QUESTION_MAX);
}

// Deterministic knowledge base. Every citation is a real file:line in
// this repo (verified on disk); counts below are the verified values,
// including the honest corrections (35 Polyhaven dirs, 3 named bonus
// targets, README's stale 59/59 and stale .glb names).
const JUDGE_ASSISTANT_KB = [
  {
    id: "stack",
    match: [
      "9-model",
      "9 model",
      "nine",
      "model stack",
      "meta stack",
      "which models",
      "what models",
      "meta models",
      "which meta",
      "what meta",
      "models",
      "powered",
      "open weight",
      "open-weight",
    ],
    answer:
      "The repo documents 9 Meta models plus the SceneScript pipeline (README's table has 10 rows; row 10 is a DSL, not a model): " +
      "(1) muse-wonder-1.0, high-reasoning game architect; " +
      "(2) meta-models/muse-spark-open-1026 on Baseten, live AI director + enrichment; " +
      "(3) muse-image-1.0, concept art; " +
      "(4) muse-spark-1.3 via Muse Code CLI 1.4.14, game code; " +
      "(5) muse-voice-transcribe-1.0, voice prompts; " +
      "(6) sam-3.1, segmentation; " +
      "(7) SAM 3D Objects, image-to-3D .glb (2 green Modal trials); " +
      "(8) VGGT-1B, metric mesh reconstruction; " +
      "(9) facebook/musicgen-small (300M, 32kHz), AI music. " +
      "17 native MCP tools serve the CLI, 26 agent skills persist the workflow, and the Mega 3D hub indexes 825,000+ models.",
    citations: [
      "README.md:18",
      "src/agent/meta_wonder.js:24",
      "src/agent/baseten_muse.js:16",
      "src/tools/meta_voice_transcribe.js:144",
      "src/tools/segment_image.py:86",
      "src/tools/meta_musicgen_audio.py:22",
      "src/tools/studio_3d_mcp_server.py:30",
      "src/tools/fetch_mega_3d_hub.py:6",
    ],
  },
  {
    id: "sam31",
    match: [
      "sam 3.1",
      "sam3.1",
      "sam-3.1",
      "20-bone",
      "20 bone",
      "rig",
      "agatha",
      "segment",
      "evidence lens",
    ],
    answer:
      "SAM 3.1 (model sam-3.1 via the Meta Model API) segments concept frames into masks — see the veil, face, and lantern evidence frames (1120x2240 each). " +
      "The Mother Agatha builder then projects that sheet onto the hero mesh in Blender: pixel rows 184 to 2106 map to heights 1.72m down to 0.00m (1117.4 px per meter), centered on column 567. " +
      "The rig is a real Blender Armature of exactly 20 bones: 13 authored (root, hips, spine, chest, neck, head, plus left-side shoulder/arm/hand and thigh/shin/foot) with 7 mirrored to the right side, skinned by vertex groups with baked Idle/Walk NLA clips.",
    citations: [
      "src/tools/segment_image.py:86",
      "src/tools/build_agatha_sam31.py:48",
      "src/tools/build_agatha_sam31.py:574",
      "public/assets/evidence/sam31_veil.png:1",
    ],
  },
  {
    id: "gvisor",
    match: [
      "gvisor",
      "sandbox",
      "runsc",
      "kernel",
      "4.19",
      "isolated",
      "judge mode",
    ],
    answer:
      "Judge builds run inside Google gVisor: the runsc 4.19.0-gvisor runtime (Linux 4.19.0-gvisor kernel) with read-only mounts, executing the pinned Muse Code CLI binary muse-bin-1.4.14-R7309.1 — so unauthenticated visitors get full build power with zero VM risk. " +
      "The server only routes judge builds there when the runsc runtime, the vm-opencode image, and the sandbox binary are all present (checked fresh every 60s), and /api/studio/health reports the live gvisorSandbox flag. Owner routes stay behind AES-256-GCM GitHub-cookie auth.",
    citations: [
      "src/agent/agent_runner.js:426",
      "src/agent/agent_runner.js:50",
      "src/server.js:518",
      "test/gvisor_sandbox.test.js:31",
    ],
  },
  {
    id: "gates",
    match: [
      "gate",
      "verif",
      "qa",
      "physics",
      "visual",
      "test",
      "67",
      "deterministic",
      "bfs",
      "ccd",
    ],
    answer:
      "Three deterministic layers, all runnable locally: (1) the Visual QA Gate runs 6 checks — CSP (zero inline scripts/handlers), real .glb via GLTFLoader required, primitive box/cone fakes banned, 3D instanced wind-sway grass required, ACES tone mapping, and radial maps on every PointsMaterial. " +
      "(2) The Physics QA Gate runs 4 proofs — CCD zero-tunneling at 60Hz, camera clearance over terrain, jump-arc sanity, and BFS flood-fill reachability of every orb on the layout grid (orb count varies per layout). " +
      "(3) The automated suite (node --test --test-concurrency=1 test/) passes 81/81, verified Nov 3 — note README's '59/59' line is stale.",
    citations: [
      "src/verifier/visual_qa_gate.js:368",
      "src/verifier/physics_qa_gate.js:142",
      "package.json:11",
      "test/pipeline.test.js:24",
    ],
  },
  {
    id: "prizes",
    match: ["bonus", "prize", "criteria", "judg", "eligib", "impact", "weight"],
    answer:
      "Stated plainly: the repo names 3 bonus targets, not 5 — Best Agentic Use-Case, Best Build on Meta Open Weight Models, and Best Creative Build (Muse Image + Muse Wonder). There is no 5-prize list anywhere in the repo, so this page claims none. " +
      "The 4 official criteria it maps against are Impact (30%), Use of Meta AI Tooling (25%), Demo (25%), and Technical Depth & Execution (20%). " +
      "Track: Indie Developer; theme Push the Frontier; all commits Oct 26 – Nov 4, 2026.",
    citations: ["README.md:131", "README.md:9", "README.md:127"],
  },
];

const JUDGE_ASSISTANT_GENERIC = {
  answer:
    "I answer from a grounded repo-facts base: the 9-model Meta stack, SAM 3.1 + the 20-bone Agatha rig, the gVisor sandbox, the deterministic gates (6 visual checks, 4 physics proofs, 81/81 tests), and the judging map. " +
    "Try one of the five suggested questions above, or ask about any file, model, or gate by name.",
  citations: ["README.md:18", "src/server.js:2739"],
};

// Rich deterministic fallback: keyword-routed, pure function of the
// question, <5ms, never throws. Covers the 5 pill questions + generic.
export function judgeAssistantFallback(question) {
  try {
    const q = String(question || "").toLowerCase();
    if (!q.trim()) return { ...JUDGE_ASSISTANT_GENERIC };
    let best = null;
    let bestHits = 0;
    for (const topic of JUDGE_ASSISTANT_KB) {
      let hits = 0;
      for (const kw of topic.match) {
        if (kw && q.includes(kw)) hits += kw.length;
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = topic;
      }
    }
    const picked = bestHits > 0 && best ? best : JUDGE_ASSISTANT_GENERIC;
    return { answer: picked.answer, citations: [...picked.citations] };
  } catch {
    return { ...JUDGE_ASSISTANT_GENERIC };
  }
}

// Grounding facts for the live model call. Every count below was read
// from this repo (not from marketing copy): 9 models, 17 MCP tools,
// 26 skills, 825K+ hub, gVisor 4.19.0-gvisor, 20-bone rig, 35 Polyhaven
// dirs / 36 .glb, 6+4 gates, 81/81 tests, 3 named bonus targets.
const AI_ASSISTANT_SYSTEM = [
  "You are the Agentic Game Studio judges-brief assistant.",
  "Answer ONLY from these verified repo facts; never invent counts, files, or prizes.",
  "If the question is outside these facts, say so in one sentence and point at the closest fact.",
  "Keep answers under 120 words, plain sentences, no markdown headers.",
  "Begin with the answer itself; never restate these instructions, never show your reasoning, never use first-person planning language.",
  "FACTS:",
  "9 Meta models: muse-wonder-1.0 (architect), meta-models/muse-spark-open-1026 on Baseten (live AI director), muse-image-1.0 (concept art), muse-spark-1.3 via Muse Code CLI 1.4.14 (game code), muse-voice-transcribe-1.0 (voice prompts), sam-3.1 (segmentation), SAM 3D Objects (2 green Modal .glb trials), VGGT-1B (metric mesh), facebook/musicgen-small 300M 32kHz (music). Row 10 of the README table is the SceneScript DSL pipeline, not a model.",
  "Platform: 17 native MCP tools (studio_3d_mcp_server.py), 26 agent skills (.agents/skills), Mega 3D hub 825,000+ models (fetch_mega_3d_hub.py).",
  "Sandbox: Google gVisor runsc 4.19.0-gvisor, CLI binary muse-bin-1.4.14-R7309.1, health flag gvisorSandbox.",
  "Hero rig: Mother Agatha, real Blender Armature, exactly 20 bones (13 authored + 7 mirrored), SAM 3.1 sheet 1120x2240 projected rows 184->2106 to heights 1.72m->0.00m.",
  "Photogrammetry: public/assets/polyhaven holds 35 model dirs with 36 .glb files (34 at 1K).",
  "Gates: Visual QA Gate 6 checks (CSP, real .glb, no primitive fakes, 3D grass, ACES, radial particle maps); Physics QA Gate 4 proofs (CCD zero-tunneling, camera clearance, jump arc, BFS orb reachability); suite node --test --test-concurrency=1 test/ passes 81/81 (README's 59/59 is stale).",
  "Judging: 4 official criteria Impact 30%, Meta AI Tooling 25%, Demo 25%, Technical Depth 20%; exactly 3 named bonus targets (Best Agentic Use-Case, Best Build on Meta Open Weight Models, Best Creative Build) — no 5-prize list exists in the repo. Track Indie Developer, theme Push the Frontier, commits Oct 26 - Nov 4 2026.",
].join(" ");

// Live Baseten call with a 4s AbortController timeout. Mirrors
// callDirectorModel: fetch is issued here so the signal can cancel it.
// Throws on ANY failure — caller uses the KB fallback.
async function callAssistantModel(question) {
  const client = new BasetenMuseClient();
  if (!client.apiKey) throw new Error("no baseten key");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_ASSISTANT_TIMEOUT_MS);
  try {
    const response = await fetch(client.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({
        model: client.model,
        messages: [
          { role: "system", content: AI_ASSISTANT_SYSTEM },
          {
            role: "user",
            content: String(question).slice(0, AI_ASSISTANT_QUESTION_MAX),
          },
        ],
        max_tokens: 768,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Baseten ${response.status}`);
    const data = await response.json();
    const msg = data.choices?.[0]?.message || {};
    // User-facing answer: final content ONLY. Reasoning traces are never
    // shown — empty content falls through to the KB fallback via throw.
    const text = String(msg.content || "").trim();
    if (!text) throw new Error("no text in model output");
    return {
      answer: text.slice(0, 1500),
      model: client.model,
    };
  } finally {
    clearTimeout(timer);
  }
}

// gVisor sandbox detection (cached 60s): runsc runtime + vm-opencode image
// + sandbox CLI binary must ALL be present for judge builds to use gVisor.
let gvisorDetected = null;
let gvisorDetectedAt = 0;
function detectGvisorSandbox() {
  const now = Date.now();
  if (gvisorDetected !== null && now - gvisorDetectedAt < 60000) {
    return gvisorDetected;
  }
  let ok = false;
  try {
    const runtimes = execFileSync(
      "docker",
      ["info", "--format", "{{.Runtimes}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 },
    );
    let hasImage = false;
    try {
      execFileSync("docker", ["image", "inspect", "vm-opencode"], {
        stdio: "ignore",
        timeout: 15000,
      });
      hasImage = true;
    } catch {
      hasImage = false;
    }
    const hasBin = fs.existsSync(
      "/home/opencode/project-data/.gvisor-sandbox/bin/muse-bin-1.4.14-R7309.1",
    );
    ok = /runsc/.test(String(runtimes || "")) && hasImage && hasBin;
  } catch {
    ok = false;
  }
  gvisorDetected = ok;
  gvisorDetectedAt = now;
  return ok;
}

// ---------- Library auto-save (Task 1) ----------
// Upserts the current public/live-preview/ game into storage/games/.
// Same title reuses its existing gameId (no duplicate cards); a new title
// creates a new entry. Best-effort: never throws, returns null on no-op.
const LIVE_PREVIEW_DIR = path.join(PUBLIC_DIR, "live-preview");
let lastAutoSaveStamp = 0;

function readLivePreviewTitle() {
  try {
    const html = fs.readFileSync(
      path.join(LIVE_PREVIEW_DIR, "index.html"),
      "utf8",
    );
    const m = html.match(/<title>([^<]+)<\/title>/i);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* ignore */
  }
  return "Untitled Game";
}

function copyLivePreviewInto(gameDir) {
  // Full-fidelity copy: every live-preview file (any extension, including
  // secondary .html viewers) plus the whole assets/ tree, so a later
  // activate restores the game bit-for-bit. Manifest schema still matches
  // publish-game.js exactly.
  const copied = [];
  const copyTree = (src, dest, prefix) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        copyTree(
          path.join(src, entry.name),
          path.join(dest, entry.name),
          prefix + entry.name + "/",
        );
      } else if (entry.isFile()) {
        fs.copyFileSync(
          path.join(src, entry.name),
          path.join(dest, entry.name),
        );
        copied.push(prefix + entry.name);
      }
    }
  };
  for (const entry of fs.readdirSync(LIVE_PREVIEW_DIR, {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      copyTree(
        path.join(LIVE_PREVIEW_DIR, entry.name),
        path.join(gameDir, entry.name),
        entry.name + "/",
      );
    } else if (entry.isFile()) {
      fs.copyFileSync(
        path.join(LIVE_PREVIEW_DIR, entry.name),
        path.join(gameDir, entry.name),
      );
      copied.push(entry.name);
    }
  }
  return copied;
}

function readGamesIndexSync() {
  try {
    const raw =
      fs.readFileSync(path.join(STORAGE_DIR, "index.json"), "utf8") || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function autoSaveLivePreviewToLibrary() {
  try {
    if (!fs.existsSync(path.join(LIVE_PREVIEW_DIR, "index.html"))) return null;
    const title = readLivePreviewTitle() || "Untitled Game";
    const index = readGamesIndexSync();
    const existing = index.find((e) => e && e.title === title);
    const gameId =
      existing && existing.id
        ? existing.id
        : "game_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
    const gameDir = path.join(STORAGE_DIR, gameId);
    fs.mkdirSync(gameDir, { recursive: true });
    const copied = copyLivePreviewInto(gameDir);
    if (!copied.includes("index.html")) return null;
    const hasJs = copied.some((f) => f.endsWith(".js"));
    const concept = copied.find((f) => f.startsWith("assets/concept"));
    const manifest = {
      id: gameId,
      title,
      prompt: (existing && existing.prompt) || "",
      biome: (existing && existing.biome) || "live-preview",
      metaModel: (existing && existing.metaModel) || "hand-made",
      enrichmentModel: (existing && existing.enrichmentModel) || null,
      objective: (existing && existing.objective) || "",
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      playUrl: `/studio/games/${gameId}/index.html`,
      imageUrl: concept
        ? `/studio/games/${gameId}/${concept}`
        : (existing && existing.imageUrl) || null,
      files: {
        html: "index.html",
        manifest: "manifest.json",
        unity: (existing && existing.files && existing.files.unity) || [],
      },
    };
    if (hasJs) {
      manifest.files.js = copied.includes("game.js")
        ? "game.js"
        : copied.find((f) => f.endsWith(".js"));
    }
    fs.writeFileSync(
      path.join(gameDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    const next = index.filter((e) => e && e.id !== gameId);
    next.unshift(manifest);
    fs.writeFileSync(
      path.join(STORAGE_DIR, "index.json"),
      JSON.stringify(next, null, 2),
      "utf8",
    );
    return { id: gameId, title, updated: Boolean(existing) };
  } catch {
    return null;
  }
}

// Parses the "[ags-meta ...]" first line written by session/new archives.
// windowId links the archive to its still-live tmux window (@0/@1/...);
// old logs without it return windowId null.
function parseChatMeta(text) {
  const m = String(text || "").match(
    /^\[ags-meta gameId="([^"]*)" gameTitle="([^"]*)"[^\]]*\]/m,
  );
  if (!m) return { gameId: null, gameTitle: null, windowId: null };
  const w = String(text || "").match(/\[ags-meta[^\]]*windowId="([^"]+)"\]/);
  return {
    gameId: m[1] || null,
    gameTitle: m[2] || null,
    windowId: w ? w[1] : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Agent loop command shared by session + window creation (single source).
function tmuxAgentLoopCmd() {
  const museBin = path.join(
    process.env.HOME || "/home/opencode",
    ".local",
    "bin",
    "muse",
  );
  return `bash -lc 'while true; do ${museBin} --trust-workspace --yolo --model ${activeTerminalModel}; sleep 1; done'`;
}

// ---------- tmux multi-window helpers ----------
// New chat NEVER kills the session: the current window is snapshotted and a
// fresh window opens beside it. A chat ends only when its window ends.
function listTmuxWindows() {
  try {
    const out = execFileSync(
      "tmux",
      [
        "list-windows",
        "-t",
        TMUX_SESSION,
        "-F",
        "#{window_id}|#{window_active}|#{window_name}",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    return String(out || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, active, name] = l.split("|");
        return { id, active: active === "1", name: name || "" };
      })
      .filter((w) => w.id);
  } catch {
    return [];
  }
}

function getActiveTmuxWindowId() {
  const wins = listTmuxWindows();
  const a = wins.find((w) => w.active);
  return a ? a.id : null;
}

function ensureTmuxSession() {
  try {
    execFileSync("tmux", ["has-session", "-t", TMUX_SESSION], {
      stdio: "ignore",
    });
  } catch {
    execFileSync("tmux", [
      "new-session",
      "-d",
      "-s",
      TMUX_SESSION,
      "-x",
      "120",
      "-y",
      "32",
      "-c",
      ROOT_DIR,
      tmuxAgentLoopCmd(),
    ]);
    try {
      execFileSync("tmux", ["set-option", "-t", TMUX_SESSION, "status", "off"]);
      execFileSync("tmux", ["set-option", "-t", TMUX_SESSION, "mouse", "on"]);
    } catch {
      /* ignore */
    }
  }
}

async function sendLineToTmux(line) {
  ensureTmuxSession();
  const clean = String(line || "")
    .replace(/\r?\n+/g, " ")
    .trim();
  if (!clean) return;
  try {
    execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "-X", "cancel"], {
      stdio: "ignore",
    });
  } catch {
    /* ignore if not in copy-mode */
  }
  execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "-l", clean]);
  await sleep(300);
  execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "C-m"]);
}

function getTmuxScrollState() {
  try {
    const out = execFileSync(
      "tmux",
      [
        "display-message",
        "-t",
        TMUX_SESSION,
        "-p",
        "#{pane_in_mode}|#{scroll_position}|#{history_size}|#{pane_height}",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      },
    );
    const p = String(out || "")
      .trim()
      .split("|");
    return {
      inMode: Number(p[0]) === 1,
      pos: Number(p[1] || 0),
      history: Number(p[2] || 0),
      height: Number(p[3] || 32),
    };
  } catch {
    return { inMode: false, pos: 0, history: 0, height: 32 };
  }
}

function isTmuxCliBusy() {
  try {
    const out = execFileSync(
      "tmux",
      ["capture-pane", "-t", TMUX_SESSION, "-p"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      },
    );
    const lines = String(out || "")
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    const tail = lines.slice(-6).join("\n");
    if (!tail) return false;
    if (
      /esc to interrupt|interrupt|thinking|working|running|generating|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒]/i.test(
        tail,
      ) &&
      !/interrupted/i.test(tail)
    ) {
      return true;
    }
    const hasPrompt = lines.slice(-6).some((l) => /^\s*❯(\s|$)/.test(l));
    return !hasPrompt;
  } catch {
    return false;
  }
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".mjs": "application/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".hdr": "application/octet-stream",
  ".exr": "application/octet-stream",
  ".wav": "audio/wav",
  ".splat": "application/octet-stream",
  ".ply": "application/octet-stream",
};

function sendFile(res, filePath) {
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    try {
      if (!res.writableEnded) res.end();
      else res.destroy();
    } catch {
      /* ignore */
    }
  });
  stream.pipe(res);
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

// ---------- Studio Git & GitHub helpers (pure fns exported for tests) ----------
const STUDIO_REPO_URL = "https://github.com/shubham91150/agentic-game-studio";
const GIT_LOG_FORMAT = "%H|%h|%s|%an|%ad";
const GIT_EXPORT_VENDOR_FILES = [
  "three.min.js",
  "GLTFLoader.js",
  "DRACOLoader.js",
  "CopyShader.js",
  "LuminosityHighPassShader.js",
  "EffectComposer.js",
  "RenderPass.js",
  "ShaderPass.js",
  "UnrealBloomPass.js",
  "world_realism.js",
];

// Parse `git status --porcelain` output into [{status, path}].
// Never throws on unexpected input.
export function parseGitStatus(porcelain) {
  if (!porcelain || typeof porcelain !== "string") return [];
  const files = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim() || "?";
    const p = line.slice(3).trim();
    if (!p) continue;
    files.push({ status, path: p });
  }
  return files;
}

// Parse one `git log --format=%H|%h|%s|%an|%ad` line into a commit object.
// Message may itself contain "|" so ends are peeled off, middle is message.
export function formatCommit(line) {
  const chunks = String(line || "").split("|");
  const sha = (chunks.shift() || "").trim();
  const shortSha = (chunks.shift() || "").trim();
  const date = chunks.length >= 2 ? String(chunks.pop()).trim() : "";
  const author = chunks.length >= 1 ? String(chunks.pop()).trim() : "";
  const message = chunks.join("|").trim();
  return {
    sha,
    shortSha,
    message,
    author,
    date,
    url: `${STUDIO_REPO_URL}/commit/${sha}`,
  };
}

// Slugify an export repo name to [a-z0-9-]. Returns "" when nothing usable.
export function slugifyGitRepoName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Scrub anything token-shaped from git/gh output before returning to clients.
function scrubSecrets(text) {
  return String(text || "").replace(
    /(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g,
    "[redacted]",
  );
}

function gitRunSync(args, timeoutMs) {
  return execFileSync("git", ["-C", ROOT_DIR, ...args], {
    encoding: "utf8",
    timeout: timeoutMs || 15000,
  });
}

// Fresh git status payload shared by the status route and the sync route.
// Never throws: git failure becomes {ok:false, error}.
function getGitStatusJson() {
  try {
    const branch = String(gitRunSync(["branch", "--show-current"])).trim();
    const headLine = String(
      gitRunSync(["log", "-1", `--format=${GIT_LOG_FORMAT}`, "--date=iso"]),
    ).trim();
    const headFull = formatCommit(headLine);
    const head = {
      sha: headFull.sha,
      shortSha: headFull.shortSha,
      message: headFull.message,
      author: headFull.author,
      date: headFull.date,
    };
    const changedFiles = parseGitStatus(
      String(gitRunSync(["status", "--porcelain"])),
    );
    const logOut = String(
      gitRunSync(["log", "-10", `--format=${GIT_LOG_FORMAT}`, "--date=iso"]),
    );
    const commits = logOut
      .split("\n")
      .filter((l) => l.trim())
      .map(formatCommit);
    return {
      ok: true,
      repoUrl: STUDIO_REPO_URL,
      branch,
      head,
      dirtyCount: changedFiles.length,
      changedFiles,
      commits,
    };
  } catch (err) {
    return {
      ok: false,
      error: scrubSecrets(String((err && err.message) || err).slice(0, 500)),
    };
  }
}

function ghCliAvailable() {
  try {
    execFileSync("gh", ["--version"], { encoding: "utf8", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = url.pathname;

  // CORS so the Vercel-hosted UI can also call this backend directly.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // ---------- Studio UI ----------
  if (pathname === "/" || pathname === "/studio" || pathname === "/studio/") {
    return sendFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  // ---------- Studio static assets (studio.js, tailwind.config.js, app.css, hackathon brief, metaworld viewer, etc.) ----------
  if (
    pathname === "/studio/studio.js" ||
    pathname === "/studio.js" ||
    pathname === "/studio/tailwind.config.js" ||
    pathname === "/studio/app.css" ||
    pathname === "/studio/hackathon.html" ||
    pathname === "/studio/hackathon.js" ||
    pathname === "/studio/metaworld.html" ||
    pathname === "/studio/metaworld.js" ||
    pathname === "/metaworld.html" ||
    pathname === "/metaworld.js"
  ) {
    const fname =
      pathname === "/studio/app.css"
        ? "app.css"
        : pathname === "/studio/tailwind.config.js"
          ? "tailwind.config.js"
          : pathname === "/studio/hackathon.html"
            ? "hackathon.html"
            : pathname === "/studio/hackathon.js"
              ? "hackathon.js"
              : pathname === "/studio/metaworld.html" ||
                  pathname === "/metaworld.html"
                ? "metaworld.html"
                : pathname === "/studio/metaworld.js" ||
                    pathname === "/metaworld.js"
                  ? "metaworld.js"
                  : "studio.js";
    return sendFile(res, path.join(PUBLIC_DIR, fname));
  }

  // ---------- Self-hosted fonts + icons (CSP-safe, no CDN) ----------
  const fontsMatch = pathname.match(
    /^\/studio\/fonts\/([\w.\-]+\.(?:woff2|css))$/,
  );
  if (fontsMatch) {
    const target = path.resolve(PUBLIC_DIR, "fonts", fontsMatch[1]);
    if (!target.startsWith(path.resolve(PUBLIC_DIR, "fonts"))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- PWA offline (manifest, icon, service worker — no build step) ----------
  const pwaMatch = pathname.match(
    /^\/studio\/(sw\.js|manifest\.webmanifest|icon\.svg)$/,
  );
  if (pwaMatch) {
    return sendFile(res, path.join(PUBLIC_DIR, pwaMatch[1]));
  }

  // ---------- Health ----------
  if (pathname === "/api/studio/health") {
    let musePresent = false;
    try {
      musePresent = fs.existsSync(
        path.join(process.env.HOME || "/root", ".local", "bin", "muse"),
      );
    } catch {
      musePresent = false;
    }
    return json(res, 200, {
      ok: true,
      service: "agentic-game-studio-backend",
      components: {
        museCodeCLI: musePresent,
        gvisorSandbox: detectGvisorSandbox(),
        cliModel: process.env.MUSE_CLI_MODEL || "muse-spark-1.3",
        cliProvider: "meta-model-api",
        metaKeyPresent: Boolean(resolveMetaApiKey()),
        plannerModel: "meta-models/muse-spark-open-1026",
        plannerProvider: "baseten",
        basetenKeyPresent: Boolean(
          process.env.BASETEN_API_KEY ||
          fs.existsSync(
            "/home/opencode/project-data/workspace/.orchestrator/vault.mjs",
          ),
        ),
        terrain: "procedural elevation grid",
        engines: ["threejs-webgl", "unity-csharp"],
      },
      time: new Date().toISOString(),
    });
  }

  // ---------- Composer capabilities (skills, MCPs, models) ----------
  if (pathname === "/api/studio/capabilities" && req.method === "GET") {
    const skills = [];
    for (const dir of [".agents/skills", "skills"]) {
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(ROOT_DIR, dir), {
          withFileTypes: true,
        });
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const id = e.name;
        if (skills.some((s) => s.id === id)) continue;
        let description = "";
        try {
          const md = fs.readFileSync(
            path.join(ROOT_DIR, dir, id, "SKILL.md"),
            "utf8",
          );
          const m = md.match(/^description:\s*(.+)$/m);
          if (m) description = m[1].trim().slice(0, 160);
        } catch {
          description = "";
        }
        skills.push({ id, description });
      }
    }
    let mcpServers = [];
    try {
      const settingsPath = path.join(
        process.env.HOME || "/root",
        ".config",
        "muse",
        "settings.json",
      );
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      mcpServers = Object.keys(settings.mcpServers || {});
    } catch {
      mcpServers = [];
    }
    return json(res, 200, { skills, mcpServers, models: ALLOWED_CLI_MODELS });
  }

  // ---------- MCP server management (Muse Code settings) ----------
  // Reads/writes ~/.config/muse/settings.json mcpServers. Secrets (headers,
  // env) are never returned to the client. A new CLI session picks changes up.
  function mcpSettingsPath() {
    return path.join(
      process.env.HOME || "/root",
      ".config",
      "muse",
      "settings.json",
    );
  }
  function readMcpServers() {
    const raw = fs.readFileSync(mcpSettingsPath(), "utf8");
    const settings = JSON.parse(raw);
    const servers = settings.mcpServers || {};
    // env/headers are NEVER returned (may hold tokens); secret-looking arg
    // values are redacted. Only these safe fields leave the server.
    return Object.entries(servers).map(([name, cfg]) => ({
      name,
      transport: cfg.transport || "streamable_http",
      url: cfg.url || "",
      command: cfg.command || "",
      args: Array.isArray(cfg.args)
        ? cfg.args.map((a) =>
            typeof a === "string" &&
            /token|secret|passwd|password|api[-_]?key|bearer|private[-_]?key/i.test(
              a,
            )
              ? "[redacted]"
              : a,
          )
        : [],
      enabled: cfg.enabled !== false,
    }));
  }

  // stdio MCP commands: strict allowlist + shell-metacharacter block.
  const MCP_COMMAND_ALLOWLIST = ["npx", "node", "python3", "uvx"];
  function mcpHasShellMetachars(s) {
    return /[;|&`$\r\n]/.test(s);
  }
  function validateMcpCommand(command, rawArgs) {
    if (/\s/.test(command)) {
      return "MCP command must be a single binary name without spaces.";
    }
    const base = command.split("/").pop();
    if (!MCP_COMMAND_ALLOWLIST.includes(base)) {
      return `MCP command not in allowlist (${MCP_COMMAND_ALLOWLIST.join(", ")}).`;
    }
    if (mcpHasShellMetachars(command)) {
      return "MCP command contains blocked shell metacharacters.";
    }
    if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
      return "MCP args must be an array of strings.";
    }
    for (const a of Array.isArray(rawArgs) ? rawArgs : []) {
      if (typeof a !== "string") {
        return "MCP args must be an array of strings.";
      }
      if (a.length > 1024) return "MCP arg too long.";
      if (mcpHasShellMetachars(a)) {
        return "MCP args contain blocked shell metacharacters (;, |, &, `, $).";
      }
    }
    return null;
  }
  if (pathname === "/api/studio/mcp" && req.method === "GET") {
    try {
      return json(res, 200, { servers: readMcpServers() });
    } catch {
      return json(res, 500, { error: "Could not read MCP settings." });
    }
  }
  if (pathname === "/api/studio/mcp" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const name = String(payload.name || "")
        .toLowerCase()
        .trim();
      const url = String(payload.url || "").trim();
      const command = String(payload.command || "").trim();
      if (!/^[a-z0-9][a-z0-9-_]{1,40}$/.test(name)) {
        return json(res, 400, {
          error: "Name must be 2-41 chars: lowercase, digits, - _.",
        });
      }
      if (url && command) {
        return json(res, 400, {
          error: "Provide either url or command, not both.",
        });
      }
      let entry = null;
      if (command) {
        const cmdError = validateMcpCommand(command, payload.args);
        if (cmdError) return json(res, 400, { error: cmdError });
        entry = {
          transport: "stdio",
          command,
          args: Array.isArray(payload.args) ? payload.args.map(String) : [],
        };
      } else {
        let parsed = null;
        try {
          parsed = new URL(url);
        } catch {
          parsed = null;
        }
        if (
          !parsed ||
          (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
          parsed.username ||
          parsed.password
        ) {
          return json(res, 400, {
            error: "URL must be plain http(s) without credentials.",
          });
        }
        entry = { transport: "streamable_http", url: parsed.toString() };
      }
      try {
        const file = mcpSettingsPath();
        const settings = JSON.parse(fs.readFileSync(file, "utf8"));
        if (settings.schema_version !== 1) {
          return json(res, 500, { error: "Unsupported settings schema." });
        }
        if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
          settings.mcpServers = {};
        }
        settings.mcpServers[name] = entry;
        fs.copyFileSync(file, `${file}.bak`);
        fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
        return json(res, 200, { ok: true, servers: readMcpServers() });
      } catch {
        return json(res, 500, { error: "Could not update MCP settings." });
      }
    });
    return;
  }
  const mcpDel = pathname.match(
    /^\/api\/studio\/mcp\/([a-z0-9][a-z0-9-_]{1,40})$/,
  );
  if (mcpDel && req.method === "DELETE") {
    if (ownerGuard(req, res)) return;
    try {
      const file = mcpSettingsPath();
      const settings = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!settings.mcpServers || !settings.mcpServers[mcpDel[1]]) {
        return json(res, 404, { error: "MCP server not found." });
      }
      delete settings.mcpServers[mcpDel[1]];
      fs.copyFileSync(file, `${file}.bak`);
      fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
      return json(res, 200, { ok: true, servers: readMcpServers() });
    } catch {
      return json(res, 500, { error: "Could not update MCP settings." });
    }
  }

  // ---------- Library list ----------
  if (pathname === "/api/studio/games" && req.method === "GET") {
    const games = await gameStore.listGames();
    return json(res, 200, games);
  }

  // ---------- Single game manifest ----------
  const manifestMatch = pathname.match(/^\/api\/studio\/games\/([\w-]+)$/);
  if (manifestMatch && req.method === "GET") {
    const found = await gameStore.getGame(manifestMatch[1]);
    if (!found) return json(res, 404, { error: "Game not found" });
    return json(res, 200, found.manifest);
  }

  // ---------- Activate a library game into the live preview (Task 2) ----------
  // POST /api/studio/games/:id/activate — first auto-saves the current
  // live-preview game, then copies storage/games/:id/ files (all of them,
  // not just index.html + game.js) into public/live-preview/ so multi-file
  // library games play 100% and can be continued/edited from the composer.
  function copyStoredGameIntoLivePreview(gameId) {
    const gameDir = path.join(STORAGE_DIR, gameId);
    fs.mkdirSync(LIVE_PREVIEW_DIR, { recursive: true });
    for (const entry of fs.readdirSync(LIVE_PREVIEW_DIR)) {
      fs.rmSync(path.join(LIVE_PREVIEW_DIR, entry), {
        recursive: true,
        force: true,
      });
    }
    const copyTree = (src, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (ent.isDirectory()) {
          copyTree(path.join(src, ent.name), path.join(dest, ent.name));
        } else if (ent.isFile()) {
          fs.copyFileSync(path.join(src, ent.name), path.join(dest, ent.name));
        }
      }
    };
    for (const ent of fs.readdirSync(gameDir, { withFileTypes: true })) {
      if (ent.name === "manifest.json" || ent.name === "unity") continue;
      const src = path.join(gameDir, ent.name);
      const dest = path.join(LIVE_PREVIEW_DIR, ent.name);
      if (ent.isDirectory()) copyTree(src, dest);
      else if (ent.isFile()) fs.copyFileSync(src, dest);
    }
    if (!fs.existsSync(path.join(LIVE_PREVIEW_DIR, "index.html"))) {
      throw new Error("Stored game has no index.html.");
    }
    // Fresh mtimes -> refresh the auto-save stamp so the next
    // preview-state poll treats this activation as already saved.
    let stamp = 0;
    try {
      for (const f of fs.readdirSync(LIVE_PREVIEW_DIR)) {
        const st = fs.statSync(path.join(LIVE_PREVIEW_DIR, f));
        if (st.mtimeMs > stamp) stamp = Math.floor(st.mtimeMs);
      }
    } catch {
      /* ignore */
    }
    lastAutoSaveStamp = stamp;
  }

  // Shared by the activate route and chat-continue: auto-save current work,
  // then copy the stored game into the live preview. Throws with .statusCode.
  async function activateStoredGame(gameId) {
    const found = await gameStore.getGame(gameId);
    if (!found) {
      const err = new Error("Game not found");
      err.statusCode = 404;
      throw err;
    }
    let saved = null;
    try {
      saved = autoSaveLivePreviewToLibrary();
    } catch {
      saved = null;
    }
    try {
      copyStoredGameIntoLivePreview(gameId);
    } catch (e) {
      if (e && e.message === "Stored game has no index.html.") throw e;
      throw new Error("Could not activate this game.");
    }
    return { found, saved };
  }

  const activateMatch = pathname.match(
    /^\/api\/studio\/games\/([\w-]+)\/activate$/,
  );
  if (activateMatch && req.method === "POST") {
    req.resume();
    const gameId = activateMatch[1];
    if (!isOwnerRequest(req)) {
      // Public judge/visitor: NEVER touch the VM's live-preview files —
      // hand back a direct read-only play URL for the stored game instead.
      const found = await gameStore.getGame(gameId);
      if (!found) return json(res, 404, { ok: false, error: "Game not found" });
      return json(res, 200, {
        ok: true,
        id: gameId,
        title: (found.manifest && found.manifest.title) || "Game Preview",
        url: `/studio/games/${gameId}/index.html`,
        readOnly: true,
      });
    }
    let found;
    let saved;
    try {
      ({ found, saved } = await activateStoredGame(gameId));
    } catch (e) {
      return json(res, (e && e.statusCode) || 500, {
        ok: false,
        error: (e && e.message) || "Could not activate this game.",
      });
    }
    return json(res, 200, {
      ok: true,
      gameId,
      title: (found.manifest && found.manifest.title) || "Game Preview",
      url: "/studio/live-preview/index.html",
      savedGame: saved ? { id: saved.id, title: saved.title } : null,
    });
  }

  // ---------- Stored game code (Unity C# written for that game) ----------
  const codeMatch = pathname.match(/^\/api\/studio\/games\/([\w-]+)\/code$/);
  if (codeMatch && req.method === "GET") {
    const found = await gameStore.getGame(codeMatch[1]);
    if (!found) return json(res, 404, { error: "Game not found" });
    const unityPath = path.join(
      STORAGE_DIR,
      codeMatch[1],
      "unity",
      "AgenticPlayerController.cs",
    );
    const unity = fs.existsSync(unityPath)
      ? fs.readFileSync(unityPath, "utf8")
      : "";
    return json(res, 200, { manifest: found.manifest, unity, spec: null });
  }

  // ---------- Unity script download ----------
  const unityMatch = pathname.match(/^\/api\/studio\/export\/unity\/([\w-]+)$/);
  if (unityMatch) {
    const scriptPath = path.join(
      STORAGE_DIR,
      unityMatch[1],
      "unity",
      "AgenticPlayerController.cs",
    );
    if (!fs.existsSync(scriptPath)) {
      return json(res, 404, { error: "Unity script not found for this game" });
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": "attachment; filename=AgenticPlayerController.cs",
    });
    return fs.createReadStream(scriptPath).pipe(res);
  }

  // ---------- Download current live-preview game as a .zip ----------
  // Zips public/live-preview/ on the fly and returns it as a downloadable
  // .zip archive so judges/users can grab the playable game offline.
  if (pathname === "/api/studio/download" && req.method === "GET") {
    const liveDir = path.join(PUBLIC_DIR, "live-preview");
    if (!fs.existsSync(liveDir)) {
      return json(res, 404, { error: "No game in preview to download" });
    }
    try {
      const zip = new AdmZip();
      const addDirRecursive = (dir, zipPath) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          const entryPath = zipPath ? zipPath + "/" + ent.name : ent.name;
          if (ent.isDirectory()) {
            addDirRecursive(full, entryPath);
          } else if (ent.isFile()) {
            const buf = fs.readFileSync(full);
            zip.addFile(entryPath, buf);
          }
        }
      };
      addDirRecursive(liveDir, "");
      let title = "game";
      try {
        const idxHtml = fs.readFileSync(
          path.join(liveDir, "index.html"),
          "utf8",
        );
        const m = /<title>([^<]+)<\/title>/i.exec(idxHtml);
        if (m && m[1]) title = m[1].trim();
      } catch {
        /* keep default */
      }
      const slug =
        String(title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .substring(0, 40) || "game";
      const zipBuf = zip.toBuffer();
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${slug}.zip"`,
        "content-length": String(zipBuf.length),
        "cache-control": "no-store",
      });
      return res.end(zipBuf);
    } catch (err) {
      console.error("Download zip error:", err);
      return json(res, 500, { error: "Failed to build game archive" });
    }
  }

  // ---------- Vendor assets (Three.js, GLTFLoader, World Realism, Rapier physics) ----------
  const vendorMatch = pathname.match(
    /^\/studio\/vendor\/(three\.min\.js|GLTFLoader\.js|world_realism\.js|rapier3d-compat\.mjs|rapier_wasm3d_bg\.wasm|DRACOLoader\.js|RGBELoader\.js|draco_decoder\.js|draco_decoder\.wasm|CopyShader\.js|LuminosityHighPassShader\.js|EffectComposer\.js|RenderPass\.js|ShaderPass\.js|UnrealBloomPass\.js)$/,
  );
  if (vendorMatch) {
    const vendorPath = path.join(
      ROOT_DIR,
      "src",
      "engine",
      "vendor",
      vendorMatch[1],
    );
    return sendFile(res, vendorPath);
  }

  // ---------- Studio 3D & PBR assets (public/assets/*) ----------
  const studioAssetsMatch = pathname.match(/^\/studio\/assets\/([\w.\-/]+)$/);
  if (studioAssetsMatch) {
    const assetsDir = path.join(PUBLIC_DIR, "assets");
    const target = path.resolve(assetsDir, studioAssetsMatch[1]);
    if (
      !target.startsWith(path.resolve(assetsDir) + path.sep) &&
      target !== path.resolve(assetsDir)
    ) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Live CLI preview stage (public/live-preview/*) ----------
  const livePreviewDir = path.join(PUBLIC_DIR, "live-preview");
  if (pathname === "/api/studio/preview-state" && req.method === "GET") {
    const cliBusy = Boolean(isTmuxCliBusy());
    const terminalScroll = getTmuxScrollState();
    const indexPath = path.join(livePreviewDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      return json(res, 200, {
        ready: false,
        updatedAt: 0,
        cliBusy,
        terminalScroll,
      });
    }
    let updatedAt = 0;
    let title = "Game Preview";
    try {
      for (const f of fs.readdirSync(livePreviewDir)) {
        const st = fs.statSync(path.join(livePreviewDir, f));
        if (st.mtimeMs > updatedAt) updatedAt = Math.floor(st.mtimeMs);
      }
      const html = fs.readFileSync(indexPath, "utf8");
      const m = html.match(/<title>([^<]+)<\/title>/i);
      if (m && m[1].trim()) title = m[1].trim();
    } catch {
      /* ignore */
    }
    // Auto-save (Task 1): stamp changed + index.html ready -> upsert the
    // library entry. Same title reuses its gameId (no duplicate cards).
    // Owner-only side effect: public visitors may poll (read stamps) but
    // their polls must never write to the library.
    if (isOwnerRequest(req) && updatedAt > lastAutoSaveStamp) {
      lastAutoSaveStamp = updatedAt;
      try {
        autoSaveLivePreviewToLibrary();
      } catch {
        /* best-effort: never break preview-state */
      }
    }
    return json(res, 200, {
      ready: true,
      updatedAt,
      title,
      url: "/studio/live-preview/index.html",
      cliBusy,
      terminalScroll,
    });
  }

  const livePreviewMatch = pathname.match(
    /^\/studio\/live-preview\/([\w.\-/]+)$/,
  );
  if (livePreviewMatch) {
    const target = path.resolve(livePreviewDir, livePreviewMatch[1]);
    if (!target.startsWith(path.resolve(livePreviewDir))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Publish current live-preview game to the library ----------
  // POST /api/studio/publish — copies public/live-preview/ into
  // storage/games/<id>/ using the same logic as src/tools/publish-game.js
  // (manifest schema matched exactly), so the live game appears in the
  // Library drawer. Title comes from the live-preview <title> tag
  // (fallback "Untitled Game"). Validates: title not empty, files exist.
  if (pathname === "/api/studio/publish" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    req.resume();
    try {
      const indexPath = path.join(livePreviewDir, "index.html");
      if (!fs.existsSync(indexPath)) {
        return json(res, 400, {
          ok: false,
          error: "No live preview to publish. Build a game first.",
        });
      }

      // Title from the live-preview <title> tag (fallback "Untitled Game").
      let title = "Untitled Game";
      try {
        const html = fs.readFileSync(indexPath, "utf8");
        const m = html.match(/<title>([^<]+)<\/title>/i);
        if (m && m[1].trim()) title = m[1].trim();
      } catch {
        /* keep fallback */
      }
      if (!title) title = "Untitled Game";

      // Co-located asset extensions copied verbatim (matches publish-game.js).
      const ASSET_EXTS = new Set([
        ".js",
        ".css",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".svg",
        ".json",
        ".glb",
        ".mp3",
        ".wav",
        ".ogg",
      ]);

      const gameId =
        "game_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
      const gameDir = path.join(STORAGE_DIR, gameId);
      fs.mkdirSync(gameDir, { recursive: true });

      // Copy index.html + co-located assets verbatim (flat, top level).
      const copied = [];
      for (const entry of fs.readdirSync(livePreviewDir, {
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (entry.name === "index.html" || ASSET_EXTS.has(ext)) {
          fs.copyFileSync(
            path.join(livePreviewDir, entry.name),
            path.join(gameDir, entry.name),
          );
          copied.push(entry.name);
        }
      }
      // Recurse into assets/ if the live-preview ships one (matches
      // publish-game.js).
      const srcAssets = path.join(livePreviewDir, "assets");
      if (fs.existsSync(srcAssets) && fs.statSync(srcAssets).isDirectory()) {
        const destAssets = path.join(gameDir, "assets");
        fs.mkdirSync(destAssets, { recursive: true });
        for (const entry of fs.readdirSync(srcAssets, {
          withFileTypes: true,
        })) {
          if (!entry.isFile()) continue;
          fs.copyFileSync(
            path.join(srcAssets, entry.name),
            path.join(destAssets, entry.name),
          );
          copied.push("assets/" + entry.name);
        }
      }
      if (!copied.includes("index.html")) {
        return json(res, 500, {
          ok: false,
          error: "Could not copy live preview files.",
        });
      }

      // Manifest in the EXACT GameStorageManager schema (matches
      // publish-game.js).
      const hasJs = copied.some((f) => f.endsWith(".js"));
      const hasConcept =
        copied.includes("assets/concept.webp") ||
        copied.includes("assets/concept.png") ||
        copied.includes("assets/concept.jpg");
      const manifest = {
        id: gameId,
        title,
        prompt: "",
        biome: "live-preview",
        metaModel: "hand-made",
        enrichmentModel: null,
        objective: "",
        createdAt: new Date().toISOString(),
        playUrl: `/studio/games/${gameId}/index.html`,
        imageUrl: hasConcept
          ? `/studio/games/${gameId}/assets/${copied.find((f) => f.startsWith("assets/concept"))}`
          : null,
        files: {
          html: "index.html",
          manifest: "manifest.json",
          unity: [],
        },
      };
      if (hasJs) {
        const main = copied.includes("game.js")
          ? "game.js"
          : copied.find((f) => f.endsWith(".js"));
        manifest.files.js = main;
      }

      await fs.promises.writeFile(
        path.join(gameDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );

      // Upsert index.json entry (newest first) — matches publish-game.js.
      let index = [];
      try {
        index = JSON.parse(
          (await fs.promises.readFile(
            path.join(STORAGE_DIR, "index.json"),
            "utf8",
          )) || "[]",
        );
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
      index = index.filter((e) => e && e.id !== gameId);
      index.unshift(manifest);
      await fs.promises.writeFile(
        path.join(STORAGE_DIR, "index.json"),
        JSON.stringify(index, null, 2),
        "utf8",
      );

      return json(res, 200, {
        ok: true,
        gameId,
        playUrl: manifest.playUrl,
        title,
      });
    } catch {
      return json(res, 500, {
        ok: false,
        error: "Could not publish the live preview.",
      });
    }
  }

  // ---------- Uploaded reference files (/studio/uploads/* or /storage/.uploads/*) ----------
  const uploadServeMatch = pathname.match(
    /^\/(?:studio\/uploads|storage\/\.uploads)\/([\w.\-]+)$/,
  );
  if (uploadServeMatch) {
    const uploadDir = path.join(ROOT_DIR, "storage", ".uploads");
    const target = path.resolve(uploadDir, uploadServeMatch[1]);
    if (!target.startsWith(path.resolve(uploadDir))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Play a stored game (HTML or game.js) ----------
  const playMatch = pathname.match(
    /^\/studio\/games\/([\w-]+)\/(index\.html|game\.js)$/,
  );
  if (playMatch) {
    return sendFile(res, path.join(STORAGE_DIR, playMatch[1], playMatch[2]));
  }

  // ---------- Stored game assets (concept art etc.) ----------
  const assetMatch = pathname.match(
    /^\/studio\/games\/([\w-]+)\/(assets\/[\w.\-]+)$/,
  );
  if (assetMatch) {
    const assetPath = path.join(STORAGE_DIR, assetMatch[1], assetMatch[2]);
    if (!path.resolve(assetPath).startsWith(path.resolve(STORAGE_DIR))) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, assetPath);
  }

  // ---------- Stored game files (read-only judge play: any staged file) ----------
  // Serves every file inside a stored game dir — multi-file games need
  // their sibling .js/.css/.glb next to index.html. Read-only, path-contained.
  const gameFileMatch = pathname.match(/^\/studio\/games\/([\w-]+)\/(.+)$/);
  if (gameFileMatch && req.method === "GET") {
    const target = path.resolve(
      STORAGE_DIR,
      gameFileMatch[1],
      gameFileMatch[2],
    );
    if (!target.startsWith(path.resolve(STORAGE_DIR) + path.sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Ephemeral judge builds (zero library pollution) ----------
  // Serves storage/.judge-runs/<id>/<file> exactly like /studio/games/:
  // read-only, path-contained, public so judges can play their own build
  // in #game-frame. The official library is never listed or touched here.
  const judgeGameMatch = pathname.match(
    /^\/studio\/judge-games\/([\w-]+)\/(.+)$/,
  );
  if (judgeGameMatch && req.method === "GET") {
    const target = path.resolve(
      JUDGE_RUNS_DIR,
      judgeGameMatch[1],
      judgeGameMatch[2],
    );
    if (!target.startsWith(path.resolve(JUDGE_RUNS_DIR) + path.sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    return sendFile(res, target);
  }

  // ---------- Meta voice transcribe: multipart audio upload -> transcript ---
  // Minimal dependency-free multipart/form-data parser: returns the first
  // file part { field, filename, contentType, data } or null.
  function parseMultipartFile(req, raw) {
    const ctype = String((req.headers && req.headers["content-type"]) || "");
    const m = ctype.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!m) return null;
    const boundary = Buffer.from(`--${m[1] || m[2]}`, "utf8");
    if (!raw || raw.length === 0) return null;
    let start = raw.indexOf(boundary);
    while (start !== -1) {
      let cursor = start + boundary.length;
      if (raw[cursor] === 45 && raw[cursor + 1] === 45) break; // closing --
      if (raw[cursor] === 13 && raw[cursor + 1] === 10) cursor += 2;
      const headEnd = raw.indexOf("\r\n\r\n", cursor);
      if (headEnd === -1) break;
      const head = raw.toString("utf8", cursor, headEnd);
      const bodyStart = headEnd + 4;
      const next = raw.indexOf(boundary, bodyStart);
      if (next === -1) break;
      let bodyEnd = next;
      if (raw[bodyEnd - 2] === 13 && raw[bodyEnd - 1] === 10) bodyEnd -= 2;
      const field = (head.match(/name="([^"]*)"/) || [])[1] || "";
      const filename = (head.match(/filename="([^"]*)"/) || [])[1] || "";
      const partType =
        (head.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || "";
      if (filename) {
        return {
          field,
          filename: path.basename(filename).slice(0, 100),
          contentType: partType.trim().toLowerCase(),
          data: raw.subarray(bodyStart, bodyEnd),
        };
      }
      start = next;
    }
    return null;
  }

  // ---------- File upload for prompt attachments (raw bytes) ----------
  // POST /api/studio/upload?name=foo.png with Content-Type:
  // application/octet-stream. Max 10MB. Files land in storage/.uploads
  // and the CLI reads them from its scoped run dir.
  if (pathname === "/api/studio/upload" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    const rawName = String(url.searchParams.get("name") || "");
    const safeName =
      path
        .basename(rawName)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 100) || "file.bin";
    const uploadDir = path.join(ROOT_DIR, "storage", ".uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const id = crypto.randomBytes(6).toString("hex");
    const dest = path.join(uploadDir, `${id}_${safeName}`);
    const MAX_BYTES = 10 * 1024 * 1024;
    let received = 0;
    let tooBig = false;
    const out = fs.createWriteStream(dest);
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BYTES) {
        tooBig = true;
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        try {
          out.destroy();
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        if (!res.writableEnded) {
          json(res, 413, { error: "File too large (max 10MB)." });
        }
        return;
      }
      out.write(chunk);
    });
    req.on("end", () => {
      if (tooBig || res.writableEnded) return;
      out.end(() => {
        json(res, 200, { id, name: safeName, size: received });
      });
    });
    req.on("error", () => {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      if (!res.writableEnded) json(res, 400, { error: "Upload failed." });
    });
    return;
  }

  // ---------- Meta voice transcribe (OWNER-ONLY mic dictation) ----------
  // POST /api/studio/voice/transcribe with multipart form-data (file field
  // "audio", webm/opus from MediaRecorder or wav). Saved to
  // storage/.uploads/, converted to 16kHz mono WAV via ffmpeg when needed,
  // transcribed by Meta muse-voice-transcribe-1.0. Visitors get 401 and the
  // Studio falls back to browser SpeechRecognition for them.
  if (pathname === "/api/studio/voice/transcribe" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    const MAX_BYTES = 10 * 1024 * 1024;
    const chunks = [];
    let received = 0;
    let tooBig = false;
    req.on("data", (chunk) => {
      if (tooBig) return;
      received += chunk.length;
      if (received > MAX_BYTES) {
        tooBig = true;
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        if (!res.writableEnded) {
          json(res, 413, { error: "Audio too large (max 10MB)." });
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (tooBig || res.writableEnded) return;
      try {
        const file = parseMultipartFile(req, Buffer.concat(chunks));
        if (!file || !file.data || file.data.length === 0) {
          return json(res, 400, {
            error: "Multipart audio file (field 'audio') is required.",
          });
        }
        const ctype = file.contentType || "";
        const looksAudio =
          ctype.startsWith("audio/") ||
          /\.(webm|wav|ogg|oga|mp3|m4a|mp4)$/i.test(file.filename);
        if (!looksAudio) {
          return json(res, 400, { error: "Uploaded file is not audio." });
        }
        const uploadDir = path.join(ROOT_DIR, "storage", ".uploads");
        fs.mkdirSync(uploadDir, { recursive: true });
        const id = crypto.randomBytes(6).toString("hex");
        const ext = (
          (file.filename.match(/\.[a-z0-9]+$/i) || [])[0] || ".webm"
        ).toLowerCase();
        const dest = path.join(uploadDir, `${id}_voice${ext}`);
        fs.writeFileSync(dest, file.data);
        if (process.env.STUDIO_VOICE_OFFLINE === "1") {
          return json(res, 200, {
            ok: true,
            model: "muse-voice-transcribe-1.0",
            transcript: "[offline test transcript — Meta call skipped]",
            offline: true,
          });
        }
        // Meta ASR wants 16kHz mono WAV; MediaRecorder sends webm/opus.
        let wavPath = dest;
        const isWav =
          file.data.length > 12 && file.data.toString("ascii", 0, 4) === "RIFF";
        if (!isWav) {
          // NOTE: /home/opencode/.local/bin/ffmpeg is a WAV-only Python
          // shim (tracebacks on webm) — never use it for conversion. The
          // imageio-ffmpeg static binary is the real decoder on this VM.
          const ffmpegCandidates = [
            "/home/opencode/.local/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v9.0.2",
            "/usr/bin/ffmpeg",
          ];
          const ffmpegBin =
            ffmpegCandidates.find((p) => {
              try {
                return fs.existsSync(p);
              } catch {
                return false;
              }
            }) || "ffmpeg";
          wavPath = path.join(uploadDir, `${id}_voice16k.wav`);
          try {
            execFileSync(
              ffmpegBin,
              [
                "-y",
                "-v",
                "error",
                "-i",
                dest,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                wavPath,
              ],
              { timeout: 30000, stdio: ["ignore", "ignore", "pipe"] },
            );
          } catch (convErr) {
            return json(res, 400, {
              error: `Audio could not be decoded (${String(
                (convErr && convErr.message) || convErr,
              ).slice(0, 120)}).`,
            });
          }
        }
        try {
          const client = new MetaVoiceTranscribeClient();
          const out = await client.transcribe(wavPath, {
            preferredBackend: "api",
          });
          // The tool's local fallback invents a demo transcript offline —
          // never present that to the user as a real transcription.
          if (!out || out.backend === "fallback-local") {
            return json(res, 502, {
              error:
                "Meta transcription unavailable right now; try again soon.",
            });
          }
          return json(res, 200, {
            ok: true,
            model: out.model || "muse-voice-transcribe-1.0",
            transcript: out.transcript || "",
          });
        } finally {
          if (wavPath !== dest) {
            try {
              fs.unlinkSync(wavPath);
            } catch {
              /* keep the original upload only */
            }
          }
        }
      } catch (err) {
        if (!res.writableEnded) {
          json(res, 500, { error: "Transcription failed." });
        }
      }
    });
    return;
  }

  // ---------- Send prompt / model switch into live Muse Code CLI terminal ----------
  if (pathname === "/api/studio/terminal/send" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const prompt = String(payload.prompt || "").trim();
      const model =
        typeof payload.model === "string" &&
        ALLOWED_CLI_MODELS.includes(payload.model)
          ? payload.model
          : null;
      const attachments = Array.isArray(payload.attachments)
        ? payload.attachments
            .filter(
              (a) =>
                a && typeof a.id === "string" && /^[0-9a-f]{12,64}$/.test(a.id),
            )
            .map((a) => {
              const dir = path.join(ROOT_DIR, "storage", ".uploads");
              try {
                for (const f of fs.readdirSync(dir)) {
                  if (f.startsWith(`${a.id}_`)) {
                    return `storage/.uploads/${f}`;
                  }
                }
              } catch {
                /* ignore */
              }
              return null;
            })
            .filter(Boolean)
        : [];

      try {
        if (model && model !== activeTerminalModel) {
          await sendLineToTmux(`/model ${model}`);
          activeTerminalModel = model;
          await sleep(400);
        }
        if (prompt) {
          const enriched = enrichStudioPrompt(prompt, {
            scope: payload.scope,
            skills: payload.skills,
            attachments,
          });
          const finalPrompt =
            attachments.length && enriched === prompt
              ? `${prompt} (Reference files: ${attachments.join(", ")})`
              : enriched;
          await sendLineToTmux(finalPrompt);
        }
        return json(res, 200, {
          ok: true,
          session: TMUX_SESSION,
          model: activeTerminalModel,
          sent: Boolean(prompt),
        });
      } catch {
        return json(res, 500, {
          ok: false,
          error: "Failed to dispatch prompt to live CLI terminal.",
        });
      }
    });
    return;
  }

  // ---------- Stop / interrupt running turn in live Muse Code CLI terminal ----------
  if (pathname === "/api/studio/terminal/stop" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    req.resume();
    try {
      execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "-X", "cancel"], {
        stdio: "ignore",
      });
    } catch {
      /* ignore if not in copy-mode */
    }
    try {
      execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "Escape"]);
      await sleep(80);
      execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "Escape"]);
      await sleep(80);
      execFileSync("tmux", ["send-keys", "-t", TMUX_SESSION, "C-c"]);
      // Also terminate any hung child processes spawned by muse-bin so background subagent commands stop immediately
      const panePid = execFileSync(
        "tmux",
        ["display-message", "-t", TMUX_SESSION, "-p", "#{pane_pid}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (panePid && /^\d+$/.test(panePid)) {
        const musePids = execFileSync("pgrep", ["-P", panePid], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        for (const mp of musePids) {
          try {
            execFileSync("pkill", ["-TERM", "-P", mp], { stdio: "ignore" });
          } catch {
            /* no child procs */
          }
        }
      }
    } catch {
      /* ignore if session not running */
    }
    return json(res, 200, { ok: true, stopped: true });
  }

  if (pathname === "/api/studio/terminal/status" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      cliBusy: Boolean(isTmuxCliBusy()),
      terminalScroll: getTmuxScrollState(),
    });
  }

  // ---------- Scroll live Muse Code CLI tmux pane ----------
  if (pathname === "/api/studio/terminal/scroll" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const action = String(payload.action || "bottom");
      const lines = Math.max(
        1,
        Math.min(200, Math.round(Number(payload.lines) || 5)),
      );
      try {
        ensureTmuxSession();
        if (action === "up") {
          execFileSync("tmux", ["copy-mode", "-t", TMUX_SESSION], {
            stdio: "ignore",
          });
          execFileSync(
            "tmux",
            [
              "send-keys",
              "-t",
              TMUX_SESSION,
              "-X",
              "-N",
              String(lines),
              "scroll-up",
            ],
            { stdio: "ignore" },
          );
        } else if (action === "down") {
          try {
            execFileSync(
              "tmux",
              [
                "send-keys",
                "-t",
                TMUX_SESSION,
                "-X",
                "-N",
                String(lines),
                "scroll-down",
              ],
              { stdio: "ignore" },
            );
          } catch {
            /* ignore if not in copy-mode */
          }
          const st = getTmuxScrollState();
          if (st.inMode && st.pos <= 0) {
            try {
              execFileSync(
                "tmux",
                ["send-keys", "-t", TMUX_SESSION, "-X", "cancel"],
                { stdio: "ignore" },
              );
            } catch {
              /* ignore */
            }
          }
        } else if (action === "ratio") {
          const r = Math.max(0, Math.min(1, Number(payload.ratio)));
          if (!Number.isFinite(r) || r >= 0.97) {
            try {
              execFileSync(
                "tmux",
                ["send-keys", "-t", TMUX_SESSION, "-X", "cancel"],
                { stdio: "ignore" },
              );
            } catch {
              /* ignore */
            }
          } else {
            const st = getTmuxScrollState();
            const hist = Math.max(1, st.history || 40);
            const offset = Math.max(1, Math.round((1 - r) * hist));
            execFileSync("tmux", ["copy-mode", "-t", TMUX_SESSION], {
              stdio: "ignore",
            });
            execFileSync(
              "tmux",
              ["send-keys", "-t", TMUX_SESSION, "-X", "history-bottom"],
              { stdio: "ignore" },
            );
            execFileSync(
              "tmux",
              [
                "send-keys",
                "-t",
                TMUX_SESSION,
                "-X",
                "-N",
                String(offset),
                "scroll-up",
              ],
              { stdio: "ignore" },
            );
          }
        } else if (action === "bottom") {
          try {
            execFileSync(
              "tmux",
              ["send-keys", "-t", TMUX_SESSION, "-X", "cancel"],
              { stdio: "ignore" },
            );
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore tmux errors */
      }
      return json(res, 200, {
        ok: true,
        terminalScroll: getTmuxScrollState(),
      });
    });
    return;
  }

  // ---------- Fresh terminal window (new chat, multi-window) ----------
  // NEVER kill the session: snapshot the current window into storage/chats/
  // (linked by windowId + gameId), then open a FRESH window beside it in the
  // same session. The new window becomes active automatically, so ttyd shows
  // it with no reconnect; old windows (and their agents) keep running.
  if (pathname === "/api/studio/session/new" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    // Drain any request body; nothing in it is used or logged.
    req.resume();
    // Auto-save the current game FIRST, then link it into the archived
    // chat log so History continue can restore game + terminal together.
    let savedGame = null;
    try {
      savedGame = autoSaveLivePreviewToLibrary();
    } catch {
      savedGame = null;
    }
    try {
      ensureTmuxSession();
    } catch {
      return json(res, 500, { ok: false, error: "Could not start terminal." });
    }
    const prevWindowId = getActiveTmuxWindowId();
    const safeTitle = String((savedGame && savedGame.title) || "").replace(
      /[\r\n"]/g,
      "",
    );
    const chatMetaLine =
      `[ags-meta gameId="${(savedGame && savedGame.id) || ""}" ` +
      `gameTitle="${safeTitle}"` +
      (prevWindowId ? ` windowId="${prevWindowId}"` : "") +
      `]\n`;
    let archived = null;
    let note = null;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `chat_${stamp}.log`;
      fs.mkdirSync(CHATS_DIR, { recursive: true });
      const dest = path.join(CHATS_DIR, fileName);
      try {
        const target = prevWindowId
          ? `${TMUX_SESSION}:${prevWindowId}`
          : TMUX_SESSION;
        const { stdout } = await execFileAsync(
          "tmux",
          ["capture-pane", "-t", target, "-p", "-S", "-"],
          { timeout: 15000 },
        );
        fs.writeFileSync(dest, chatMetaLine + (stdout || ""), "utf8");
      } catch {
        note = "previous window missing; nothing to archive";
        fs.writeFileSync(
          dest,
          chatMetaLine +
            `No previous tmux window in '${TMUX_SESSION}' to archive.\n`,
          "utf8",
        );
      }
      archived = path.join("storage", "chats", fileName);
    } catch {
      return json(res, 500, { ok: false, error: "Could not archive session." });
    }
    activeTerminalModel = "muse-spark-1.3";
    let newWindowId = null;
    try {
      const { stdout } = await execFileAsync(
        "tmux",
        [
          "new-window",
          "-P",
          "-F",
          "#{window_id}",
          "-t",
          TMUX_SESSION,
          "-c",
          ROOT_DIR,
          tmuxAgentLoopCmd(),
        ],
        { timeout: 15000 },
      );
      newWindowId = String(stdout || "").trim() || null;
    } catch {
      return json(res, 500, {
        ok: false,
        error: "Could not open a new terminal window.",
        archived,
      });
    }
    return json(res, 200, {
      ok: true,
      archived,
      session: TMUX_SESSION,
      windowId: newWindowId,
      previousWindowId: prevWindowId,
      savedGame: savedGame
        ? { id: savedGame.id, title: savedGame.title }
        : null,
      ...(note ? { note } : {}),
    });
  }

  // ---------- Chat history (archived tmux transcripts) ----------
  // GET /api/studio/chats -> newest-first [{id, createdAt, size, preview}]
  if (pathname === "/api/studio/chats" && req.method === "GET") {
    if (ownerGuard(req, res)) return;
    let files = [];
    try {
      fs.mkdirSync(CHATS_DIR, { recursive: true });
      files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith(".log"));
    } catch {
      files = [];
    }
    const liveWins = listTmuxWindows();
    const liveIds = new Set(liveWins.map((w) => w.id));
    const list = files
      .map((f) => {
        const abs = path.join(CHATS_DIR, f);
        let stat = null;
        try {
          stat = fs.statSync(abs);
        } catch {
          stat = null;
        }
        if (!stat || !stat.isFile()) return null;
        let preview = "";
        let gameId = null;
        let gameTitle = null;
        let windowId = null;
        try {
          const text = fs.readFileSync(abs, "utf8");
          const meta = parseChatMeta(text);
          gameId = meta.gameId;
          gameTitle = meta.gameTitle;
          windowId = meta.windowId;
          preview = text
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("[ags-meta"))
            .slice(0, 3)
            .join("\n")
            .slice(0, 300);
        } catch {
          preview = "";
        }
        const live = Boolean(windowId && liveIds.has(windowId));
        const liveWin = live ? liveWins.find((w) => w.id === windowId) : null;
        return {
          id: f,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          preview,
          gameId,
          gameTitle,
          windowId,
          live,
          windowActive: Boolean(liveWin && liveWin.active),
          transcript: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // Live windows with no archived chat yet (e.g. the current one) are
    // listed first as switchable entries without transcripts.
    const linked = new Set(
      list.filter((e) => e.windowId).map((e) => e.windowId),
    );
    const liveOnly = liveWins
      .filter((w) => !linked.has(w.id))
      .map((w) => ({
        id: `live:${w.id}`,
        createdAt: new Date().toISOString(),
        size: 0,
        preview: "",
        gameId: null,
        gameTitle: null,
        windowId: w.id,
        live: true,
        windowActive: w.active,
        transcript: false,
        windowName: w.name,
      }));
    return json(res, 200, [...liveOnly, ...list]);
  }

  // GET /api/studio/chats/:id -> {id, content} capped at 200KB.
  // The live terminal is a ttyd iframe; "resume" = switch to the still-live
  // window when possible, else view transcript + seed with context.
  const chatMatch = pathname.match(/^\/api\/studio\/chats\/(.+)$/);
  if (chatMatch && req.method === "GET") {
    if (ownerGuard(req, res)) return;
    const raw = chatMatch[1] || "";
    let id = "";
    try {
      id = decodeURIComponent(raw);
    } catch {
      return json(res, 400, { error: "Invalid chat id." });
    }
    if (id.startsWith("live:")) {
      const wid = id.slice("live:".length);
      if (!/^@\d+$/.test(wid)) {
        return json(res, 400, { error: "Invalid chat id." });
      }
      const w = listTmuxWindows().find((x) => x.id === wid);
      if (!w) return json(res, 404, { error: "Window no longer live." });
      return json(res, 200, {
        id,
        content: "",
        gameId: null,
        gameTitle: null,
        windowId: wid,
        live: true,
        windowActive: w.active,
        transcript: false,
      });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      return json(res, 400, { error: "Invalid chat id." });
    }
    const dir = path.resolve(CHATS_DIR);
    const target = path.resolve(dir, id);
    if (target !== path.join(dir, id) || !target.startsWith(dir + path.sep)) {
      return json(res, 400, { error: "Invalid chat id." });
    }
    let stat = null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      return json(res, 404, { error: "Chat not found." });
    }
    let content = "";
    try {
      content = fs.readFileSync(target, "utf8");
    } catch {
      return json(res, 500, { error: "Could not read chat transcript." });
    }
    const meta = parseChatMeta(content);
    content = content
      .split("\n")
      .filter((l) => !l.startsWith("[ags-meta"))
      .join("\n");
    const MAX_BYTES = 200 * 1024;
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
      content = Buffer.from(content, "utf8")
        .slice(0, MAX_BYTES)
        .toString("utf8");
    }
    const wins = listTmuxWindows();
    const liveWin = meta.windowId
      ? wins.find((w) => w.id === meta.windowId)
      : null;
    return json(res, 200, {
      id,
      content,
      gameId: meta.gameId,
      gameTitle: meta.gameTitle,
      windowId: meta.windowId,
      live: Boolean(liveWin),
      windowActive: Boolean(liveWin && liveWin.active),
      transcript: true,
    });
  }

  // POST /api/studio/chats/:id/continue -> switch back to a live window.
  // If the chat's tmux window is still alive, select it (the ttyd client
  // follows automatically) and activate its linked game — no new prompt is
  // sent. Dead/unlinked chats return switched:false so the UI can fall back
  // to transcript + context seeding.
  const continueMatch = pathname.match(
    /^\/api\/studio\/chats\/(.+)\/continue$/,
  );
  if (continueMatch && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    req.resume();
    let id = "";
    try {
      id = decodeURIComponent(continueMatch[1] || "");
    } catch {
      return json(res, 400, { ok: false, error: "Invalid chat id." });
    }
    let windowId = null;
    let gameId = null;
    let gameTitle = null;
    if (id.startsWith("live:")) {
      windowId = id.slice("live:".length);
      if (!/^@\d+$/.test(windowId)) {
        return json(res, 400, { ok: false, error: "Invalid chat id." });
      }
    } else {
      if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
        return json(res, 400, { ok: false, error: "Invalid chat id." });
      }
      const dir = path.resolve(CHATS_DIR);
      const target = path.resolve(dir, id);
      if (target !== path.join(dir, id) || !target.startsWith(dir + path.sep)) {
        return json(res, 400, { ok: false, error: "Invalid chat id." });
      }
      let text = "";
      try {
        text = fs.readFileSync(target, "utf8");
      } catch {
        return json(res, 404, { ok: false, error: "Chat not found." });
      }
      const meta = parseChatMeta(text);
      windowId = meta.windowId;
      gameId = meta.gameId;
      gameTitle = meta.gameTitle;
    }
    const live = Boolean(
      windowId && listTmuxWindows().some((w) => w.id === windowId),
    );
    if (!live) {
      return json(res, 200, {
        ok: true,
        switched: false,
        reason: windowId ? "window-gone" : "no-linked-window",
        gameId,
        gameTitle,
      });
    }
    try {
      await execFileAsync(
        "tmux",
        ["select-window", "-t", `${TMUX_SESSION}:${windowId}`],
        { timeout: 15000 },
      );
    } catch {
      return json(res, 200, {
        ok: true,
        switched: false,
        reason: "select-failed",
        gameId,
        gameTitle,
      });
    }
    let gameActivated = null;
    if (gameId) {
      try {
        const { found } = await activateStoredGame(gameId);
        gameActivated = {
          id: gameId,
          title:
            (found.manifest && found.manifest.title) ||
            gameTitle ||
            "Game Preview",
        };
      } catch {
        gameActivated = null;
      }
    }
    return json(res, 200, {
      ok: true,
      switched: true,
      windowId,
      url: "/studio/live-preview/index.html",
      title: (gameActivated && gameActivated.title) || "Game Preview",
      gameActivated,
    });
  }

  // ---------- Live agent run (Server-Sent Events) ----------
  // Judge Sandbox: public for hackathon judges. Non-owners get the REAL
  // Muse Code CLI at full power, but ONLY inside the locked-down Google
  // gVisor (runsc) container — no host access, no attachments, no
  // live-preview writes, rate-limited. Owner keeps the host pipeline.
  if (pathname === "/api/studio/generate" && req.method === "POST") {
    const sandboxed = !isOwnerRequest(req);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const prompt = String(payload.prompt || "");
      const model =
        typeof payload.model === "string" ? payload.model : undefined;
      const ownerAttachments = Array.isArray(payload.attachments)
        ? payload.attachments
            .filter(
              (a) =>
                a && typeof a.id === "string" && /^[0-9a-f]{12,64}$/.test(a.id),
            )
            .map((a) => {
              const dir = path.join(ROOT_DIR, "storage", ".uploads");
              let found = null;
              try {
                for (const f of fs.readdirSync(dir)) {
                  if (f.startsWith(`${a.id}_`)) {
                    found = path.join(dir, f);
                    break;
                  }
                }
              } catch {
                found = null;
              }
              return found
                ? { name: String(a.name || "file"), path: found }
                : null;
            })
            .filter(Boolean)
        : [];
      // Sandbox: judges get zero host-filesystem/attachment access. The CLI
      // still runs at full power, but only inside Google gVisor (runsc).
      // (The generate flow never writes public/live-preview/ anyway: the
      // done event's playUrl points at the ephemeral judge run, and the
      // official library is never touched.)
      const attachments = sandboxed ? [] : ownerAttachments;

      if (!prompt.trim()) {
        return json(res, 400, { error: "A game prompt is required." });
      }

      // Credit protection: strangers (no valid judge token) may only run
      // pre-cached prompts (zero API spend). Rejected BEFORE the rate
      // limiter so 403s never consume the judge build budget.
      if (sandboxed) {
        const gate = judgeGenerateAllowed(req, payload, prompt);
        if (!gate.allowed) {
          return json(res, 403, {
            error:
              "Uncached live AI builds require the Hackathon Judge access link (?judge=meta-judge-2026). Pre-cached prompts and all 3D Library games are open to play!",
          });
        }
        if (gate.via === "judge-token") {
          appendJudgeAudit(req, "judge_generate", prompt);
        }
      }

      let judgeSlotTaken = false;
      if (sandboxed) {
        const verdict = judgeBuildAllowed(judgeClientIp(req));
        if (!verdict.allowed) {
          res.setHeader("retry-after", String(verdict.retryAfter));
          return json(res, 429, {
            error:
              "Judge Sandbox build limit reached (6 builds per 10 minutes). Try again soon.",
            retryAfter: verdict.retryAfter,
          });
        }
        // Max 1 concurrent non-owner build: gVisor CLI runs are heavy, and
        // overlapping builds would thrash the VM's RAM/CPU for judges.
        if (activeJudgeBuildCount >= 1) {
          return json(res, 429, {
            error:
              "A sandbox build is currently in progress; please retry in a few seconds.",
          });
        }
        activeJudgeBuildCount += 1;
        judgeSlotTaken = true;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let closed = false;
      // NOTE: req "close" fires as soon as the POST body is consumed in
      // Node 20, which would mute the whole stream. Client disconnects
      // surface on the response object instead.
      res.on("close", () => {
        closed = true;
      });

      const emit = (event) => {
        if (closed || res.writableEnded) return;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          closed = true;
        }
      };

      // Keep the connection warm through proxies while long steps run.
      const heartbeat = setInterval(() => {
        if (closed || res.writableEnded) return;
        try {
          res.write(": ping\n\n");
        } catch {
          closed = true;
        }
      }, 15000);

      try {
        const runner = new AgentRunner(ROOT_DIR, emit);
        const genPrompt = sandboxed
          ? prompt
          : enrichStudioPrompt(prompt, {
              scope: payload.scope,
              skills: payload.skills,
              attachments: ownerAttachments,
            });
        const result = await runner.run(genPrompt, {
          model,
          attachments,
          skipSubprocessCli: !sandboxed && Boolean(payload.skipSubprocessCli),
          useGvisor: sandboxed,
          ephemeralJudgeRun: sandboxed,
        });
        if (!result.ok) {
          emit({ type: "done", ok: false, at: Date.now() });
        }
      } catch (err) {
        emit({ type: "error", message: "Agent run failed.", at: Date.now() });
        emit({ type: "done", ok: false, at: Date.now() });
      } finally {
        if (judgeSlotTaken) {
          activeJudgeBuildCount = Math.max(0, activeJudgeBuildCount - 1);
        }
        clearInterval(heartbeat);
        if (!res.writableEnded) res.end();
      }
    });
    return;
  }

  // ---------- Judge activity audit (token-gated POST, owner-only GET) ------
  if (pathname === "/api/studio/judge-audit" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      if (!judgeTokenValid(req, payload)) {
        return json(res, 403, {
          error: "Judge verification required (?judge= access link).",
        });
      }
      appendJudgeAudit(
        req,
        payload.event || "judge_visit",
        payload.prompt || "",
      );
      return json(res, 200, { ok: true });
    });
    return;
  }
  if (pathname === "/api/studio/judge-audit" && req.method === "GET") {
    if (ownerGuard(req, res)) return;
    let events = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(JUDGE_AUDIT_FILE, "utf8"));
      if (Array.isArray(parsed)) events = parsed;
    } catch {
      events = [];
    }
    return json(res, 200, { ok: true, events: events.slice(-50).reverse() });
  }

  // ---------- Live AI Director (PUBLIC judges route — NO owner guard) ----------
  if (pathname === "/api/studio/ai/director" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const verdict = directorAllowed(judgeClientIp(req));
      if (!verdict.allowed) {
        res.setHeader("retry-after", String(verdict.retryAfter));
        return json(res, 429, {
          error:
            "AI Director rate limit reached (30 requests per minute). Try again soon.",
          retryAfter: verdict.retryAfter,
        });
      }
      let telemetry = {};
      try {
        telemetry = JSON.parse(body || "{}");
      } catch {
        telemetry = {};
      }
      if (!telemetry || typeof telemetry !== "object") telemetry = {};
      const sig = buildDirectorSignature(telemetry);
      const hit = directorCache.get(sig);
      if (hit && Date.now() - hit.at < AI_DIRECTOR_CACHE_TTL_MS) {
        return json(res, 200, {
          ok: true,
          model: hit.model,
          cached: true,
          ...hit.decision,
        });
      }
      let model = AI_DIRECTOR_MODEL_FALLBACK;
      let decision;
      if (process.env.STUDIO_AI_DIRECTOR_OFFLINE === "1") {
        decision = heuristicDirector(telemetry);
      } else {
        try {
          const live = await callDirectorModel(telemetry);
          decision = live.decision;
          model = live.model;
        } catch (err) {
          console.warn(
            "[ai-director] live call failed, heuristic fallback:",
            err && err.message,
          );
          decision = heuristicDirector(telemetry);
        }
      }
      directorCache.set(sig, { at: Date.now(), model, decision });
      return json(res, 200, { ok: true, model, cached: false, ...decision });
    });
    return;
  }

  // ---------- Judge AI assistant (PUBLIC) ----------
  if (pathname === "/api/studio/judge-assistant" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const question =
        typeof payload.question === "string"
          ? payload.question.slice(0, AI_ASSISTANT_QUESTION_MAX)
          : "";
      if (!question.trim()) {
        return json(res, 400, {
          error: "Body { question: string } is required and must not be empty.",
        });
      }
      appendJudgeAudit(req, "judge_assistant_ask", question);
      const verdict = judgeAssistantAllowed(judgeClientIp(req));
      if (!verdict.allowed) {
        res.setHeader("retry-after", String(verdict.retryAfter));
        return json(res, 429, {
          error:
            "Judge assistant rate limit reached (30 requests per minute). Try again soon.",
          retryAfter: verdict.retryAfter,
        });
      }
      const sig = buildAssistantSignature(question);
      const hit = assistantCache.get(sig);
      if (hit && Date.now() - hit.at < AI_ASSISTANT_CACHE_TTL_MS) {
        return json(res, 200, {
          ok: true,
          model: hit.model,
          answer: hit.answer,
          citations: hit.citations,
          cached: true,
        });
      }
      const kb = judgeAssistantFallback(question);
      let model = AI_ASSISTANT_MODEL_FALLBACK;
      let answer = kb.answer;
      if (process.env.STUDIO_JUDGE_ASSISTANT_OFFLINE === "1") {
        /* offline kill-switch: KB only, zero credits spent */
      } else {
        try {
          const live = await callAssistantModel(question);
          answer = live.answer;
          model = live.model;
        } catch (err) {
          console.warn(
            "[judge-assistant] live call failed, KB fallback:",
            err && err.message,
          );
        }
      }
      assistantCache.set(sig, {
        at: Date.now(),
        model,
        answer,
        citations: kb.citations,
      });
      return json(res, 200, {
        ok: true,
        model,
        answer,
        citations: kb.citations,
        cached: false,
      });
    });
    return;
  }

  // ---------- Git status (PUBLIC read-only) ----------
  if (pathname === "/api/studio/git/status" && req.method === "GET") {
    return json(res, 200, getGitStatusJson());
  }

  // ---------- Git sync (OWNER-ONLY): add + commit + push ----------
  if (pathname === "/api/studio/git/sync" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const message =
        String(payload.message || "").trim() ||
        "chore(studio): sync studio and game updates";
      try {
        execFileSync("git", ["-C", ROOT_DIR, "add", "-A"], {
          encoding: "utf8",
          timeout: 30000,
        });
        const dirty = parseGitStatus(
          String(
            execFileSync("git", ["-C", ROOT_DIR, "status", "--porcelain"], {
              encoding: "utf8",
              timeout: 30000,
            }),
          ),
        );
        if (dirty.length > 0) {
          execFileSync("git", ["-C", ROOT_DIR, "commit", "-m", message], {
            encoding: "utf8",
            timeout: 30000,
          });
        }
        try {
          await execFileAsync(
            "git",
            ["-C", ROOT_DIR, "push", "origin", "main"],
            { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 },
          );
        } catch (pushErr) {
          const detail = scrubSecrets(
            String(
              (pushErr && pushErr.stderr) ||
                (pushErr && pushErr.message) ||
                pushErr,
            ).slice(0, 1000),
          );
          return json(res, 200, { ok: false, error: detail });
        }
        return json(res, 200, {
          ok: true,
          pushed: true,
          status: getGitStatusJson(),
        });
      } catch (err) {
        return json(res, 200, {
          ok: false,
          error: scrubSecrets(
            String((err && err.message) || err).slice(0, 1000),
          ),
        });
      }
    });
    return;
  }

  // ---------- Export live-preview game to its own GitHub repo (OWNER-ONLY) ----------
  if (pathname === "/api/studio/git/export-game" && req.method === "POST") {
    if (ownerGuard(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const slug = slugifyGitRepoName(payload.repoName);
      if (!slug) {
        return json(res, 400, {
          ok: false,
          error: "repoName is required (letters, numbers, dashes).",
        });
      }
      const stage = `/tmp/ags-export-${slug}`;
      try {
        const liveDir = path.join(PUBLIC_DIR, "live-preview");
        if (!fs.existsSync(path.join(liveDir, "index.html"))) {
          return json(res, 400, {
            ok: false,
            error: "No live preview to export. Build a game first.",
          });
        }
        fs.rmSync(stage, { recursive: true, force: true });
        fs.mkdirSync(stage, { recursive: true });
        fs.cpSync(liveDir, stage, { recursive: true });
        const vendorDir = path.join(stage, "vendor");
        fs.mkdirSync(vendorDir, { recursive: true });
        for (const f of GIT_EXPORT_VENDOR_FILES) {
          const src = path.join(ROOT_DIR, "src", "engine", "vendor", f);
          try {
            if (fs.existsSync(src))
              fs.copyFileSync(src, path.join(vendorDir, f));
          } catch {
            /* skip unreadable vendor file */
          }
        }
        const stageIndex = path.join(stage, "index.html");
        try {
          const html = fs.readFileSync(stageIndex, "utf8");
          fs.writeFileSync(
            stageIndex,
            html.replaceAll("/studio/vendor/", "./vendor/"),
            "utf8",
          );
        } catch {
          /* keep un-rewritten index */
        }
        execFileSync("git", ["init", "-b", "main"], {
          cwd: stage,
          encoding: "utf8",
          timeout: 30000,
        });
        execFileSync("git", ["add", "-A"], {
          cwd: stage,
          encoding: "utf8",
          timeout: 30000,
        });
        execFileSync(
          "git",
          [
            "-c",
            "user.name=Agentic Game Studio",
            "-c",
            "user.email=studio@localhost",
            "commit",
            "-m",
            `feat: export ${slug} game`,
          ],
          { cwd: stage, encoding: "utf8", timeout: 30000 },
        );
      } catch (err) {
        return json(res, 200, {
          ok: false,
          error: scrubSecrets(
            String((err && err.message) || err).slice(0, 1000),
          ),
          stage,
        });
      }
      if (!ghCliAvailable()) {
        return json(res, 200, {
          ok: false,
          needsGh: true,
          message: "gh CLI with repo scope required",
          stage,
        });
      }
      try {
        await execFileAsync(
          "gh",
          ["repo", "create", slug, "--public", "--source", stage, "--push"],
          { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 },
        );
        return json(res, 200, { ok: true, pushed: true, stage, repo: slug });
      } catch (err) {
        return json(res, 200, {
          ok: false,
          error: scrubSecrets(
            String((err && err.stderr) || (err && err.message) || err).slice(
              0,
              1000,
            ),
          ),
          stage,
        });
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

// Only bind when run directly (`node src/server.js`); importing this module
// (unit tests for enrichStudioPrompt) must not grab the port.
const __isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (__isMainModule) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[Studio] Agentic Game Studio backend listening on port ${PORT}`,
    );
  });
}
