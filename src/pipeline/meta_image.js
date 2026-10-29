/**
 * Meta Muse Image client — concept/key art for a generated game.
 * Direct Meta Model API, model `muse-image-1.0`.
 * Verified live against https://api.meta.ai/v1/images/generations
 * (returns data[0].b64_json, WebP).
 */

import { resolveMetaApiKey } from "../agent/meta_key.js";

export class MetaImageClient {
  constructor(apiKey) {
    this.apiKey = apiKey || resolveMetaApiKey();
    this.model = process.env.MUSE_IMAGE_MODEL || "muse-image-1.0";
    this.baseUrl = "https://api.meta.ai/v1/images/generations";
    this.editUrl = "https://api.meta.ai/v1/images/edits";
  }

  available() {
    return Boolean(this.apiKey);
  }

  /**
   * @returns {Promise<Buffer>} decoded image bytes (WebP)
   */
  async generateConceptImage(prompt) {
    if (!this.apiKey) throw new Error("Meta Model API key is not available.");
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, prompt, n: 1 }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta Image API error [${res.status}]: ${body.slice(0, 200)}`,
      );
    }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("Meta Image API returned no image data.");
    return Buffer.from(b64, "base64");
  }

  /**
   * Edit an existing image via Meta Muse Image edits endpoint.
   * @returns {Promise<Buffer>} decoded image bytes (WebP)
   */
  async editImage(imageBuffer, mime, prompt) {
    if (!this.apiKey) throw new Error("Meta Model API key is not available.");
    const dataUrl = `data:${mime || "image/png"};base64,${imageBuffer.toString("base64")}`;
    const res = await fetch(this.editUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        images: [{ image_url: dataUrl }],
        n: 1,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta Image edit error [${res.status}]: ${body.slice(0, 200)}`,
      );
    }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("Meta Image edit returned no image data.");
    return Buffer.from(b64, "base64");
  }
}
