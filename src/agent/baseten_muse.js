/**
 * Baseten Client - Meta Muse Spark Open Runner
 *
 * Drives Meta's official open-weight coding & reasoning model (Muse Spark Open)
 * using the $100 Baseten Hackathon credits over the OpenAI-compatible API.
 */

export class BasetenMuseClient {
  constructor(apiKey = process.env.BASETEN_API_KEY) {
    this.apiKey = apiKey;
    this.baseUrl = "https://inference.baseten.co/v1/chat/completions";
    // Hackathon guide specifies meta-models/muse-spark-open (or muse-spark-open-1026)
    this.model = process.env.BASETEN_MODEL || "meta-models/muse-spark-open";
  }

  /**
   * Generates game code or architecture spec using Meta Muse Spark Open
   * @param {string} systemPrompt
   * @param {string} userPrompt
   */
  async generateCompletion(systemPrompt, userPrompt) {
    if (!this.apiKey) {
      throw new Error("BASETEN_API_KEY is not set. Please set it in .env");
    }

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
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
    return data.choices?.[0]?.message?.content || "";
  }
}
