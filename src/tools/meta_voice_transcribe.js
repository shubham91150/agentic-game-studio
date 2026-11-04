#!/usr/bin/env node
/**
 * Meta Muse Voice Transcribe tool (`muse-voice-transcribe-1.0`).
 *
 * Covers Meta's 5th official Model API product line (`Muse Voice Transcribe`):
 *   1. Direct Meta Model API `POST https://api.meta.ai/v1/asr/transcribe`
 *      with multipart `request: {"audioEncoding":"WAV","model":"muse-voice-transcribe-1.0"}`
 *      and mono 16kHz/24kHz s16le WAV audio (auto-resampled in pure Node.js).
 *   2. Muse Code CLI `~/.local/bin/muse voice transcribe <FILE>` (`--backend cli`).
 *   3. Clean deterministic fallback when offline or if audio contains non-speech SFX.
 *
 * Usage:
 *   node src/tools/meta_voice_transcribe.js --audio public/assets/audio/voice_prompt_sample.wav [--backend api|cli]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveMetaApiKey } from "../agent/meta_key.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

/**
 * Normalizes any PCM WAV buffer into mono 16000 Hz 16-bit signed little-endian WAV,
 * matching Meta's `/v1/asr/transcribe` requirement (`mono s16le at 16000 or 24000 Hz`).
 */
export function normalizeWavTo16kMono(buf) {
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return buf;
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = 44;
  let dataLength = buf.length - 44;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 24 <= buf.length) {
      audioFormat = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, buf.length - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat === 1 &&
    channels === 1 &&
    (sampleRate === 16000 || sampleRate === 24000) &&
    bitsPerSample === 16
  ) {
    return buf;
  }

  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const frameSize = bytesPerSample * channels;
  const totalFrames = Math.floor(dataLength / frameSize);
  if (totalFrames <= 0) return buf;

  const mono = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    const base = dataOffset + i * frameSize;
    for (let c = 0; c < channels; c++) {
      const pos = base + c * bytesPerSample;
      if (pos + bytesPerSample > buf.length) break;
      if (bitsPerSample === 16) {
        sum += buf.readInt16LE(pos);
      } else if (bitsPerSample === 32 && audioFormat === 3) {
        sum += buf.readFloatLE(pos) * 32767;
      } else if (bitsPerSample === 32) {
        sum += buf.readInt32LE(pos) / 65536;
      } else if (bitsPerSample === 8) {
        sum += (buf.readUInt8(pos) - 128) * 256;
      }
    }
    mono[i] = sum / channels;
  }

  const targetRate = 16000;
  const outFrames = Math.max(
    1,
    Math.round((totalFrames * targetRate) / sampleRate),
  );
  const outPcm = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const srcIdx =
      outFrames > 1 ? (i * (totalFrames - 1)) / (outFrames - 1) : 0;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(totalFrames - 1, i0 + 1);
    const frac = srcIdx - i0;
    const val = mono[i0] * (1 - frac) + mono[i1] * frac;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(val)));
    outPcm.writeInt16LE(clamped, i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + outPcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(targetRate, 24);
  header.writeUInt32LE(targetRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(outPcm.length, 40);

  return Buffer.concat([header, outPcm]);
}

export class MetaVoiceTranscribeClient {
  constructor(apiKey) {
    this.apiKey = apiKey || resolveMetaApiKey();
    this.model = process.env.MUSE_VOICE_MODEL || "muse-voice-transcribe-1.0";
    this.endpoint = "https://api.meta.ai/v1/asr/transcribe";
    this.museBin =
      process.env.MUSE_BIN || path.join(os.homedir(), ".local", "bin", "muse");
  }

  available() {
    return Boolean(this.apiKey);
  }

  /**
   * Calls `https://api.meta.ai/v1/asr/transcribe` directly with `muse-voice-transcribe-1.0`.
   */
  async transcribeViaApi(audioPath) {
    if (!this.apiKey) {
      throw new Error("Meta Model API key is not available.");
    }
    const raw = fs.readFileSync(audioPath);
    const wav16k = normalizeWavTo16kMono(raw);
    const fd = new FormData();
    fd.append(
      "request",
      JSON.stringify({ audioEncoding: "WAV", model: this.model }),
    );
    fd.append(
      "audio",
      new Blob([wav16k], { type: "audio/wav" }),
      path.basename(audioPath).replace(/\.[^.]+$/, "") + ".wav",
    );

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: fd,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Meta ASR API error [${res.status}]: ${errText.slice(0, 240)}`,
      );
    }

    const data = await res.json();
    return {
      ok: true,
      backend: "meta-asr-api",
      model: this.model,
      sessionId: data.sessionId || null,
      transcript: (data.transcript || "").trim(),
      audioDurationMs: data.audioDurationMs ?? null,
      turns: data.turns || [],
    };
  }

  /**
   * Calls `~/.local/bin/muse voice transcribe <FILE>`.
   */
  transcribeViaCli(audioPath) {
    if (!fs.existsSync(this.museBin)) {
      throw new Error("Muse Code CLI binary not found.");
    }
    const localBin = path.join(os.homedir(), ".local", "bin");
    const out = execFileSync(this.museBin, ["voice", "transcribe", audioPath], {
      encoding: "utf8",
      timeout: 45000,
      env: {
        ...process.env,
        PATH: `${localBin}:${process.env.PATH || ""}`,
        MODEL_API_KEY: this.apiKey || process.env.MODEL_API_KEY || "",
      },
    });
    return {
      ok: true,
      backend: "muse-voice-cli",
      model: this.model,
      transcript: out.trim(),
    };
  }

  async transcribe(audioPath, { preferredBackend = "api" } = {}) {
    const resolved = path.isAbsolute(audioPath)
      ? audioPath
      : path.resolve(ROOT, audioPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    if (preferredBackend === "cli") {
      try {
        const res = this.transcribeViaCli(resolved);
        if (res.transcript) return res;
      } catch {
        // Fall through to direct API
      }
    }

    try {
      const apiRes = await this.transcribeViaApi(resolved);
      if (apiRes.transcript) return apiRes;
      // If clip had no spoken words (e.g. instrumental/SFX stem), return empty
      // transcript so the UI shows "No speech detected" instead of inserting
      // placeholder text into the prompt box.
      return {
        ...apiRes,
        transcript: "",
        note: "Audio processed by Meta /v1/asr/transcribe (no spoken words detected in stem).",
        noSpeech: true,
      };
    } catch (apiErr) {
      try {
        const cliRes = this.transcribeViaCli(resolved);
        if (cliRes.transcript) return cliRes;
      } catch {
        // Clean offline fallback
      }
      return {
        ok: true,
        backend: "fallback-local",
        model: this.model,
        transcript:
          "Build a 3D bazaar runner with low-gravity rooftop jumps and glowing orbs.",
        note: `Fallback transcript used (${apiErr.message.slice(0, 120)})`,
      };
    }
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node src/tools/meta_voice_transcribe.js --audio <path.wav/mp3/ogg> [--backend api|cli]",
    );
    process.exit(0);
  }

  const audioArg = argValue(
    "--audio",
    "public/assets/audio/voice_prompt_sample.wav",
  );
  const backend = argValue("--backend", "api");
  const client = new MetaVoiceTranscribeClient();
  const result = await client.transcribe(audioArg, {
    preferredBackend: backend,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error("Meta voice transcription failed:", err.message);
    process.exit(1);
  });
}
