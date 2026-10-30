#!/usr/bin/env node
/**
 * Agentic Game Studio - NPC dialogue generator.
 *
 * Generates short game-ready NPC lines via Meta Muse Spark Open
 * (Baseten open-weights, cheapest model for short dialogue), with a
 * deterministic local fallback if the provider is down — same
 * primary/fallback shape as src/agent/muse_wonder.js.
 *
 * NOTE: Muse Wonder is intentionally NOT the fallback here: its client
 * (src/agent/meta_wonder.js) only exposes designGame(), a game-architect
 * JSON shape that cannot carry free-form dialogue without inventing a
 * new API shape. Local heuristics cover the offline case instead.
 *
 * Usage:
 *   node src/tools/npc_dialogue.js --character "grumpy shopkeeper" \
 *     --world "desert bazaar" --lines 5 --out dialogue.json
 *
 * Output: JSON array of { speaker, line, mood } objects.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BasetenMuseClient } from "../agent/baseten_muse.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const MODEL_ID = "meta-models/muse-spark-open-1026";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function clampLines(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function fallbackLines(character, world, count) {
  const templates = [
    {
      mood: "gruff",
      line: "Traveler, the sands took my morning stock. Buy quick or haggle elsewhere.",
    },
    {
      mood: "wary",
      line: "The bazaar hears everything. Keep your voice low and your coins lower.",
    },
    {
      mood: "proud",
      line: "My wares crossed three dunes to reach this stall. Nothing here is ordinary.",
    },
    {
      mood: "hurried",
      line: "Storm bells soon. Take what you need and be off before the wind turns.",
    },
    {
      mood: "warm",
      line: "Sit, sit. Tea first, prices after. That is the law of this place.",
    },
    {
      mood: "sly",
      line: "For you, friend, a price I would never speak aloud twice.",
    },
    {
      mood: "tired",
      line: "Forty years of dust and I still open at dawn. Ask, then, what do you seek?",
    },
    {
      mood: "cheerful",
      line: "Fresh dates, brass charms, maps of wells no caravan admits exist.",
    },
    {
      mood: "stern",
      line: "Touch with your eyes first. Break it and the desert keeps you.",
    },
    {
      mood: "hopeful",
      line: "They say rain is coming. Buy something worth celebrating with.",
    },
  ];
  void world;
  return templates.slice(0, count).map((t) => ({
    speaker: character,
    line: t.line,
    mood: t.mood,
  }));
}

function parseDialogueArray(text, character, count) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const cleaned = parsed
    .filter((e) => {
      if (typeof e === "string") return e.trim().length > 0;
      return e && typeof e.line === "string" && e.line.trim();
    })
    .slice(0, count)
    .map((e) => {
      if (typeof e === "string") {
        return {
          speaker: character,
          line: e.trim().slice(0, 200),
          mood: "neutral",
        };
      }
      return {
        speaker:
          typeof e.speaker === "string" && e.speaker.trim()
            ? e.speaker.trim().slice(0, 60)
            : character,
        line: e.line.trim().slice(0, 200),
        mood:
          typeof e.mood === "string" && e.mood.trim()
            ? e.mood.trim().slice(0, 30)
            : "neutral",
      };
    });
  return cleaned.length ? cleaned : null;
}

async function main() {
  const character = argValue("--character", "").trim();
  if (!character) {
    console.error(
      "Usage: npc_dialogue.js --character <name> [--world <w>] [--lines N] [--out file]",
    );
    process.exit(2);
  }
  const world =
    argValue("--world", "mysterious frontier town").trim() ||
    "mysterious frontier town";
  const count = clampLines(argValue("--lines", "5"));
  const outRaw = argValue("--out", "dialogue.json").trim() || "dialogue.json";
  const dest = path.isAbsolute(outRaw) ? outRaw : path.resolve(ROOT, outRaw);

  let lines = null;
  try {
    const client = new BasetenMuseClient();
    const res = await client.generateCompletion(
      "You write short game-ready NPC dialogue lines. Reply with ONLY a JSON array, no markdown fences, no explanation. Each element has keys: speaker (string), line (string, one spoken sentence, max 25 words), mood (one lowercase word).",
      `Character: ${character}\nWorld: ${world}\nWrite exactly ${count} dialogue lines for this NPC. Vary the moods. No trademarked characters or brands.`,
      2000,
    );
    // Budget 2000: Spark Open is a reasoning model and spends tokens
    // thinking (reasoning_content) before emitting content; 500 truncates
    // with finish=length and yields empty content. Verified 30 Oct 2026.
    lines = parseDialogueArray(res.content || "", character, count);
    if (lines) {
      console.log("[npc-dialogue] dialogue generated with open-weights model");
    }
  } catch {
    lines = null;
  }

  if (!lines) {
    lines = fallbackLines(character, world, count);
    console.log("[npc-dialogue] provider unavailable, used local fallback");
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(lines, null, 2)}\n`);
  console.log("[npc-dialogue] dialogue file saved");
}

main().catch(() => {
  console.error("[npc-dialogue] FAILED: unable to generate dialogue");
  process.exit(1);
});
