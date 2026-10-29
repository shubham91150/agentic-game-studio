/* Agentic Game Studio — DarkCodeGPT-style front page client.
 * No inline scripts anywhere (CSP script-src 'self'): all logic lives here. */
(function () {
  "use strict";

  var promptEl = document.getElementById("prompt");
  var formEl = document.getElementById("prompt-form");
  var modelEl = document.getElementById("model-select");
  var attachBtn = document.getElementById("attach-btn");
  var fileInput = document.getElementById("file-input");
  var attachList = document.getElementById("attach-list");
  var sendBtn = document.getElementById("send-btn");
  var statusEl = document.getElementById("status");
  var liveDot = document.getElementById("live-dot");
  var liveText = document.getElementById("live-text");
  var resultEl = document.getElementById("result");
  var titleEl = document.getElementById("game-title");
  var frameEl = document.getElementById("game-frame");
  var consoleEl = document.getElementById("console");
  var tokenLine = document.getElementById("token-line");
  var qrBox = document.getElementById("qr-box");
  var qrImage = document.getElementById("qr-image");
  var codeBox = document.getElementById("code-box");

  var attachments = [];
  var running = false;
  var playUrl = "";
  var unityCode = "";

  var MODEL_FOR_AGENT = {
    "muse-code": "muse-spark-1.3",
    "muse-wonder": "muse-wonder-1.0",
  };

  function setStatus(text, cls) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (cls ? " " + cls : "");
  }

  function log(text, cls) {
    var div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function setBusy(busy) {
    running = busy;
    sendBtn.disabled = busy;
    sendBtn.classList.toggle("busy", busy);
    Array.prototype.forEach.call(
      document.querySelectorAll(".chip"),
      function (chip) {
        chip.disabled = busy;
      },
    );
  }

  // VM backend health check
  fetch("/api/studio/health")
    .then(function (res) {
      if (!res.ok) throw new Error("offline");
      return res.json();
    })
    .then(function (data) {
      if (data && data.ok) {
        liveDot.className = "live-dot on";
        liveText.textContent = "vm live";
      } else {
        throw new Error("offline");
      }
    })
    .catch(function () {
      liveDot.className = "live-dot off";
      liveText.textContent = "vm offline";
    });

  // Example chips fill the prompt
  Array.prototype.forEach.call(
    document.querySelectorAll(".chip"),
    function (chip) {
      chip.addEventListener("click", function () {
        if (running) return;
        promptEl.value =
          "Build a " +
          chip.textContent.trim().toLowerCase() +
          " game with precise physics, collectible beacons, and collision-aware movement.";
        promptEl.focus();
      });
    },
  );

  // Ctrl/Cmd+Enter submits
  promptEl.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });

  attachBtn.addEventListener("click", function () {
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = "";
    files.forEach(function (file) {
      if (file.size > 10 * 1024 * 1024) {
        setStatus('"' + file.name + '" is over 10MB — skipped.', "error");
        return;
      }
      setStatus('Uploading "' + file.name + '"…');
      fetch("/api/studio/upload?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      })
        .then(function (res) {
          if (!res.ok) throw new Error("upload failed: " + res.status);
          return res.json();
        })
        .then(function (data) {
          attachments.push(data);
          renderAttachments();
          setStatus('Attached "' + data.name + '".', "ok");
        })
        .catch(function () {
          setStatus('Could not upload "' + file.name + '".', "error");
        });
    });
  });

  function renderAttachments() {
    attachList.innerHTML = "";
    attachments.forEach(function (a) {
      var chip = document.createElement("span");
      chip.className = "attach-chip";
      var label = document.createElement("span");
      label.textContent = a.name;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + a.name);
      remove.addEventListener("click", function () {
        attachments = attachments.filter(function (x) {
          return x.id !== a.id;
        });
        renderAttachments();
      });
      chip.appendChild(label);
      chip.appendChild(remove);
      attachList.appendChild(chip);
    });
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case "start":
        log('Run started: "' + evt.prompt + '"');
        break;
      case "log":
        log(
          evt.message,
          evt.level === "ok"
            ? "ok"
            : evt.level === "warn"
              ? "warn"
              : evt.level === "error"
                ? "error"
                : "",
        );
        break;
      case "cli":
        log((evt.stream === "stderr" ? "! " : "$ ") + evt.line, "cli");
        break;
      case "reasoning":
        log("· " + evt.line, "reason");
        break;
      case "proof":
        log(
          "[proof] " + evt.name + " — " + (evt.passed ? "PASSED" : "FAILED"),
          evt.passed ? "ok" : "warn",
        );
        break;
      case "artifact":
        if (evt.kind === "unity") {
          unityCode = evt.content || "";
          codeBox.textContent = unityCode;
          log(
            evt.source === "muse-cli"
              ? "Unity C# received from Muse Code CLI."
              : "Unity C# is from the local template fallback.",
            evt.source === "muse-cli" ? "ok" : "warn",
          );
        }
        break;
      case "usage": {
        var totals = (evt.models || []).reduce(
          function (acc, m) {
            return {
              in: acc.in + (m.input_tokens || 0),
              out: acc.out + (m.output_tokens || 0),
              cached: acc.cached + (m.cached_tokens || 0),
            };
          },
          { in: 0, out: 0, cached: 0 },
        );
        tokenLine.textContent =
          "CLI " + totals.in + " in / " + totals.out + " out";
        log(
          "CLI tokens this run: " +
            totals.in +
            " in / " +
            totals.out +
            " out (" +
            totals.cached +
            " cached)",
        );
        break;
      }
      case "error":
        log(evt.message, "error");
        break;
      case "done":
        if (evt.ok && evt.playUrl) {
          playUrl = evt.playUrl;
          titleEl.textContent = evt.title || "Your game";
          frameEl.src = evt.playUrl + "?t=" + Date.now();
          resultEl.classList.remove("hidden");
          setStatus(
            'Game ready: "' +
              (evt.title || "") +
              '" in ' +
              (evt.elapsedMs / 1000).toFixed(1) +
              "s",
            "ok",
          );
          log('Game ready: "' + (evt.title || "") + '"', "ok");
          resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          setStatus("Run finished without a playable game.", "error");
          log("Run finished without a playable game.", "error");
        }
        break;
      default:
        break;
    }
  }

  function readStream(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        parts.forEach(function (block) {
          block.split("\n").forEach(function (line) {
            if (line.indexOf("data:") !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload) return;
            try {
              handleEvent(JSON.parse(payload));
            } catch (e) {
              /* ignore malformed frame */
            }
          });
        });
        return pump();
      });
    }
    return pump();
  }

  formEl.addEventListener("submit", function (event) {
    event.preventDefault();
    if (running) return;
    var prompt = promptEl.value.trim();
    if (!prompt) return;
    var model = modelEl.value;

    running = true;
    setBusy(true);
    setStatus("Agent is running on the VM…");
    consoleEl.innerHTML = "";
    tokenLine.textContent = "";
    resultEl.classList.add("hidden");
    qrBox.classList.add("hidden");
    codeBox.classList.add("hidden");

    var controller = new AbortController();
    fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        model: model,
        attachments: attachments.map(function (a) {
          return { id: a.id, name: a.name };
        }),
      }),
      signal: controller.signal,
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          throw new Error("Backend answered " + res.status);
        }
        return readStream(res);
      })
      .catch(function (err) {
        if (err && err.name !== "AbortError") {
          setStatus(
            "Build failed — connection to the VM backend was lost.",
            "error",
          );
          log("Connection to VM backend failed during the run.", "error");
        }
      })
      .then(function () {
        running = false;
        setBusy(false);
      });
  });

  document
    .getElementById("btn-fullscreen")
    .addEventListener("click", function () {
      if (frameEl.requestFullscreen) frameEl.requestFullscreen();
    });

  document.getElementById("btn-qr").addEventListener("click", function () {
    var url = playUrl
      ? window.location.origin + playUrl
      : window.location.origin + "/";
    qrImage.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
      encodeURIComponent(url);
    qrBox.classList.toggle("hidden");
  });

  document.getElementById("btn-code").addEventListener("click", function () {
    if (!unityCode) {
      setStatus("No Unity code yet — run a build first.", "error");
      return;
    }
    codeBox.classList.toggle("hidden");
  });

  // Terminal inline preview: only load the iframe after the user asks.
  // Auto-loading would hit the GitHub login redirect inside the iframe,
  // and GitHub refuses framing (frame-ancestors 'none').
  var terminalLoadBtn = document.getElementById("terminal-load");
  if (terminalLoadBtn) {
    terminalLoadBtn.addEventListener("click", function () {
      var connectBox = document.getElementById("terminal-connect");
      var frame = document.getElementById("cli-frame");
      if (connectBox) connectBox.classList.add("hidden");
      if (frame) {
        frame.classList.remove("hidden");
        frame.src = "https://spurcode.duckdns.org/terminal/";
      }
    });
  }
})();
