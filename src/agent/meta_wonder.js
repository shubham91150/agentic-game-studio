/**
 * Meta Muse Wonder client — high-reasoning game architect.
 * Direct Meta Model API (Responses API), model `muse-wonder-1.0`.
 * Verified live against https://api.meta.ai/v1/responses.
 */

import { resolveMetaApiKey } from "./meta_key.js";

export class MetaWonderClient {
  constructor(apiKey) {
    this.apiKey = apiKey || resolveMetaApiKey();
    this.model = process.env.MUSE_WONDER_MODEL || "muse-wonder-1.0";
    this.baseUrl = "https://api.meta.ai/v1/responses";
  }

  available() {
    return Boolean(this.apiKey);
  }

  /**
   * Asks Wonder for a structured game design as JSON.
   * @returns {Promise<{text: string, design: object|null}>}
   */
  async designGame(prompt) {
    if (!this.apiKey) throw new Error("Meta Model API key is not available.");

    const instructions =
      "You are the lead game architect for a 3D browser game studio. " +
      "Answer with ONLY a JSON object, no markdown fences, with keys: " +
      "title (string, max 5 words), biome (one of: cyber-orbital, desert-canyon, subzero-glacier, bioluminescent-canopy), " +
      "gravity (number, negative, between -30 and -5), playerSpeed (number 6-24), jumpVelocity (number 6-16), " +
      "objective (one sentence), focalAssets (array of exactly 3 objects with prompt and role: player|collectible|obstacle). " +
      "Design for a third-person collect-the-orbs game playable with WASD and touch joystick.";

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions,
        input: prompt,
        reasoning: { effort: "medium" },
        max_output_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta Wonder API error [${res.status}]: ${body.slice(0, 200)}`,
      );
    }

    const data = await res.json();
    let text = data.output_text || "";
    if (!text && Array.isArray(data.output)) {
      for (const item of data.output) {
        for (const part of item.content || []) {
          if (part.type === "output_text") text += part.text;
        }
      }
    }

    let design = null;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        design = JSON.parse(match[0]);
      } catch {
        design = null;
      }
    }
    return { text, design };
  }
}
