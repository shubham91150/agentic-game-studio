/* Agentic Game Studio — Split-screen workspace client.
 * Left pane: Live Muse Code CLI terminal + Prompt composer.
 * Right pane: Clean Game Preview container.
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
  var titleEl = document.getElementById("game-title");
  var frameEl = document.getElementById("game-frame");

  var attachments = [];
  var running = false;

  function setStatus(text, cls) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (cls ? " " + cls : "");
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
    if (evt.type === "done" && evt.ok && evt.playUrl) {
      if (titleEl) titleEl.textContent = evt.title || "Game Preview";
      if (frameEl) frameEl.src = evt.playUrl + "?t=" + Date.now();
      setStatus("Game preview ready.", "ok");
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
    setStatus("Sent to live Muse CLI terminal…");

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
      /* ignore */
    });

    // 2. Build/update the 3D WebGL game preview on the right
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
