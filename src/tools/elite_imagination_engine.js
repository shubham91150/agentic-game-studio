#!/usr/bin/env node
/**
 * Elite Imagination & Goosebump Reference Engine (`src/tools/elite_imagination_engine.js`)
 *
 * Gives the agent "Imagination Power" + "Comprehensive Reference Power" before
 * building or upgrading any game. Combines Meta `muse-wonder-1.0` / Baseten
 * `meta-models/muse-spark-open-1026` with our curated Elite Game Archetype Bible
 * (Hitman World of Assassination, Resident Evil RE2/RE7/Village, Hello Neighbor 2,
 * Forza Horizon, Elden Ring) to output:
 *   1. Sensory & Goosebump Micro-Details (autonomous props, proximity light flicker, diegetic cues)
 *   2. Clockwork Systemic Mechanics (distraction lures, sabotage chains, hiding/peeking, AI heatmap adaptation)
 *   3. Multi-Step Puzzle & Progression Chain (interconnected lock-and-key / mechanism loops)
 *   4. Exact 3D Asset & PBR Material Recipe mapped to local `/studio/assets/polyhaven/`, `ambientcg`, and `models`
 *
 * Usage:
 *   node src/tools/elite_imagination_engine.js --prompt "gothic convent stealth horror" --archetype "hitman+resident-evil+hello-neighbor" --out storage/cache/imagination_spec.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BasetenMuseClient } from "../agent/baseten_muse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");

const ARCHETYPE_BIBLES = {
  hitman: {
    referenceGames: ["Hitman: World of Assassination", "Dishonored 2"],
    clockworkMechanics: [
      "Acoustic Distraction Lures: ringing a bell, winding a grandfather clock, or tossing a lure emits a spatial stimulus (stimX, stimZ) that pulls the enemy into INVESTIGATE state for 7s.",
      "Environmental Sabotage: chandeliers, fuseboxes, and lanterns can be triggered to create blackouts or diversions.",
      "Swiss-Cheese 3-Route Topology: every objective has a Direct Route, a Flanking Classroom/Cabinet Stealth Route, and a Distraction Lure Route.",
      "Focus/Instinct Sense: brief pulse highlighting interactive mechanisms, hiding closets, and threat acoustic ripples.",
    ],
  },
  "resident-evil": {
    referenceGames: [
      "Resident Evil 2 Remake",
      "Resident Evil 7",
      "Resident Evil Village",
    ],
    clockworkMechanics: [
      "Multi-Step Puzzle Box Chain: search drawer_cabinet/treasure_chest to find a Winding Key or Chime -> use on vintage_grandfather_clock_01 -> clock tolls loudly (luring stalker away) and unlocks the Chapel Key.",
      "Light-vs-Stealth Trade-off: Torch ON gives clear vision but 14m enemy sight detection; Torch OFF reduces detection to 6m using moonlight shafts.",
      "Safe-Room Warm Amber vs Stalker Cold Teal Contrast with dynamic heartbeat (65->145 BPM) and cathedral ConvolverNode reverb.",
    ],
  },
  "hello-neighbor": {
    referenceGames: ["Hello Neighbor 2", "Little Nightmares II"],
    clockworkMechanics: [
      "Tactile Wardrobe Peek-and-Hide (GothicCabinet_01): press E to step inside, peek through the door crack, muffle audio (600Hz low-pass), and evade capture unless seen entering.",
      "Adaptive AI Room Heatmap Memory: tracks which room the player camps in most and biases the stalker's patrol spurs + AI Director orders toward that room.",
      "Living Autonomous Micro-Details: self-rocking Rockingchair_01, swaying Chandelier_01, ticking vintage_grandfather_clock_01, and proximity lantern flicker when threat is within 9m.",
    ],
  },
  racing: {
    referenceGames: ["Forza Horizon 5", "Need for Speed Heat"],
    clockworkMechanics: [
      "Weight-Transfer Arcade-Sim Physics: cornering body roll, slip-angle tire smoke/skidmarks, boost FOV warp, and destructible roadside props.",
      "Living World Traffic & Weather: dynamic time-of-day/wet-asphalt reflections, AI rival rubber-banding + overtake lines, and 3-stage engine harmonic synthesis.",
    ],
  },
};

export async function generateEliteImaginationBlueprint(
  prompt,
  archetypeStr = "hitman+resident-evil+hello-neighbor",
) {
  const keys = archetypeStr
    .toLowerCase()
    .split(/[+,/\s]+/)
    .filter(Boolean);
  const selectedBibles = keys.map((k) => ARCHETYPE_BIBLES[k]).filter(Boolean);
  if (selectedBibles.length === 0) {
    selectedBibles.push(
      ARCHETYPE_BIBLES.hitman,
      ARCHETYPE_BIBLES["resident-evil"],
      ARCHETYPE_BIBLES["hello-neighbor"],
    );
  }

  const baseBlueprint = {
    prompt,
    archetypes: keys,
    references: selectedBibles.flatMap((b) => b.referenceGames),
    systemicMechanics: selectedBibles.flatMap((b) => b.clockworkMechanics),
    goosebumpMicroDetails: [
      "Autonomous Rockingchair_01 gently rocking in the shadows (sin(t*1.4)*0.06 rad)",
      "Swaying ceiling Chandelier_01 & lantern_chandelier_01 with warm UnrealBloomPass halos",
      "Proximity EM Lantern Flicker when enemy is within 9m of player",
      "First-person 3D held Lantern_01 viewmodel with look-lag inertia, walk-bob, and proximity tremor",
      "Ground Contact Shadow AO discs under every desk, chair, cabinet, pew, and clock",
      "4-Bus WebAudio with 1.6s Cathedral ConvolverNode reverb, StereoPannerNode 3D footsteps, and 65->145 BPM proximity heartbeat",
    ],
    polyhavenHeroKit: [
      "/studio/assets/polyhaven/SchoolDesk_01/SchoolDesk_01_1k.glb",
      "/studio/assets/polyhaven/SchoolChair_01/SchoolChair_01_1k.glb",
      "/studio/assets/polyhaven/GothicCabinet_01/GothicCabinet_01_1k.glb",
      "/studio/assets/polyhaven/large_castle_door/large_castle_door_1k.glb",
      "/studio/assets/polyhaven/wooden_bookshelf_worn/wooden_bookshelf_worn_1k.glb",
      "/studio/assets/polyhaven/Chandelier_01/Chandelier_01_1k.glb",
      "/studio/assets/polyhaven/lantern_chandelier_01/lantern_chandelier_01_1k.glb",
      "/studio/assets/polyhaven/painted_wooden_bench/painted_wooden_bench_1k.glb",
      "/studio/assets/polyhaven/brass_candleholders/brass_candleholders_1k.glb",
      "/studio/assets/polyhaven/book_encyclopedia_set_01/book_encyclopedia_set_01_1k.glb",
      "/studio/assets/polyhaven/vintage_grandfather_clock_01/vintage_grandfather_clock_01_1k.glb",
      "/studio/assets/polyhaven/hanging_picture_frame_01/hanging_picture_frame_01_1k.glb",
      "/studio/assets/polyhaven/wheelchair_01/wheelchair_01_1k.glb",
      "/studio/assets/polyhaven/Rockingchair_01/Rockingchair_01_1k.glb",
      "/studio/assets/polyhaven/drawer_cabinet/drawer_cabinet_1k.glb",
      "/studio/assets/polyhaven/treasure_chest/treasure_chest_1k.glb",
    ],
  };

  try {
    const client = new BasetenMuseClient();
    const res = await client.generateCompletion(
      "You are an elite AAA Game Director (Hitman: World of Assassination, Resident Evil Village, Hello Neighbor 2). Reply with concise, concrete game mechanics and micro-details.",
      `For this game concept: "${prompt}", list 4 specific goosebump micro-details and 2 clockwork systemic player-vs-AI interactions in concise bullet points.`,
      320,
    );
    const aiIdeas = res && res.content;
    if (aiIdeas && typeof aiIdeas === "string" && aiIdeas.trim().length > 20) {
      baseBlueprint.aiCreativeDirectorNotes = aiIdeas.trim();
      baseBlueprint.enrichmentModel = "meta-models/muse-spark-open-1026";
    }
  } catch {
    baseBlueprint.enrichmentModel = "local-elite-bible";
  }

  return baseBlueprint;
}

async function main() {
  const argv = process.argv.slice(2);
  let prompt = "Gothic convent stealth horror game";
  let archetype = "hitman+resident-evil+hello-neighbor";
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prompt" && argv[i + 1]) prompt = argv[++i];
    else if (argv[i] === "--archetype" && argv[i + 1]) archetype = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
  }
  const spec = await generateEliteImaginationBlueprint(prompt, archetype);
  const jsonStr = JSON.stringify(spec, null, 2);
  if (out) {
    const outPath = path.resolve(ROOT_DIR, out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, jsonStr, "utf8");
  }
  console.log(jsonStr);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
