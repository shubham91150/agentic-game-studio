/* Judges brief — live verifier + assistant console. No inline handlers (CSP). */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------- Demo video: reduced-motion + missing-file honesty ---------- */
  (function initVideo() {
    const video = $("demo-video");
    const missing = $("video-missing");
    if (!video) return;
    try {
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        video.removeAttribute("autoplay");
        video.pause();
      }
    } catch (e) {
      /* media query unavailable: leave the default */
    }
    video.addEventListener("error", function () {
      if (missing) missing.classList.remove("hidden");
    });
    const src = video.querySelector("source");
    if (src) {
      src.addEventListener("error", function () {
        if (missing) missing.classList.remove("hidden");
      });
    }
  })();

  /* ---------- Live browser verifier ---------- */
  function hex(bytes) {
    return Array.prototype.map
      .call(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  async function sha256Hex(text) {
    if (
      !window.crypto ||
      !window.crypto.subtle ||
      !window.crypto.subtle.digest
    ) {
      return null;
    }
    const data = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return hex(new Uint8Array(digest));
  }

  async function probe(name, fn) {
    const started = performance.now();
    try {
      const detail = await fn();
      return {
        name: name,
        ok: true,
        ms: Math.round(performance.now() - started),
        detail: detail,
      };
    } catch (err) {
      return {
        name: name,
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: err && err.message ? err.message : "request failed",
      };
    }
  }

  function summarizeHealth(j) {
    const c = (j && j.components) || {};
    return (
      "service=" +
      (j.service || "?") +
      " cli=" +
      (c.cliModel || "?") +
      " planner=" +
      (c.plannerModel || "?") +
      " gvisor=" +
      String(c.gvisorSandbox)
    );
  }

  function summarizeGit(j) {
    const head = (j && j.head) || {};
    return (
      "branch=" +
      (j.branch || "?") +
      " sha=" +
      (head.shortSha || head.sha || "?") +
      " dirty=" +
      (j.dirtyCount === undefined ? "?" : j.dirtyCount)
    );
  }

  function summarizeDirector(j) {
    return (
      "model=" +
      (j.model || "?") +
      " cached=" +
      String(j.cached) +
      " tactic=" +
      (j.tactic || "?") +
      " env=" +
      (j.envEvent || "?")
    );
  }

  async function runVerification() {
    const btn = $("verify-btn");
    const status = $("verify-status");
    const receipt = $("receipt");
    if (!btn || !status || !receipt) return;
    btn.disabled = true;
    status.textContent = "Contacting health, git status, and the AI director…";
    receipt.classList.add("hidden");
    receipt.textContent = "";

    const results = [];
    results.push(
      await probe("GET /api/studio/health", async function () {
        const r = await fetch("/api/studio/health");
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (!j || j.ok !== true) throw new Error("ok !== true");
        return { raw: j, summary: summarizeHealth(j) };
      }),
    );
    results.push(
      await probe("GET /api/studio/git/status", async function () {
        const r = await fetch("/api/studio/git/status");
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (!j || j.ok !== true) throw new Error("ok !== true");
        return { raw: j, summary: summarizeGit(j) };
      }),
    );
    results.push(
      await probe("POST /api/studio/ai/director", async function () {
        const r = await fetch("/api/studio/ai/director", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room: "Chapel",
            enemyState: "stalk",
            hasKey: false,
            torchOn: true,
            dist: 5,
            noise: 20,
          }),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (!j || j.ok !== true) throw new Error("ok !== true");
        return { raw: j, summary: summarizeDirector(j) };
      }),
    );

    const timestamp = new Date().toISOString();
    const sealed = {};
    results.forEach(function (r) {
      sealed[r.name] = r.ok ? r.detail.raw : { error: r.detail };
    });
    const digest = await sha256Hex(
      JSON.stringify({ responses: sealed, timestamp: timestamp }),
    );

    const allOk = results.every(function (r) {
      return r.ok;
    });
    const head = el("div", "receipt-head");
    head.appendChild(
      el("span", "receipt-badge " + (allOk ? "ok" : "fail"), allOk ? "VERIFIED" : "NOT VERIFIED"),
    );
    head.appendChild(
      el(
        "span",
        null,
        allOk
          ? "Three live endpoints answered 200 with ok:true."
          : "One or more endpoints failed — see which below. No green receipt was issued.",
      ),
    );
    receipt.appendChild(head);

    const meta = document.createElement("dl");
    meta.className = "receipt-meta";
    const dt1 = el("dt", null, "Timestamp (UTC)");
    const dd1 = el("dd", null, timestamp);
    const dt2 = el("dt", null, "SHA-256 over the three responses + timestamp");
    const dd2 = el(
      "dd",
      null,
      digest === null ? "unavailable in this browser (crypto.subtle missing)" : digest,
    );
    meta.appendChild(dt1);
    meta.appendChild(dd1);
    meta.appendChild(dt2);
    meta.appendChild(dd2);
    receipt.appendChild(meta);

    const list = el("ul", "receipt-rows");
    results.forEach(function (r) {
      const li = document.createElement("li");
      li.appendChild(el("span", "pill " + (r.ok ? "ok" : "fail"), r.ok ? "ok" : "fail"));
      const body = el("div", null);
      body.appendChild(el("div", null, r.name + " · " + r.ms + " ms"));
      body.appendChild(
        el(
          "div",
          null,
          r.ok ? r.detail.summary : "failed: " + String(r.detail).slice(0, 200),
        ),
      );
      li.appendChild(body);
      list.appendChild(li);
    });
    receipt.appendChild(list);
    receipt.classList.remove("hidden");
    status.textContent = allOk
      ? "Receipt sealed. Re-run anytime — the digest changes with fresh responses."
      : "Receipt shows failures honestly. Check the server and run again.";
    btn.disabled = false;
  }

  /* ---------- Judge AI assistant console ---------- */
  var REPO_BLOB = "https://github.com/shubham91150/agentic-game-studio/blob/main/";
  var CITE_RE = /^([\w./-]+\.[A-Za-z0-9]+):(\d+)$/;

  function citeBadge(citation) {
    const text = String(citation);
    const m = CITE_RE.exec(text);
    if (!m) return el("span", "cite", text);
    const a = document.createElement("a");
    a.className = "cite";
    a.textContent = text;
    a.href = REPO_BLOB + m[1] + "#L" + m[2];
    a.target = "_blank";
    a.rel = "noreferrer";
    return a;
  }

  function appendMessage(kind, question, answer, citations) {
    const transcript = $("assistant-transcript");
    if (!transcript) return;
    const empty = $("assistant-empty");
    if (empty) empty.remove();
    const wrap = el("div", "msg msg-enter");
    wrap.appendChild(el("p", "msg-q", question));
    if (kind === "error") {
      wrap.appendChild(el("p", "msg-err", answer));
    } else {
      wrap.appendChild(el("p", "msg-a", answer));
      if (citations && citations.length) {
        const cites = el("div", "msg-cites");
        citations.forEach(function (c) {
          cites.appendChild(citeBadge(c));
        });
        wrap.appendChild(cites);
      }
    }
    transcript.appendChild(wrap);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function setAssistantBusy(busy, note) {
    const send = $("assistant-send");
    const input = $("assistant-input");
    const status = $("assistant-status");
    const pills = document.querySelectorAll(".pill-btn");
    if (send) send.disabled = busy;
    if (input) input.disabled = busy;
    pills.forEach(function (p) {
      p.disabled = busy;
    });
    if (status) status.textContent = note || "";
  }

  async function askAssistant(question) {
    const q = String(question || "").trim();
    if (!q) return;
    setAssistantBusy(true, "Asking the studio…");
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 15000);
    try {
      const r = await fetch("/api/studio/judge-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.slice(0, 500) }),
        signal: controller.signal,
      });
      const j = await r.json().catch(function () {
        return null;
      });
      if (!r.ok || !j || j.ok !== true) {
        const why =
          (j && j.error) || "HTTP " + r.status + " from the assistant endpoint";
        appendMessage(
          "error",
          q,
          "No answer this time (" + String(why).slice(0, 160) + "). Check your connection and ask again — nothing here was faked.",
          [],
        );
      } else {
        appendMessage("ok", q, j.answer || "(empty answer)", j.citations || []);
        const model = $("assistant-model");
        if (model) {
          model.textContent =
            "answered by " + (j.model || "unknown") + (j.cached ? " · cached" : "");
        }
      }
      setAssistantBusy(false, "");
    } catch (err) {
      appendMessage(
        "error",
        q,
        "The request did not reach the studio (" +
          (err && err.name === "AbortError" ? "timed out after 15s" : "network error") +
          "). Try again — the console stays ready.",
        [],
      );
      setAssistantBusy(false, "");
    } finally {
      clearTimeout(timer);
    }
  }

  function initAssistant() {
    const form = $("assistant-form");
    const input = $("assistant-input");
    if (form && input) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        const q = input.value;
        input.value = "";
        askAssistant(q);
      });
    }
    const pills = document.querySelectorAll(".pill-btn");
    pills.forEach(function (p) {
      p.addEventListener("click", function () {
        askAssistant(p.getAttribute("data-question") || p.textContent);
      });
    });
  }

  /* ---------- Wire up ---------- */
  (function init() {
    const btn = $("verify-btn");
    if (btn) btn.addEventListener("click", runVerification);
    initAssistant();
  })();
})();
