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
  var skillListEl = document.getElementById("skill-list");
  var plusMenu = document.getElementById("plus-menu");
  var plusFile = document.getElementById("plus-file");
  var plusSkills = document.getElementById("plus-skills");
  var plusMcps = document.getElementById("plus-mcps");
  var scopeEl = document.getElementById("scope-select");
  var micBtn = document.getElementById("mic-btn");
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
  var libraryBtn = document.getElementById("library-btn");
  var libraryCount = document.getElementById("library-count");
  var libraryDrawer = document.getElementById("library-drawer");
  var drawerOverlay = document.getElementById("drawer-overlay");
  var libraryClose = document.getElementById("library-close");
  var libraryGrid = document.getElementById("library-grid");
  var librarySub = document.getElementById("library-sub");

  var attachments = [];
  var activeSkills = [];
  var running = false;
  var lastPreviewUpdatedAt = 0;

  var SCOPE_PREFIX = {
    game: "",
    model:
      "Build a 3D model viewer for the following and render it in the live preview: ",
    image: "Generate a game image for the following description: ",
  };

  function playPreview(url, title) {
    if (!url) return;
    if (titleEl) titleEl.textContent = title || "Game Preview";
    if (emptyEl) emptyEl.classList.add("hidden");
    if (frameEl) {
      frameEl.classList.remove("hidden");
      frameEl.src = url + "?t=" + Date.now();
    }
    closeLibrary();
    if (window.innerWidth <= 960) setActivePane("preview");
  }

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

  // Game library showcase drawer (curated: junk titles filtered out)
  function isShowcaseGame(g) {
    if (!g || !g.playUrl) return false;
    var text = ((g.title || "") + " " + (g.prompt || "")).trim();
    if (text.length < 4) return false;
    if (/^(\/mcp|\/usage|\/help|hi+|test)$/i.test(text)) return false;
    return true;
  }

  function renderLibrary(list) {
    if (!libraryGrid) return;
    libraryGrid.innerHTML = "";
    var games = (Array.isArray(list) ? list : []).filter(isShowcaseGame);
    if (libraryCount)
      libraryCount.textContent = games.length ? String(games.length) : "";
    if (librarySub) {
      librarySub.textContent = games.length
        ? "Built by the agent, ready to play."
        : "No showcase games yet — send a prompt to build the first.";
    }
    if (!games.length) {
      var empty = document.createElement("div");
      empty.className = "library-empty";
      empty.textContent =
        "Send a prompt in the composer and your games will appear here.";
      libraryGrid.appendChild(empty);
      return;
    }
    games.slice(0, 12).forEach(function (g) {
      var card = document.createElement("div");
      card.className = "game-card";
      if (g.imageUrl) {
        var img = document.createElement("img");
        img.className = "game-thumb";
        img.src = g.imageUrl;
        img.alt = g.title || "game concept art";
        img.loading = "lazy";
        card.appendChild(img);
      } else {
        var fb = document.createElement("div");
        fb.className = "game-thumb-fallback";
        fb.textContent = "◆ " + (g.biome || "3D world");
        card.appendChild(fb);
      }
      var body = document.createElement("div");
      body.className = "game-body";
      var title = document.createElement("p");
      title.className = "game-title";
      title.textContent = g.title || g.id;
      body.appendChild(title);
      var meta = document.createElement("p");
      meta.className = "game-meta";
      var date = "";
      try {
        date = new Date(g.createdAt).toLocaleDateString();
      } catch (e) {
        date = "";
      }
      meta.textContent = [g.biome, date].filter(Boolean).join(" · ");
      body.appendChild(meta);
      var play = document.createElement("button");
      play.type = "button";
      play.className = "game-play";
      play.textContent = "▶ Play this game";
      play.addEventListener("click", function () {
        playPreview(g.playUrl, g.title);
      });
      body.appendChild(play);
      card.appendChild(body);
      libraryGrid.appendChild(card);
    });
  }

  function openLibrary() {
    if (libraryDrawer) {
      libraryDrawer.classList.add("open");
      libraryDrawer.setAttribute("aria-hidden", "false");
    }
    if (drawerOverlay) drawerOverlay.classList.remove("hidden");
    fetch("/api/studio/games")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(renderLibrary)
      .catch(function () {
        renderLibrary([]);
      });
  }

  function closeLibrary() {
    if (libraryDrawer) {
      libraryDrawer.classList.remove("open");
      libraryDrawer.setAttribute("aria-hidden", "true");
    }
    if (drawerOverlay) drawerOverlay.classList.add("hidden");
  }

  if (libraryBtn) libraryBtn.addEventListener("click", openLibrary);
  if (libraryClose) libraryClose.addEventListener("click", closeLibrary);
  if (drawerOverlay) drawerOverlay.addEventListener("click", closeLibrary);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeLibrary();
  });

  // Library count badge on load (no drawer fetch until opened)
  fetch("/api/studio/games")
    .then(function (res) {
      return res.ok ? res.json() : [];
    })
    .then(function (list) {
      var games = (Array.isArray(list) ? list : []).filter(isShowcaseGame);
      if (libraryCount && games.length) {
        libraryCount.textContent = String(games.length);
      }
    })
    .catch(function () {
      /* ignore */
    });

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

  // + menu: file attach, skills, MCPs (all loaded live from backend)
  function closePlusMenu() {
    if (plusMenu) plusMenu.classList.add("hidden");
  }
  if (attachBtn) {
    attachBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (plusMenu) plusMenu.classList.toggle("hidden");
    });
  }
  document.addEventListener("click", function (event) {
    if (
      plusMenu &&
      !plusMenu.classList.contains("hidden") &&
      !plusMenu.contains(event.target) &&
      event.target !== attachBtn
    ) {
      closePlusMenu();
    }
  });
  if (plusFile) {
    plusFile.addEventListener("click", function () {
      closePlusMenu();
      fileInput.click();
    });
  }

  function renderSkillChips() {
    if (!skillListEl) return;
    skillListEl.innerHTML = "";
    activeSkills.forEach(function (id) {
      var chip = document.createElement("span");
      chip.className = "skill-chip";
      var label = document.createElement("span");
      label.textContent = "@" + id;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove skill " + id);
      remove.addEventListener("click", function () {
        activeSkills = activeSkills.filter(function (x) {
          return x !== id;
        });
        renderSkillChips();
        renderPlusMenu();
      });
      chip.appendChild(label);
      chip.appendChild(remove);
      skillListEl.appendChild(chip);
    });
  }

  var cachedCapabilities = { skills: [], mcpServers: [] };
  function renderPlusMenu() {
    if (plusSkills) {
      plusSkills.innerHTML = "";
      if (!cachedCapabilities.skills.length) {
        var none = document.createElement("div");
        none.className = "plus-hint";
        none.textContent = "No skills found in this workspace.";
        plusSkills.appendChild(none);
      }
      cachedCapabilities.skills.forEach(function (s) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "plus-item";
        item.setAttribute("role", "menuitem");
        item.title = s.description || s.id;
        var name = document.createElement("span");
        name.textContent = "@" + s.id;
        item.appendChild(name);
        if (activeSkills.indexOf(s.id) !== -1) {
          var tick = document.createElement("span");
          tick.className = "tick";
          tick.textContent = "✓";
          item.appendChild(tick);
        }
        item.addEventListener("click", function () {
          if (activeSkills.indexOf(s.id) === -1) {
            activeSkills.push(s.id);
          } else {
            activeSkills = activeSkills.filter(function (x) {
              return x !== s.id;
            });
          }
          renderSkillChips();
          renderPlusMenu();
        });
        plusSkills.appendChild(item);
      });
    }
    if (plusMcps) {
      plusMcps.innerHTML = "";
      if (!cachedCapabilities.mcpServers.length) {
        var hint = document.createElement("div");
        hint.className = "plus-hint";
        hint.textContent =
          "No MCP servers connected. Run `muse mcp login <server>` on the VM to add one.";
        plusMcps.appendChild(hint);
      }
      cachedCapabilities.mcpServers.forEach(function (name) {
        var row = document.createElement("div");
        row.className = "plus-hint";
        row.textContent = "● " + name;
        plusMcps.appendChild(row);
      });
    }
  }
  fetch("/api/studio/capabilities")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      cachedCapabilities = {
        skills: Array.isArray(data.skills) ? data.skills : [],
        mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers : [],
      };
      renderPlusMenu();
    })
    .catch(function () {
      renderPlusMenu();
    });

  // Microphone dictation (only where the browser supports it)
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec && micBtn) {
    micBtn.classList.remove("hidden");
    var recognizing = false;
    var rec = new SpeechRec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.addEventListener("result", function (event) {
      var text = "";
      for (var i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      if (text) {
        promptEl.value = (promptEl.value ? promptEl.value + " " : "") + text;
        promptEl.focus();
      }
    });
    rec.addEventListener("end", function () {
      recognizing = false;
      micBtn.classList.remove("busy");
    });
    micBtn.addEventListener("click", function () {
      if (recognizing) {
        rec.stop();
        return;
      }
      recognizing = true;
      micBtn.classList.add("busy");
      try {
        rec.start();
      } catch (e) {
        recognizing = false;
        micBtn.classList.remove("busy");
      }
    });
  }

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
    var scope = scopeEl ? scopeEl.value : "game";
    var currentAttachments = attachments.map(function (a) {
      return { id: a.id, name: a.name };
    });
    var skillTags = activeSkills
      .map(function (id) {
        return "@" + id;
      })
      .join(" ");
    var finalPrompt =
      (skillTags ? skillTags + " " : "") + (SCOPE_PREFIX[scope] || "") + prompt;

    running = true;
    setBusy(true);
    setStatus("Sending to Muse Code CLI…");

    loadTerminalInline();
    promptEl.value = "";
    attachments = [];
    activeSkills = [];
    renderAttachments();
    renderSkillChips();
    renderPlusMenu();

    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: finalPrompt,
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
