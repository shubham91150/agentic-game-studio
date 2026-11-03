import test from "node:test";
import assert from "node:assert/strict";

import { enrichStudioPrompt } from "../src/server.js";

// Smart power-router: build requests get the routing directive appended,
// slash commands / confirmations / short chat pass through untouched.
// (Importing server.js must NOT bind :3030 — the live server holds it, so
// a broken listen guard would crash this file with EADDRINUSE.)

test("slash commands pass through as-is", () => {
  for (const p of ["/model", "/help", "/clear", "/mcp status", "/usage"]) {
    assert.equal(enrichStudioPrompt(p, {}), p);
  }
});

test("short confirmations pass through as-is", () => {
  for (const p of ["yes", "ha", "ok", "continue", "Yes!", "  ok  ", "haan"]) {
    assert.equal(enrichStudioPrompt(p, {}), p);
  }
});

test("short conversational replies pass through as-is", () => {
  assert.equal(enrichStudioPrompt("hi", {}), "hi");
  assert.equal(enrichStudioPrompt("thanks", {}), "thanks");
  assert.equal(enrichStudioPrompt("", {}), "");
  assert.equal(enrichStudioPrompt(null, {}), "");
  assert.equal(enrichStudioPrompt(undefined, {}), "");
});

test("short build verbs still enrich (fix it / banao / add jump)", () => {
  for (const p of ["fix it", "banao!", "add jump"]) {
    const out = enrichStudioPrompt(p, {});
    assert.ok(
      out.includes("tool-routing-matrix.md"),
      `${p} must enrich, got: ${out}`,
    );
    assert.ok(out.startsWith(p.replace(/!$/, "").trim()) || out.startsWith(p));
  }
});

test("1-line EN build prompt enriches with directive", () => {
  const out = enrichStudioPrompt("make a medieval dungeon game", {});
  assert.ok(out.startsWith("make a medieval dungeon game"));
  assert.ok(out.includes("[Studio Context:"));
  assert.ok(out.includes("scope=game"));
  assert.ok(out.includes("skills=none"));
  assert.ok(out.includes("attachments=none"));
  assert.ok(out.includes("tool-routing-matrix.md"));
  assert.ok(out.includes("subagent_spawn"));
  assert.ok(out.includes("visual_qa_gate.js"));
});

test("1-line Hinglish build prompt enriches", () => {
  const out = enrichStudioPrompt("ek racing game banao", {});
  assert.ok(out.startsWith("ek racing game banao"));
  assert.ok(out.includes("tool-routing-matrix.md"));
});

test("scope/skills/attachments interpolate into the directive", () => {
  const out = enrichStudioPrompt("build a car", {
    scope: "model",
    skills: ["threejs", "ui-taste"],
    attachments: ["board.png"],
  });
  assert.ok(out.includes("scope=model"));
  assert.ok(out.includes("skills=threejs, ui-taste"));
  assert.ok(out.includes("attachments=1 file(s): board.png"));
});

test("scope/skills/attachments sanitize + default safely", () => {
  const out = enrichStudioPrompt("build a car", {
    scope: 123,
    skills: "not-an-array",
    attachments: [{ name: "ref.webp" }, 42, null],
  });
  assert.ok(out.includes("scope=game"));
  assert.ok(out.includes("skills=none"));
  assert.ok(out.includes("attachments=1 file(s): ref.webp"));
  const trim = enrichStudioPrompt("build a car", { scope: "  world  " });
  assert.ok(trim.includes("scope=world"));
});

test("long implicit work feedback enriches (no skipped tools)", () => {
  const out = enrichStudioPrompt("the lantern looks too dim in classroom B", {});
  assert.ok(out.includes("tool-routing-matrix.md"));
});
