import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// POST /api/studio/voice/transcribe: owner-only Meta muse-voice-
// transcribe-1.0 mic transcription. Scratch server runs with
// STUDIO_VOICE_OFFLINE=1 so the 200-shape test never spends API credits;
// the real Meta path is verified live by hand (one curl, sample wav).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3227;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = `ags-voice-${process.pid}`;
const UPLOADS = path.join(ROOT, "storage", ".uploads");
const SAMPLE = path.join(ROOT, "public", "assets", "audio", "voice_prompt_sample.wav");
const OWNER_ERR =
  "Owner authentication required. Sign in via GitHub at /terminal/ to control the VM studio.";

let server = null;
let beforeUploads = new Set();

function post(pathname, { body, contentType, visitor } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(contentType ? { "content-type": contentType } : {}) };
    if (visitor) {
      headers.host = "spurcode.duckdns.org";
      headers["x-forwarded-for"] = "203.0.113.77";
      headers["x-forwarded-proto"] = "https";
      headers["x-forwarded-host"] = "spurcode.duckdns.org";
    }
    if (body) headers["content-length"] = body.length;
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: pathname, method: "POST", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let j = null;
          try {
            j = JSON.parse(text);
          } catch {
            j = null;
          }
          resolve({ status: res.statusCode, json: j, text });
        });
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function multipart(field, filename, fileBuf, mime) {
  const boundary = `----voicebound${process.pid}${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, fileBuf, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/studio/health`);
      if (r.ok) return;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("scratch server did not boot");
}

before(async () => {
  assert.ok(fs.existsSync(SAMPLE), "voice sample wav must exist");
  beforeUploads = new Set(fs.readdirSync(UPLOADS));
  server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDIO_PORT: String(PORT),
      STUDIO_TMUX_SESSION: SCRATCH,
      STUDIO_VOICE_OFFLINE: "1",
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  try {
    if (server) server.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  server = null;
  try {
    for (const f of fs.readdirSync(UPLOADS)) {
      if (!beforeUploads.has(f)) fs.rmSync(path.join(UPLOADS, f));
    }
  } catch {
    /* ignore */
  }
});

test("visitor voice transcribe → 401, writes no file", async () => {
  const wav = fs.readFileSync(SAMPLE);
  const mp = multipart("audio", "mic.webm", wav, "audio/webm");
  const r = await post("/api/studio/voice/transcribe", {
    body: mp.body,
    contentType: mp.contentType,
    visitor: true,
  });
  assert.equal(r.status, 401);
  assert.equal(r.json && r.json.error, OWNER_ERR);
  assert.deepEqual(new Set(fs.readdirSync(UPLOADS)), beforeUploads);
});

test("owner voice transcribe without audio → 400", async () => {
  const r = await post("/api/studio/voice/transcribe", {
    body: Buffer.from(JSON.stringify({})),
    contentType: "application/json",
  });
  assert.equal(r.status, 400);
  const mp = multipart("note", "x.txt", Buffer.from("hi"), "text/plain");
  const r2 = await post("/api/studio/voice/transcribe", {
    body: mp.body,
    contentType: mp.contentType,
  });
  assert.equal(r2.status, 400);
});

test("owner voice transcribe multipart → 200 offline shape + file saved", async () => {
  const wav = fs.readFileSync(SAMPLE);
  const mp = multipart("audio", "mic.webm", wav, "audio/webm");
  const r = await post("/api/studio/voice/transcribe", {
    body: mp.body,
    contentType: mp.contentType,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json && r.json.ok, true);
  assert.equal(r.json && r.json.model, "muse-voice-transcribe-1.0");
  assert.ok((r.json && r.json.transcript ? String(r.json.transcript) : "").length > 0);
  const after = new Set(fs.readdirSync(UPLOADS));
  const added = [...after].filter((f) => !beforeUploads.has(f));
  assert.equal(added.length, 1, "exactly one upload saved");
  assert.match(added[0], /_voice\./);
});
