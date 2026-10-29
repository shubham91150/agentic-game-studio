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
  var plusGenerateImage = document.getElementById("plus-generate-image");
  var plusSkillsToggle = document.getElementById("plus-skills-toggle");
  var plusInstructionsToggle = document.getElementById(
    "plus-instructions-toggle",
  );
  var plusMcpsToggle = document.getElementById("plus-mcps-toggle");
  var plusSkills = document.getElementById("plus-skills");
  var plusInstructions = document.getElementById("plus-instructions");
  var plusMcps = document.getElementById("plus-mcps");
  var instructionInput = document.getElementById("instruction-input");
  var instructionAdd = document.getElementById("instruction-add");
  var instructionListEl = document.getElementById("instruction-list");
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

  // Prompt draft persistence: text survives reload until sent or deleted.
  var DRAFT_KEY = "ags_prompt_draft";
  var draftTimer = null;

  function saveDraft(value) {
    try {
      localStorage.setItem(DRAFT_KEY, value);
    } catch (e) {
      /* ignore (privacy mode / quota) */
    }
  }

  function loadDraft() {
    try {
      return localStorage.getItem(DRAFT_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      draftTimer = null;
      if (promptEl) saveDraft(promptEl.value);
    }, 300);
  }

  // Restore draft on load (do NOT steal focus).
  if (promptEl) {
    var restored = loadDraft();
    if (typeof restored === "string" && restored && !promptEl.value) {
      promptEl.value = restored;
    }
    promptEl.addEventListener("input", scheduleDraftSave);
  }

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

  // Chat history sidebar (LEFT slide-over): archived tmux transcripts.
  // The live terminal is a ttyd iframe, so resume = view transcript +
  // seed the fresh live terminal with context. Never claim full restore.
  var sidebarBtn = document.getElementById("sidebar-history-btn");
  var sidebar = document.getElementById("sidebar-history");
  var sidebarOverlay = document.getElementById("sidebar-overlay");
  var sidebarClose = document.getElementById("sidebar-close");
  var sidebarList = document.getElementById("sidebar-list");
  var sidebarView = document.getElementById("sidebar-view");
  var sidebarBack = document.getElementById("sidebar-back");
  var sidebarMeta = document.getElementById("sidebar-meta");
  var sidebarTranscript = document.getElementById("sidebar-transcript");
  var sidebarContinue = document.getElementById("sidebar-continue");
  var sidebarSub = document.getElementById("sidebar-sub");
  var activeChatId = null;
  var activeChatContent = "";

  function fmtChatSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fmtChatTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch (e) {
      return "";
    }
  }

  function showSidebarList() {
    activeChatId = null;
    activeChatContent = "";
    if (sidebarView) sidebarView.classList.add("hidden");
    if (sidebarList) sidebarList.classList.remove("hidden");
    if (sidebarSub)
      sidebarSub.textContent =
        "Archived terminal transcripts. Resume = view + seed the live terminal with context.";
  }

  function renderSidebarList(list) {
    if (!sidebarList) return;
    sidebarList.innerHTML = "";
    var chats = Array.isArray(list) ? list : [];
    if (!chats.length) {
      var empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent =
        "No archived chats yet — use New chat to archive this session.";
      sidebarList.appendChild(empty);
      return;
    }
    chats.forEach(function (c) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "sidebar-item";
      var title = document.createElement("p");
      title.className = "sidebar-item-title";
      title.textContent = c.id || "chat";
      item.appendChild(title);
      var meta = document.createElement("p");
      meta.className = "sidebar-item-meta";
      meta.textContent =
        [fmtChatTime(c.createdAt), fmtChatSize(c.size)]
          .filter(Boolean)
          .join(" · ") || "archived chat";
      item.appendChild(meta);
      if (c.preview) {
        var prev = document.createElement("p");
        prev.className = "sidebar-item-preview";
        prev.textContent = c.preview;
        item.appendChild(prev);
      }
      var view = document.createElement("span");
      view.className = "sidebar-item-view";
      view.textContent = "View transcript →";
      item.appendChild(view);
      item.addEventListener(
        "click",
        (function (id) {
          return function () {
            openSidebarTranscript(id);
          };
        })(c.id),
      );
      sidebarList.appendChild(item);
    });
  }

  function openSidebarTranscript(id) {
    if (!id) return;
    if (sidebarMeta) sidebarMeta.textContent = id;
    if (sidebarTranscript) sidebarTranscript.textContent = "Loading…";
    if (sidebarList) sidebarList.classList.add("hidden");
    if (sidebarView) sidebarView.classList.remove("hidden");
    if (sidebarSub) sidebarSub.textContent = "Archived transcript (read-only).";
    fetch("/api/studio/chats/" + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) throw new Error("chat load failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        activeChatId = data && data.id ? data.id : id;
        activeChatContent =
          data && typeof data.content === "string" ? data.content : "";
        if (sidebarMeta) sidebarMeta.textContent = activeChatId;
        if (sidebarTranscript)
          sidebarTranscript.textContent = activeChatContent || "(empty)";
        if (sidebarTranscript) sidebarTranscript.scrollTop = 0;
      })
      .catch(function () {
        if (sidebarTranscript)
          sidebarTranscript.textContent = "Could not load this transcript.";
        setStatus("Could not load chat transcript.", "error");
      });
  }

  function openSidebar() {
    if (sidebar) {
      sidebar.classList.add("open");
      sidebar.setAttribute("aria-hidden", "false");
    }
    if (sidebarOverlay) sidebarOverlay.classList.remove("hidden");
    showSidebarList();
    if (sidebarList) sidebarList.innerHTML = "";
    var loading = document.createElement("div");
    loading.className = "sidebar-empty";
    loading.textContent = "Loading chats…";
    if (sidebarList) sidebarList.appendChild(loading);
    fetch("/api/studio/chats")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(renderSidebarList)
      .catch(function () {
        renderSidebarList([]);
      });
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove("open");
      sidebar.setAttribute("aria-hidden", "true");
    }
    if (sidebarOverlay) sidebarOverlay.classList.add("hidden");
  }

  if (sidebarBtn) sidebarBtn.addEventListener("click", openSidebar);
  if (sidebarClose) sidebarClose.addEventListener("click", closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);
  if (sidebarBack)
    sidebarBack.addEventListener("click", function () {
      showSidebarList();
      openSidebarRefresh();
    });
  function openSidebarRefresh() {
    fetch("/api/studio/chats")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(renderSidebarList)
      .catch(function () {
        renderSidebarList([]);
      });
  }
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeSidebar();
  });
  if (sidebarContinue)
    sidebarContinue.addEventListener("click", function () {
      if (!activeChatId || sidebarContinue.disabled) return;
      sidebarContinue.disabled = true;
      var prompt =
        "Continuing from a previous chat (archived " +
        activeChatId +
        "). Key context:\n" +
        String(activeChatContent || "").slice(0, 1500) +
        "\n---\nUser will now continue.";
      loadTerminalInline();
      fetch("/api/studio/terminal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("send failed: " + res.status);
          return res.json();
        })
        .then(function () {
          closeSidebar();
          setStatus("Context sent — continue in the live terminal.", "ok");
        })
        .catch(function () {
          setStatus("Could not send context to the live terminal.", "error");
        })
        .then(function () {
          sidebarContinue.disabled = false;
        });
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

  // Custom model dropdown: pill button + upward menu, native select stays
  // the single source of truth (sr-only). Selection sets value + dispatches
  // change so the existing submit + CLI-switch logic works untouched.
  var modelBtn = document.getElementById("model-btn");
  var modelLabel = document.getElementById("model-label");
  var modelMenu = document.getElementById("model-menu");

  function syncModelLabel() {
    if (!modelEl || !modelLabel) return;
    var opt = modelEl.options[modelEl.selectedIndex];
    modelLabel.textContent = opt ? opt.text : modelEl.value;
  }

  function setModelOpen(open) {
    if (!modelMenu || !modelBtn) return;
    modelMenu.classList.toggle("hidden", !open);
    modelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function isModelOpen() {
    return !!modelMenu && !modelMenu.classList.contains("hidden");
  }

  function focusModelItem(index) {
    if (!modelMenu) return;
    var items = modelMenu.querySelectorAll(".model-item");
    if (!items.length) return;
    var i = ((index % items.length) + items.length) % items.length;
    items[i].focus();
  }

  function focusedModelIndex() {
    if (!modelMenu) return -1;
    var items = modelMenu.querySelectorAll(".model-item");
    for (var i = 0; i < items.length; i++) {
      if (items[i] === document.activeElement) return i;
    }
    return -1;
  }

  if (modelEl && modelBtn && modelMenu) {
    modelEl.querySelectorAll("option").forEach(function (opt) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "model-item";
      item.setAttribute("role", "option");
      item.dataset.value = opt.value;
      item.setAttribute(
        "aria-selected",
        opt.value === modelEl.value ? "true" : "false",
      );
      var name = document.createElement("span");
      name.textContent = opt.text;
      item.appendChild(name);
      if (opt.value === modelEl.value) {
        var tick = document.createElement("span");
        tick.className = "tick";
        tick.textContent = "✓";
        item.appendChild(tick);
      }
      item.addEventListener("click", function () {
        if (modelEl.value !== item.dataset.value) {
          modelEl.value = item.dataset.value;
          modelEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        syncModelLabel();
        modelMenu.querySelectorAll(".model-item").forEach(function (other) {
          var selected = other === item;
          other.setAttribute("aria-selected", selected ? "true" : "false");
          var oldTick = other.querySelector(".tick");
          if (oldTick) oldTick.remove();
          if (selected) {
            var fresh = document.createElement("span");
            fresh.className = "tick";
            fresh.textContent = "✓";
            other.appendChild(fresh);
          }
        });
        setModelOpen(false);
        modelBtn.focus();
      });
      modelMenu.appendChild(item);
    });
    syncModelLabel();

    modelBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = !isModelOpen();
      setModelOpen(open);
      if (open) {
        var current = modelMenu.querySelector(
          '.model-item[data-value="' + modelEl.value + '"]',
        );
        var items = modelMenu.querySelectorAll(".model-item");
        var idx = 0;
        for (var i = 0; i < items.length; i++) {
          if (items[i] === current) idx = i;
        }
        focusModelItem(idx);
      }
    });

    modelBtn.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!isModelOpen()) setModelOpen(true);
        focusModelItem(event.key === "ArrowDown" ? 0 : -1);
      }
    });

    modelMenu.addEventListener("keydown", function (event) {
      var idx = focusedModelIndex();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusModelItem(idx + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusModelItem(idx - 1);
      } else if (event.key === "Escape") {
        setModelOpen(false);
        modelBtn.focus();
      }
    });

    document.addEventListener("click", function (event) {
      if (
        isModelOpen() &&
        !modelMenu.contains(event.target) &&
        event.target !== modelBtn &&
        !modelBtn.contains(event.target)
      ) {
        setModelOpen(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setModelOpen(false);
    });
  }

  // + menu: v0-style icon rows with inline expanders (file, image,
  // skills, instructions, MCPs — all loaded live from backend)
  function closePlusMenu() {
    if (plusMenu) plusMenu.classList.add("hidden");
  }
  function setSubOpen(toggle, panel, open) {
    if (!toggle || !panel) return;
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function isSubOpen(panel) {
    return !!panel && !panel.classList.contains("hidden");
  }
  function toggleSub(toggle, panel) {
    var open = !isSubOpen(panel);
    setSubOpen(plusSkillsToggle, plusSkills, false);
    setSubOpen(plusInstructionsToggle, plusInstructions, false);
    setSubOpen(plusMcpsToggle, plusMcps, false);
    setSubOpen(toggle, panel, open);
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
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePlusMenu();
  });
  if (plusFile) {
    plusFile.addEventListener("click", function () {
      closePlusMenu();
      fileInput.click();
    });
  }
  if (plusGenerateImage) {
    plusGenerateImage.addEventListener("click", function () {
      closePlusMenu();
      if (scopeEl) scopeEl.value = "image";
      if (promptEl) promptEl.focus();
    });
  }
  if (plusSkillsToggle) {
    plusSkillsToggle.addEventListener("click", function () {
      toggleSub(plusSkillsToggle, plusSkills);
    });
  }
  if (plusInstructionsToggle) {
    plusInstructionsToggle.addEventListener("click", function () {
      toggleSub(plusInstructionsToggle, plusInstructions);
      if (isSubOpen(plusInstructions) && instructionInput) {
        instructionInput.focus();
      }
    });
  }
  if (plusMcpsToggle) {
    plusMcpsToggle.addEventListener("click", function () {
      toggleSub(plusMcpsToggle, plusMcps);
    });
  }

  // Custom instructions: free-text chips prepended to the sent prompt
  var customInstructions = [];
  function renderInstructionChips() {
    if (!instructionListEl) return;
    instructionListEl.innerHTML = "";
    customInstructions.forEach(function (text) {
      var chip = document.createElement("span");
      chip.className = "instruction-chip";
      var label = document.createElement("span");
      label.textContent = text;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove instruction");
      remove.addEventListener("click", function () {
        customInstructions = customInstructions.filter(function (x) {
          return x !== text;
        });
        renderInstructionChips();
      });
      chip.appendChild(label);
      chip.appendChild(remove);
      instructionListEl.appendChild(chip);
    });
  }
  function addInstruction() {
    if (!instructionInput) return;
    var text = instructionInput.value.trim();
    if (!text) return;
    customInstructions.push(text);
    instructionInput.value = "";
    renderInstructionChips();
    instructionInput.focus();
  }
  if (instructionAdd) {
    instructionAdd.addEventListener("click", addInstruction);
  }
  if (instructionInput) {
    instructionInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addInstruction();
      }
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

  var cachedCapabilities = { skills: [], mcp: { servers: [] } };
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
      var servers =
        cachedCapabilities.mcp && Array.isArray(cachedCapabilities.mcp.servers)
          ? cachedCapabilities.mcp.servers
          : [];
      if (!servers.length) {
        var hint = document.createElement("div");
        hint.className = "plus-hint";
        hint.textContent = "No MCP servers connected yet.";
        plusMcps.appendChild(hint);
      }
      servers.forEach(function (srv) {
        var row = document.createElement("div");
        row.className = "plus-item plus-mcp-row";
        var name = document.createElement("span");
        name.textContent = "● " + srv.name;
        name.title = srv.url || srv.transport || "";
        row.appendChild(name);
        var del = document.createElement("button");
        del.type = "button";
        del.textContent = "×";
        del.setAttribute("aria-label", "Remove MCP server " + srv.name);
        del.addEventListener("click", function (event) {
          event.stopPropagation();
          removeMcpServer(srv.name);
        });
        row.appendChild(del);
        plusMcps.appendChild(row);
      });
      var addRow = document.createElement("div");
      addRow.className = "plus-add";
      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "name";
      nameInput.setAttribute("aria-label", "MCP server name");
      nameInput.maxLength = 41;
      var urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.placeholder = "https://…/mcp";
      urlInput.setAttribute("aria-label", "MCP server URL");
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", function () {
        addMcpServer(nameInput.value, urlInput.value);
      });
      addRow.appendChild(nameInput);
      addRow.appendChild(urlInput);
      addRow.appendChild(addBtn);
      plusMcps.appendChild(addRow);
      var note = document.createElement("div");
      note.className = "plus-hint";
      note.textContent = "Takes effect in a new CLI session.";
      plusMcps.appendChild(note);
    }
  }

  function refreshMcp() {
    fetch("/api/studio/mcp")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        cachedCapabilities.mcp = data || { servers: [] };
        renderPlusMenu();
      })
      .catch(function () {
        /* ignore */
      });
  }

  function addMcpServer(name, url) {
    fetch("/api/studio/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, url: url }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          setStatus(
            result.data && result.data.error
              ? result.data.error
              : "Could not add MCP server.",
            "error",
          );
          return;
        }
        cachedCapabilities.mcp = result.data;
        renderPlusMenu();
        setStatus("MCP server added.", "ok");
      })
      .catch(function () {
        setStatus("Could not add MCP server.", "error");
      });
  }

  function removeMcpServer(name) {
    fetch("/api/studio/mcp/" + encodeURIComponent(name), {
      method: "DELETE",
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data) {
          cachedCapabilities.mcp = data;
          renderPlusMenu();
          setStatus("MCP server removed.", "ok");
        }
      })
      .catch(function () {
        /* ignore */
      });
  }

  fetch("/api/studio/capabilities")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      cachedCapabilities.skills = Array.isArray(data.skills) ? data.skills : [];
      renderPlusMenu();
      refreshMcp();
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
        scheduleDraftSave();
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
    var instructionTags = customInstructions
      .map(function (text) {
        return "[instruction] " + text;
      })
      .join(" ");
    var finalPrompt =
      (skillTags ? skillTags + " " : "") +
      (instructionTags ? instructionTags + " " : "") +
      (SCOPE_PREFIX[scope] || "") +
      prompt;

    running = true;
    setBusy(true);
    setStatus("Sending to Muse Code CLI…");

    loadTerminalInline();

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
        promptEl.value = "";
        clearDraft();
        attachments = [];
        activeSkills = [];
        customInstructions = [];
        renderAttachments();
        renderSkillChips();
        renderInstructionChips();
        renderPlusMenu();
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

  // New chat: reset UI conversation state, archive via backend (which kills
  // and recreates the tmux session), then cleanly reattach the terminal
  // iframe to the NEW session. The reload is delayed so ttyd settles, and a
  // quiet black veil covers the box meanwhile — this bypasses ttyd's
  // built-in "Press Enter to Reconnect" overlay entirely (ui-taste: no
  // light box, no manual keypress, no spinner; muted text on black).
  var newchatBtn = document.getElementById("newchat-btn");
  var TERMINAL_URL = "https://spurcode.duckdns.org/terminal/";
  var reconnectTimer = null;
  var reconnectSafety = null;

  function showTerminalLoading() {
    var box = document.querySelector(".terminal-section .terminal-box");
    if (!box) return null;
    var overlay = document.getElementById("terminal-reconnect");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "terminal-reconnect";
      overlay.className = "terminal-reconnect";
      overlay.setAttribute("aria-live", "polite");
      var text = document.createElement("p");
      text.className = "terminal-reconnect-text";
      text.textContent = "Starting fresh terminal…";
      overlay.appendChild(text);
      box.appendChild(overlay);
    }
    overlay.classList.remove("hidden");
    var frame = document.getElementById("cli-frame");
    if (frame) frame.classList.add("hidden");
    return overlay;
  }

  function hideTerminalLoading() {
    var overlay = document.getElementById("terminal-reconnect");
    if (overlay) overlay.classList.add("hidden");
    var frame = document.getElementById("cli-frame");
    if (frame && frame.getAttribute("src")) frame.classList.remove("hidden");
  }

  function reconnectTerminalFresh() {
    var frame = document.getElementById("cli-frame");
    // Inline terminal not active (connect prompt showing) — nothing dead
    // to hide, so leave the connect box untouched.
    if (!frame || !frame.getAttribute("src")) return;
    showTerminalLoading();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (reconnectSafety) clearTimeout(reconnectSafety);
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      try {
        // Force a clean attach to the NEW session (bypasses the dead
        // socket's reconnect overlay). removeAttribute first so setting
        // the identical URL still triggers a navigation.
        frame.removeAttribute("src");
        frame.src = TERMINAL_URL;
      } catch (e) {
        /* ignore */
      }
      reconnectSafety = setTimeout(function () {
        reconnectSafety = null;
        hideTerminalLoading();
        setStatus(
          "Fresh terminal is taking long — use Open full terminal.",
          "warn",
        );
      }, 20000);
    }, 2500);
  }

  // Fresh attach confirmed: drop the veil. Guarded so the initial
  // inline load (no veil showing) is unaffected.
  var cliFrameEl = document.getElementById("cli-frame");
  if (cliFrameEl) {
    cliFrameEl.addEventListener("load", function () {
      var overlay = document.getElementById("terminal-reconnect");
      if (overlay && !overlay.classList.contains("hidden")) {
        if (reconnectSafety) {
          clearTimeout(reconnectSafety);
          reconnectSafety = null;
        }
        hideTerminalLoading();
      }
    });
  }

  function newChat() {
    if (promptEl) promptEl.value = "";
    clearDraft();
    setStatus("");
    attachments = [];
    activeSkills = [];
    customInstructions = [];
    renderAttachments();
    renderSkillChips();
    renderInstructionChips();
    closePlusMenu();
    setSubOpen(plusSkillsToggle, plusSkills, false);
    setSubOpen(plusInstructionsToggle, plusInstructions, false);
    setSubOpen(plusMcpsToggle, plusMcps, false);
    closeLibrary();
    ["qr-box", "code-box", "result-extra", "result-extras"].forEach(
      function (id) {
        var extra = document.getElementById(id);
        if (extra) extra.classList.add("hidden");
      },
    );
    if (titleEl) titleEl.textContent = "Game Preview";
    if (frameEl) {
      frameEl.classList.add("hidden");
      frameEl.removeAttribute("src");
    }
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (promptEl && window.innerWidth > 960) promptEl.focus();
    fetch("/api/studio/session/new", { method: "POST" })
      .then(function (res) {
        if (!res.ok) throw new Error("new session failed: " + res.status);
        return res.json();
      })
      .then(function () {
        setStatus("Previous chat archived. Fresh terminal starting…", "ok");
        reconnectTerminalFresh();
      })
      .catch(function () {
        setStatus(
          "UI reset. Fresh terminal unavailable — start failed.",
          "warn",
        );
      });
  }
  if (newchatBtn) newchatBtn.addEventListener("click", newChat);

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
