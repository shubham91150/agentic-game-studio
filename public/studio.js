/* Agentic Game Studio — Split-screen workspace client.
 * Left pane: Live Muse Code CLI terminal + Prompt composer.
 * Right pane: Live 3D WebGL Game Preview + library switcher.
 * No inline scripts anywhere (CSP script-src 'self'). */
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
  var gameSelectEl = document.getElementById("game-select");
  var btnReload = document.getElementById("btn-reload");
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
  var gamesById = {};

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

  function selectGame(game, cacheBust) {
    if (!game || !game.playUrl) return;
    playUrl = game.playUrl;
    titleEl.textContent = game.title || game.id || "Playable Game";
    frameEl.src = game.playUrl + (cacheBust ? "?t=" + Date.now() : "");
    if (gameSelectEl && game.id) {
      gameSelectEl.value = game.id;
    }
    if (game.id) {
      fetch("/api/studio/games/" + encodeURIComponent(game.id) + "/code")
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          if (data && data.unity) {
            unityCode = data.unity;
            codeBox.textContent = unityCode;
          }
        })
        .catch(function () {
          /* ignore */
        });
    }
  }

  function refreshGamesLibrary(preferredId) {
    return fetch("/api/studio/games")
      .then(function (res) {
        if (!res.ok) throw new Error("failed to load games");
        return res.json();
      })
      .then(function (list) {
        if (!Array.isArray(list) || !list.length) return;
        gamesById = {};
        if (gameSelectEl) {
          gameSelectEl.innerHTML = "";
          list.forEach(function (g) {
            gamesById[g.id] = g;
            var opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = g.title || g.id;
            gameSelectEl.appendChild(opt);
          });
        }
        var target = (preferredId && gamesById[preferredId]) || list[0];
        if (target && (!playUrl || preferredId)) {
          selectGame(target, Boolean(preferredId));
        }
      })
      .catch(function () {
        /* ignore */
      });
  }

  if (gameSelectEl) {
    gameSelectEl.addEventListener("change", function () {
      var chosen = gamesById[gameSelectEl.value];
      if (chosen) selectGame(chosen, true);
    });
  }

  if (btnReload) {
    btnReload.addEventListener("click", function () {
      if (playUrl) {
        frameEl.src = playUrl + "?t=" + Date.now();
      } else {
        refreshGamesLibrary();
      }
    });
  }

  // VM backend health check + initial game preview load
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

  refreshGamesLibrary();

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

  // Enter submits (Shift+Enter inserts a newline)
  promptEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });

  // Switching the model picker also switches the live CLI model in the terminal
  modelEl.addEventListener("change", function () {
    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelEl.value }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("model switch failed");
        setStatus("Switched CLI model to " + modelEl.value + ".", "ok");
      })
      .catch(function () {
        setStatus("Could not switch CLI model.", "error");
      });
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
          refreshGamesLibrary(evt.gameId);
          setStatus(
            'Preview updated: "' +
              (evt.title || "") +
              '" (' +
              (evt.elapsedMs / 1000).toFixed(1) +
              "s)",
            "ok",
          );
          log('Game ready: "' + (evt.title || "") + '"', "ok");
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
    var currentAttachments = attachments.map(function (a) {
      return { id: a.id, name: a.name };
    });

    running = true;
    setBusy(true);
    consoleEl.innerHTML = "";
    tokenLine.textContent = "";
    qrBox.classList.add("hidden");
    codeBox.classList.add("hidden");
    setStatus("Sent to live Muse CLI terminal & updating game preview…");

    loadTerminalInline();
    promptEl.value = "";
    attachments = [];
    renderAttachments();

    // 1. Dispatch directly into the live Muse Code CLI terminal on the left
    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        model: model,
        attachments: currentAttachments,
      }),
    }).catch(function () {
      log("Could not forward prompt to live terminal.", "warn");
    });

    // 2. Simultaneously build/update the 3D WebGL game preview on the right
    // (skipSubprocessCli avoids spawning a duplicate CLI process).
    fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        model: model,
        attachments: currentAttachments,
        skipSubprocessCli: true,
      }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          throw new Error("Backend answered " + res.status);
        }
        return readStream(res);
      })
      .catch(function () {
        setStatus("Dispatched to live CLI terminal above.", "ok");
      })
      .then(function () {
        running = false;
        setBusy(false);
        promptEl.focus();
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

  // Terminal inline preview: auto-load on same-origin VM page.
  function loadTerminalInline() {
    var connectBox = document.getElementById("terminal-connect");
    var frame = document.getElementById("cli-frame");
    if (connectBox) connectBox.classList.add("hidden");
    if (frame) {
      frame.classList.remove("hidden");
      if (!frame.getAttribute("src")) {
        frame.src = "https://spurcode.duckdns.org/terminal/";
      }
    }
  }
  var isSameOrigin = window.location.hostname === "spurcode.duckdns.org";
  if (isSameOrigin) {
    loadTerminalInline();
  }
  var terminalLoadBtn = document.getElementById("terminal-load");
  if (terminalLoadBtn) {
    terminalLoadBtn.addEventListener("click", loadTerminalInline);
  }
})();
