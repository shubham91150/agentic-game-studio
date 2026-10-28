/**
 * Baseten Client - Meta Muse Spark Open Runner
 *
 * Drives Meta's official open-weight coding & reasoning model (Muse Spark Open)
 * using the $100 Baseten Hackathon credits over the OpenAI-compatible API.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

export class BasetenMuseClient {
  constructor(apiKey = process.env.BASETEN_API_KEY) {
    this.apiKey = apiKey || this.readVaultKey();
    this.baseUrl = "https://inference.baseten.co/v1/chat/completions";
    this.model = process.env.BASETEN_MODEL || "meta-models/muse-spark-open";
  }

  readVaultKey() {
    try {
      const vaultScript =
        "/home/opencode/project-data/workspace/.orchestrator/vault.mjs";
      if (fs.existsSync(vaultScript)) {
        const out = execFileSync("node", [vaultScript, "get", "Baseten_Key"], {
          encoding: "utf8",
        });
        return out.trim() || undefined;
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Generates game code or architecture spec using Meta Muse Spark Open
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {number} maxTokens
   * @returns {Promise<{ content: string, reasoning: string }>}
   */
  async generateCompletion(systemPrompt, userPrompt, maxTokens = 2048) {
    if (!this.apiKey) {
      throw new Error(
        "BASETEN_API_KEY is not set. Please set it in .env or vault.",
      );
    }

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Baseten API error [${response.status}]: ${errText}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message || {};
    return {
      content: msg.content || "",
      reasoning: msg.reasoning_content || "",
    };
  }
}
