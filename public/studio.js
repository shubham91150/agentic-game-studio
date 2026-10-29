/* Agentic Game Studio — Split-screen workspace client.
 * Left pane: Live Muse Code CLI terminal + Prompt composer.
 * Right pane: Live Game Preview container (watches public/live-preview/ written by Muse CLI).
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
  var emptyEl = document.getElementById("preview-empty");
  var splitEl = document.getElementById("workspace-split");
  var tabCli = document.getElementById("tab-cli");
  var tabPreview = document.getElementById("tab-preview");
  var previewReadyDot = document.getElementById("preview-ready-dot");

  var attachments = [];
  var running = false;
  var lastPreviewUpdatedAt = 0;

  function setStatus(text, cls) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (cls ? " " + cls : "");
  }

  function setBusy(busy) {
    running = busy;
    sendBtn.disabled = busy;
    sendBtn.classList.toggle("busy", busy);
  }

  // Mobile segmented tab switcher (CLI vs Game Preview)
  function setActivePane(pane) {
    if (!splitEl) return;
    splitEl.setAttribute("data-active-pane", pane);
    if (tabCli) tabCli.classList.toggle("active", pane === "cli");
    if (tabPreview) tabPreview.classList.toggle("active", pane === "preview");
    if (pane === "preview" && previewReadyDot) {
      previewReadyDot.classList.add("hidden");
    }
  }
  if (tabCli) {
    tabCli.addEventListener("click", function () {
      setActivePane("cli");
    });
  }
  if (tabPreview) {
    tabPreview.addEventListener("click", function () {
      setActivePane("preview");
    });
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

  // Watch public/live-preview/ so whenever Muse Code CLI writes or updates
  // a game or 3D model preview, the right-side iframe updates automatically.
  function pollPreviewState() {
    fetch("/api/studio/preview-state")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ready || !data.updatedAt) return;
        if (data.updatedAt > lastPreviewUpdatedAt) {
          lastPreviewUpdatedAt = data.updatedAt;
          if (titleEl) titleEl.textContent = data.title || "Game Preview";
          if (emptyEl) emptyEl.classList.add("hidden");
          if (frameEl) {
            frameEl.classList.remove("hidden");
            frameEl.src = data.url + "?t=" + data.updatedAt;
          }
          if (
            splitEl &&
            splitEl.getAttribute("data-active-pane") !== "preview" &&
            previewReadyDot
          ) {
            previewReadyDot.classList.remove("hidden");
          }
        }
      })
      .catch(function () {
        /* ignore */
      });
  }
  pollPreviewState();
  setInterval(pollPreviewState, 2000);

  // Enter submits (Shift+Enter inserts a newline)
  promptEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });

  // Switching the model picker switches the live CLI model in the terminal
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

  // Submit: ONLY forward the prompt to the live Muse Code CLI terminal.
  // Never run any fake/template game generator on slash commands or chat.
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
    setStatus("Sending to Muse Code CLI…");

    loadTerminalInline();
    promptEl.value = "";
    attachments = [];
    renderAttachments();

    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        model: model,
        attachments: currentAttachments,
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Backend answered " + res.status);
        return res.json();
      })
      .then(function () {
        setStatus("Sent to Muse Code CLI (" + model + ").", "ok");
      })
      .catch(function () {
        setStatus("Could not reach the VM CLI terminal.", "error");
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
