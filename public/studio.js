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
  var plusPermissionsToggle = document.getElementById(
    "plus-permissions-toggle",
  );
  var plusSkills = document.getElementById("plus-skills");
  var plusInstructions = document.getElementById("plus-instructions");
  var plusMcps = document.getElementById("plus-mcps");
  var plusPermissions = document.getElementById("plus-permissions");
  var instructionInput = document.getElementById("instruction-input");
  var instructionAdd = document.getElementById("instruction-add");
  var instructionListEl = document.getElementById("instruction-list");
  var scopeEl = document.getElementById("scope-select");
  var micBtn = document.getElementById("mic-btn");
  var sendBtn = document.getElementById("send-btn");
  var statusEl = document.getElementById("status");
  var liveDot = document.getElementById("live-dot");
  var liveText = document.getElementById("live-text");
  var headerTitleEl = document.getElementById("header-game-title");
  var titleEl = document.getElementById("game-title");
  var frameEl = document.getElementById("game-frame");
  var emptyEl = document.getElementById("preview-empty");
  var splitEl = document.getElementById("workspace-split");
  var tabCli = document.getElementById("tab-cli");
  var tabPreview = document.getElementById("tab-preview");
  var previewReadyDot = document.getElementById("preview-ready-dot");
  var termScrollbar = document.getElementById("term-scrollbar");
  var termScrollThumb = document.getElementById("term-scroll-thumb");
  var libraryBtn = document.getElementById("library-btn");
  var libraryCount = document.getElementById("library-count");
  var libraryDrawer = document.getElementById("library-drawer");
  var drawerOverlay = document.getElementById("drawer-overlay");
  var libraryClose = document.getElementById("library-close");
  var libraryGrid = document.getElementById("library-grid");
  var librarySub = document.getElementById("library-sub");
  var saveLibraryBtn = document.getElementById("save-library-btn");
  var refreshPreviewBtn = document.getElementById("refresh-preview-btn");
  var landscapePreviewBtn = document.getElementById("landscape-preview-btn");
  var landscapeBtnLabel = document.getElementById("landscape-btn-label");
  var downloadGameBtn = document.getElementById("download-game-btn");
  var previewBox =
    document.getElementById("preview-box") ||
    document.querySelector(".preview-box");
  // Base preview URL (without cache-bust ?t=) tracked client-side so the
  // Refresh button can reload the iframe without a backend round-trip.
  var currentPreviewUrl = null;

  var attachments = [];
  var activeSkills = [];
  var running = false;
  var agentWorking = false;
  var agentGraceUntil = 0;
  var agentGraceTimer = null;
  var sendAbortController = null;
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

  function pausePreviewGame() {
    if (frameEl && frameEl.contentWindow) {
      try {
        frameEl.contentWindow.postMessage({ type: "ags-pause" }, "*");
      } catch (e) {
        /* ignore */
      }
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" || document.hidden) {
      pausePreviewGame();
    }
  });

  // Read-only visitor playback: when a stored /studio/games/ URL (or an
  // explicit readOnly flag) is playing, preview polling must never yank the
  // frame back to the live preview.
  var previewReadOnly = false;
  function playPreview(url, title, readOnly) {
    if (!url) return;
    if (titleEl) titleEl.textContent = title || "Game Preview";
    if (headerTitleEl) headerTitleEl.textContent = title || "Game Preview";
    if (emptyEl) emptyEl.classList.add("hidden");
    if (frameEl) {
      frameEl.classList.remove("hidden");
      currentPreviewUrl = url;
      previewReadOnly =
        Boolean(readOnly) || String(url || "").indexOf("/studio/games/") === 0;
      frameEl.src = url + "?t=" + Date.now();
    }
    closeLibrary();
    if (window.innerWidth <= 960) setActivePane("preview");
  }

  function setStatus(text, cls) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (cls ? " " + cls : "");
  }

  // Default rest state (ui-taste): seed the hero status line with "Ready."
  // on load, before any fetch, so it is never empty at rest. Agent activity
  // and pollPreviewState() overwrite it as the session evolves.
  setStatus("Ready.");

  function updateSendStopButton() {
    if (!sendBtn) return;
    var active = Boolean(running || agentWorking);
    sendBtn.disabled = false;
    sendBtn.classList.toggle("is-stop", active);
    sendBtn.classList.toggle("busy", active);
    if (active) {
      sendBtn.setAttribute("title", "Stop agent (Esc)");
      sendBtn.setAttribute("aria-label", "Stop agent");
    } else {
      sendBtn.setAttribute("title", "Send to Muse CLI & build preview (Enter)");
      sendBtn.setAttribute("aria-label", "Build game");
    }
  }

  function setBusy(busy) {
    running = busy;
    updateSendStopButton();
  }

  function setAgentWorking(working, graceMs) {
    agentWorking = Boolean(working);
    if (agentGraceTimer) {
      clearTimeout(agentGraceTimer);
      agentGraceTimer = null;
    }
    if (agentWorking && graceMs && graceMs > 0) {
      agentGraceUntil = Date.now() + graceMs;
      agentGraceTimer = setTimeout(function () {
        agentGraceTimer = null;
        pollPreviewState();
      }, graceMs + 50);
    } else if (!agentWorking) {
      agentGraceUntil = 0;
    }
    updateSendStopButton();
  }

  // Abort only the composer's in-flight request (used by New chat, which
  // must NOT disturb the old terminal — its agent keeps running there).
  function stopComposerRequest() {
    if (sendAbortController) {
      try {
        sendAbortController.abort();
      } catch (e) {
        /* ignore */
      }
      sendAbortController = null;
    }
    running = false;
    setAgentWorking(false, 0);
  }

  function stopAgentRun() {
    if (sendAbortController) {
      try {
        sendAbortController.abort();
      } catch (e) {
        /* ignore */
      }
      sendAbortController = null;
    }
    running = false;
    setAgentWorking(false, 0);
    setStatus("Stopped Muse Code CLI.", "warn");
    fetch("/api/studio/terminal/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(function () {
      /* ignore */
    });
  }

  // Mobile segmented tab switcher (CLI vs Game Preview)
  function setActivePane(pane) {
    if (!splitEl) return;
    if (pane !== "preview") {
      pausePreviewGame();
    } else if (frameEl && frameEl.contentWindow) {
      try {
        frameEl.contentWindow.postMessage({ type: "ags-resume-loop" }, "*");
      } catch (e) {
        /* ignore */
      }
    }
    splitEl.setAttribute("data-active-pane", pane);
    if (tabCli) tabCli.classList.toggle("active", pane === "cli");
    if (tabPreview) tabPreview.classList.toggle("active", pane === "preview");
    if (pane === "preview") {
      if (previewReadyDot) previewReadyDot.classList.add("hidden");
      if (previewBox) previewBox.classList.add("mobile-landscape");
    }
  }
  if (frameEl) {
    frameEl.addEventListener("load", function () {
      if (
        window.innerWidth <= 960 &&
        splitEl &&
        splitEl.getAttribute("data-active-pane") !== "preview"
      ) {
        pausePreviewGame();
      }
    });
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
      play.textContent = "▶ Play in preview";
      play.addEventListener("click", function () {
        if (play.disabled) return;
        play.disabled = true;
        play.textContent = "Loading…";
        setStatus('Loading "' + (g.title || g.id) + '" into preview…');
        fetch("/api/studio/games/" + encodeURIComponent(g.id) + "/activate", {
          method: "POST",
        })
          .then(function (res) {
            if (!res.ok) throw new Error("activate failed: " + res.status);
            return res.json();
          })
          .then(function (data) {
            playPreview(
              (data && data.url) || "/studio/live-preview/index.html",
              (data && data.title) || g.title,
              data && data.readOnly,
            );
            setStatus(
              'Playing "' +
                ((data && data.title) || g.title) +
                '" — continue editing from the composer.',
              "ok",
            );
            refreshLibraryCount();
          })
          .catch(function () {
            setStatus("Could not load that game into the preview.", "error");
          })
          .then(function () {
            play.disabled = false;
            play.textContent = "▶ Play in preview";
          });
      });
      body.appendChild(play);
      card.appendChild(body);
      libraryGrid.appendChild(card);
    });
  }

  function openLibrary() {
    pausePreviewGame();
    closeGit();
    if (typeof closeSidebar === "function") closeSidebar();
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
  // Shared overlay + Escape close whichever drawer is open (only one at a time).
  if (drawerOverlay) drawerOverlay.addEventListener("click", closeAllDrawers);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeAllDrawers();
  });

  // Library count badge — refreshed on load and after a successful publish.
  function refreshLibraryCount() {
    fetch("/api/studio/games")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (list) {
        var games = (Array.isArray(list) ? list : []).filter(isShowcaseGame);
        if (libraryCount) {
          libraryCount.textContent = games.length ? String(games.length) : "";
        }
      })
      .catch(function () {
        /* ignore */
      });
  }
  // Library count badge on load (no drawer fetch until opened)
  refreshLibraryCount();

  // ---------- Git & GitHub drawer ----------
  // Mirrors the library drawer: same shared #drawer-overlay, same open/close
  // pattern, only one drawer open at a time. All server strings go through
  // textContent (never innerHTML) — CSP-safe, zero inline handlers.
  var gitBtn = document.getElementById("git-btn");
  var gitSha = document.getElementById("git-sha");
  var gitDirtyDot = document.getElementById("git-dirty-dot");
  var gitDrawer = document.getElementById("git-drawer");
  var gitClose = document.getElementById("git-close");
  var gitRepoLink = document.getElementById("git-repo-link");
  var gitBranch = document.getElementById("git-branch");
  var gitHeadMsg = document.getElementById("git-head-msg");
  var gitHeadMeta = document.getElementById("git-head-meta");
  var gitDirtyBadge = document.getElementById("git-dirty-badge");
  var gitCommitInput = document.getElementById("git-commit-input");
  var gitSyncBtn = document.getElementById("git-sync-btn");
  var gitSyncResult = document.getElementById("git-sync-result");
  var gitExportInput = document.getElementById("git-export-input");
  var gitExportBtn = document.getElementById("git-export-btn");
  var gitExportResult = document.getElementById("git-export-result");
  var gitCommitsList = document.getElementById("git-commits-list");
  var gitRepoUrl = "https://github.com/shubham91150/agentic-game-studio";

  function closeGit() {
    if (gitDrawer) {
      gitDrawer.classList.remove("open");
      gitDrawer.setAttribute("aria-hidden", "true");
    }
    if (
      drawerOverlay &&
      (!libraryDrawer || !libraryDrawer.classList.contains("open"))
    ) {
      drawerOverlay.classList.add("hidden");
    }
  }

  function closeAllDrawers() {
    closeLibrary();
    closeGit();
  }

  function safeHttpUrl(value) {
    if (typeof value !== "string") return "";
    var v = value.trim();
    if (/^https:\/\//i.test(v)) return v;
    if (/^http:\/\/localhost(:\d+)?\//i.test(v)) return v;
    return "";
  }

  function formatGitDate(value) {
    if (!value) return "";
    try {
      var d = new Date(value);
      if (isNaN(d.getTime())) return String(value).slice(0, 16);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function renderGitCommits(commits) {
    if (!gitCommitsList) return;
    gitCommitsList.innerHTML = "";
    var rows = Array.isArray(commits) ? commits.slice(0, 10) : [];
    if (!rows.length) {
      var empty = document.createElement("div");
      empty.className = "git-empty";
      empty.textContent = "No commits yet";
      gitCommitsList.appendChild(empty);
      return;
    }
    rows.forEach(function (c) {
      var sha = c.sha || c.id || "";
      var short = c.shortSha || (sha ? String(sha).slice(0, 7) : "…");
      var row = document.createElement("div");
      row.className = "git-commit-row";
      var link = document.createElement("a");
      link.className = "git-commit-sha";
      link.textContent = short;
      var url =
        safeHttpUrl(c.url) ||
        (sha ? safeHttpUrl(gitRepoUrl + "/commit/" + sha) : "");
      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
      } else {
        link.href = "#";
        link.addEventListener("click", function (ev) {
          ev.preventDefault();
        });
      }
      row.appendChild(link);
      var main = document.createElement("div");
      main.className = "git-commit-main";
      var msg = document.createElement("p");
      msg.className = "git-commit-msg";
      var firstLine = String(c.message || c.msg || "—").split("\n")[0];
      msg.textContent = firstLine;
      msg.title = firstLine;
      main.appendChild(msg);
      var meta = document.createElement("p");
      meta.className = "git-commit-meta";
      meta.textContent = [c.author, formatGitDate(c.date || c.createdAt)]
        .filter(Boolean)
        .join(" · ");
      main.appendChild(meta);
      row.appendChild(main);
      gitCommitsList.appendChild(row);
    });
  }

  function renderGitStatus(data) {
    var d = data && typeof data === "object" ? data : {};
    var head = d.head && typeof d.head === "object" ? d.head : {};
    var sha = d.sha || d.shortSha || head.sha || head.id || "";
    var short = d.shortSha || (sha ? String(sha).slice(0, 7) : "");
    var dirty =
      typeof d.dirtyCount === "number"
        ? d.dirtyCount
        : typeof d.dirty === "number"
          ? d.dirty
          : d.dirty === true
            ? 1
            : 0;
    if (gitSha) gitSha.textContent = short;
    if (gitDirtyDot) gitDirtyDot.classList.toggle("hidden", !(dirty > 0));
    if (gitBranch) gitBranch.textContent = d.branch || head.branch || "—";
    if (gitHeadMsg) {
      var msg = String(
        d.headMsg || d.message || head.message || head.msg || "",
      ).split("\n")[0];
      gitHeadMsg.textContent = msg || (short ? "—" : "Git status unavailable");
    }
    if (gitHeadMeta) {
      gitHeadMeta.textContent = [
        short,
        d.headAuthor || d.author || head.author,
        formatGitDate(d.headDate || d.date || head.date),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (gitDirtyBadge) {
      if (dirty > 0) {
        gitDirtyBadge.textContent =
          dirty + (dirty === 1 ? " change" : " changes");
        gitDirtyBadge.classList.remove("hidden");
      } else {
        gitDirtyBadge.textContent = "";
        gitDirtyBadge.classList.add("hidden");
      }
    }
    var repo = safeHttpUrl(d.repoUrl || d.repo || d.remoteUrl);
    if (repo) {
      gitRepoUrl = repo;
      if (gitRepoLink) gitRepoLink.href = repo;
    }
    renderGitCommits(d.commits || d.recent || d.log);
  }

  function refreshGitStatus() {
    return fetch("/api/studio/git/status")
      .then(function (res) {
        if (res.status === 401) throw new Error("auth");
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(renderGitStatus)
      .catch(function (err) {
        // Backend may not exist yet: keep last-good values, show a hint
        // only in the drawer (never break the header button).
        if (
          gitHeadMsg &&
          (!gitHeadMsg.textContent || !gitSha || !gitSha.textContent)
        ) {
          gitHeadMsg.textContent =
            err && err.message === "auth"
              ? "Owner sign-in required"
              : "Git status unavailable";
        }
        if (gitCommitsList && !gitCommitsList.hasChildNodes()) {
          renderGitCommits([]);
        }
      });
  }

  function setGitResult(el, text, cls) {
    if (!el) return;
    el.classList.remove("is-ok", "is-error");
    el.textContent = text || "";
    if (cls) el.classList.add(cls);
  }

  function openGit() {
    pausePreviewGame();
    closeLibrary();
    if (gitDrawer) {
      gitDrawer.classList.add("open");
      gitDrawer.setAttribute("aria-hidden", "false");
    }
    if (drawerOverlay) drawerOverlay.classList.remove("hidden");
    refreshGitStatus();
  }

  if (gitBtn) gitBtn.addEventListener("click", openGit);
  if (gitClose) gitClose.addEventListener("click", closeGit);

  // Owner-only Git button: the commit/sync drawer is visible solely for
  // the owner account. Read-only probe (GET judge-audit is 401 for
  // visitors behind the proxy); the backend still enforces auth.
  (function gateGitButton() {
    if (!gitBtn) return;
    fetch("/api/studio/judge-audit", { cache: "no-store" })
      .then(function (res) {
        if (res.ok) gitBtn.classList.remove("hidden");
      })
      .catch(function () {});
  })();

  // Sync: commit (optional message) + push. Disabled while pending, inline
  // result, 401 → owner sign-in hint.
  if (gitSyncBtn) {
    gitSyncBtn.addEventListener("click", function () {
      if (gitSyncBtn.disabled) return;
      gitSyncBtn.disabled = true;
      var label = gitSyncBtn.textContent;
      gitSyncBtn.textContent = "Syncing…";
      setGitResult(gitSyncResult, "");
      var message = gitCommitInput ? gitCommitInput.value.trim() : "";
      fetch("/api/studio/git/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, ok: res.ok, data: data || {} };
          });
        })
        .then(function (result) {
          if (result.status === 401) {
            setGitResult(gitSyncResult, "Owner sign-in required", "is-error");
            return;
          }
          if (!result.ok) {
            throw new Error(result.data.error || "sync failed");
          }
          var out =
            result.data.message ||
            result.data.sha ||
            (result.data.pushed ? "Synced ✓" : "Synced ✓");
          setGitResult(gitSyncResult, String(out), "is-ok");
          if (gitCommitInput) gitCommitInput.value = "";
          refreshGitStatus();
        })
        .catch(function (err) {
          setGitResult(
            gitSyncResult,
            (err && err.message) || "Sync failed — try again.",
            "is-error",
          );
        })
        .then(function () {
          gitSyncBtn.disabled = false;
          gitSyncBtn.textContent = label;
        });
    });
  }

  // Export: scaffold a standalone game repo. Shows the repo URL (link) or a
  // needsGh setup message — all strings escaped via textContent.
  if (gitExportBtn) {
    gitExportBtn.addEventListener("click", function () {
      if (gitExportBtn.disabled) return;
      var name = gitExportInput ? gitExportInput.value.trim() : "";
      if (!name) {
        setGitResult(gitExportResult, "Enter a repo name first.", "is-error");
        return;
      }
      gitExportBtn.disabled = true;
      var label = gitExportBtn.textContent;
      gitExportBtn.textContent = "Exporting…";
      setGitResult(gitExportResult, "");
      fetch("/api/studio/git/export-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, ok: res.ok, data: data || {} };
          });
        })
        .then(function (result) {
          if (result.status === 401) {
            setGitResult(gitExportResult, "Owner sign-in required", "is-error");
            return;
          }
          if (!result.ok) {
            throw new Error(result.data.error || "export failed");
          }
          var url = safeHttpUrl(result.data.repoUrl || result.data.url);
          if (url && gitExportResult) {
            gitExportResult.classList.remove("is-error");
            gitExportResult.classList.add("is-ok");
            gitExportResult.textContent = "";
            gitExportResult.appendChild(document.createTextNode("Repo: "));
            var a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.rel = "noreferrer";
            a.textContent = url;
            gitExportResult.appendChild(a);
          } else if (result.data.needsGh) {
            setGitResult(
              gitExportResult,
              String(result.data.needsGh),
              "is-error",
            );
          } else {
            setGitResult(
              gitExportResult,
              result.data.message || "Exported ✓",
              "is-ok",
            );
          }
        })
        .catch(function (err) {
          setGitResult(
            gitExportResult,
            (err && err.message) || "Export failed — try again.",
            "is-error",
          );
        })
        .then(function () {
          gitExportBtn.disabled = false;
          gitExportBtn.textContent = label;
        });
    });
  }

  // Live header state: refresh on load, on drawer open, and every 30s.
  refreshGitStatus();
  setInterval(refreshGitStatus, 30000);

  // Save the current live-preview game to the persistent library.
  // Calls POST /api/studio/publish (same logic as src/tools/publish-game.js),
  // which copies public/live-preview/ into storage/games/<id>/ and registers
  // it in the index. Each click publishes a fresh copy; the button stays
  // enabled and briefly flashes a "Saved ✓" state before reverting.
  if (saveLibraryBtn) {
    saveLibraryBtn.addEventListener("click", function () {
      if (saveLibraryBtn.disabled) return;
      saveLibraryBtn.disabled = true;
      saveLibraryBtn.classList.add("is-busy");
      saveLibraryBtn.classList.remove("is-saved");
      fetch("/api/studio/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data || !result.data.ok) {
            throw new Error("publish failed");
          }
          setStatus("Saved to library!", "ok");
          saveLibraryBtn.classList.remove("is-busy");
          saveLibraryBtn.classList.add("is-saved");
          var label = saveLibraryBtn.querySelector(".save-btn-label");
          if (label) label.textContent = "Saved ✓";
          setTimeout(function () {
            saveLibraryBtn.classList.remove("is-saved");
            if (label) label.textContent = "Save to Library";
          }, 1800);
          refreshLibraryCount();
        })
        .catch(function () {
          saveLibraryBtn.classList.remove("is-busy");
          saveLibraryBtn.classList.remove("is-saved");
          setStatus("Could not save to library.", "error");
        })
        .then(function () {
          saveLibraryBtn.disabled = false;
        });
    });
  }

  // Refresh the live game preview: reload the #game-frame iframe against the
  // same staged URL with a fresh cache-bust timestamp. Purely client-side —
  // no backend call, no re-publish. The icon does a single half-second spin
  // to confirm the reload fired (ui-taste: quiet affordance, no hover anim).
  if (refreshPreviewBtn) {
    refreshPreviewBtn.addEventListener("click", function () {
      if (refreshPreviewBtn.disabled) return;
      if (!currentPreviewUrl || !frameEl) return;
      refreshPreviewBtn.disabled = true;
      refreshPreviewBtn.classList.add("is-spinning");
      frameEl.src = currentPreviewUrl + "?t=" + Date.now();
      setStatus("Reloading preview…", "ok");
      window.setTimeout(function () {
        refreshPreviewBtn.classList.remove("is-spinning");
        refreshPreviewBtn.disabled = false;
        setStatus("Ready.", "ok");
      }, 500);
    });
  }

  // Download the current game as a .zip (ui-taste: matches preview-actions chip).
  // Hits GET /api/studio/download which zips public/live-preview/ on the fly.
  if (downloadGameBtn) {
    downloadGameBtn.addEventListener("click", function () {
      if (downloadGameBtn.disabled) return;
      downloadGameBtn.disabled = true;
      downloadGameBtn.classList.add("is-busy");
      setStatus("Preparing download…", "ok");
      fetch("/api/studio/download", { method: "GET" })
        .then(function (res) {
          if (!res.ok) throw new Error("download failed");
          var cd = res.headers.get("content-disposition") || "";
          var m = /filename="?([^";]+)"?/i.exec(cd);
          var fname = m ? m[1] : "game.zip";
          return res.blob().then(function (b) {
            var url = URL.createObjectURL(b);
            var a = document.createElement("a");
            a.href = url;
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () {
              URL.revokeObjectURL(url);
            }, 1500);
            setStatus("Downloaded " + fname, "ok");
          });
        })
        .catch(function (err) {
          console.error("Download error:", err);
          setStatus("Download failed.", "err");
        })
        .finally(function () {
          downloadGameBtn.classList.remove("is-busy");
          downloadGameBtn.disabled = false;
        });
    });
  }

  // Mobile landscape widescreen stage + full-bleed fullscreen lock (#landscape-preview-btn).
  // By default .preview-box has .mobile-landscape so #game-frame runs in true
  // widescreen landscape (width > height) on mobile portrait viewports.
  if (previewBox) {
    previewBox.classList.add("mobile-landscape");
  }

  function syncLandscapeFullscreenUi(active) {
    if (!landscapePreviewBtn) return;
    landscapePreviewBtn.setAttribute("aria-pressed", active ? "true" : "false");
    landscapePreviewBtn.setAttribute(
      "title",
      active
        ? "Exit fullscreen landscape (Esc)"
        : "Toggle landscape / fullscreen",
    );
    if (landscapeBtnLabel) {
      landscapeBtnLabel.textContent = active
        ? "Exit fullscreen landscape"
        : "Toggle landscape / fullscreen";
    }
  }

  function setLandscapeFullscreen(active) {
    if (!previewBox) return;
    previewBox.classList.add("mobile-landscape");
    previewBox.classList.toggle("landscape-fullscreen", Boolean(active));
    syncLandscapeFullscreenUi(Boolean(active));
    if (active) {
      if (previewBox.requestFullscreen) {
        try {
          var p = previewBox.requestFullscreen();
          if (p && typeof p.catch === "function") p.catch(function () {});
        } catch (e) {
          /* ignore */
        }
      }
      if (
        window.screen &&
        window.screen.orientation &&
        typeof window.screen.orientation.lock === "function"
      ) {
        try {
          var lp = window.screen.orientation.lock("landscape");
          if (lp && typeof lp.catch === "function") lp.catch(function () {});
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        try {
          var ep = document.exitFullscreen();
          if (ep && typeof ep.catch === "function") ep.catch(function () {});
        } catch (e) {
          /* ignore */
        }
      }
      if (
        window.screen &&
        window.screen.orientation &&
        typeof window.screen.orientation.unlock === "function"
      ) {
        try {
          window.screen.orientation.unlock();
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  if (landscapePreviewBtn && previewBox) {
    landscapePreviewBtn.addEventListener("click", function () {
      var next = !previewBox.classList.contains("landscape-fullscreen");
      setLandscapeFullscreen(next);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (
      event.key === "Escape" &&
      previewBox &&
      previewBox.classList.contains("landscape-fullscreen")
    ) {
      setLandscapeFullscreen(false);
    }
  });

  // Chat history sidebar (LEFT slide-over): archived tmux transcripts +
  // live tmux windows. Continue switches straight to a still-live window;
  // only dead chats fall back to transcript + context seeding.
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
  var sidebarBody = document.getElementById("sidebar-body");
  var sidebarChatsPanel = document.getElementById("sidebar-chats-panel");
  var sidebarSkillsPanel = document.getElementById("sidebar-skills-panel");
  var sidebarSkillsList = document.getElementById("sidebar-skills-list");
  var sidebarNavChats = document.getElementById("sidebar-nav-chats");
  var sidebarNavSkills = document.getElementById("sidebar-nav-skills");
  var sidebarNavSysdesign = document.getElementById("sidebar-nav-sysdesign");
  var sidebarNewchatBtn = document.getElementById("sidebar-newchat-btn");
  var sidebarNewchatMore = document.getElementById("sidebar-newchat-more");
  var activeSidebarSection = null;
  var activeChatId = null;
  var activeChatContent = "";
  var activeGameId = null;
  var activeGameTitle = "";
  var activeWindowId = null;

  var SIDEBAR_SKILLS = [
    {
      id: "game-pipeline",
      name: "game-pipeline",
      desc: "6-Stage BUILD_TODO.md 3D Game Engineering Pipeline",
    },
    {
      id: "game-system-design",
      name: "game-system-design",
      desc: "ECS, HFSM, Marco Monster Car Physics & Quake/Celeste Feel",
    },
    {
      id: "threejs-scene-setup",
      name: "threejs-scene-setup",
      desc: "ACESFilmic, UnrealBloomPass, PMREM IBL & 3D Grass",
    },
    {
      id: "threejs-gltf-loading",
      name: "threejs-gltf-loading",
      desc: "Normalized GLB Loader, 20-Bone Armature & AnimationMixer",
    },
    {
      id: "threejs-materials-lighting",
      name: "threejs-materials-lighting",
      desc: "AmbientCG 1K Normal-Mapped PBR & Volumetric Lighting",
    },
    {
      id: "game-feel",
      name: "game-feel",
      desc: "Camera Trauma Shake, Recoil, Hit-Stop & 4-Bus Cathedral Audio",
    },
    {
      id: "ui-taste",
      name: "ui-taste",
      desc: "Executive Dark UI, Zero-Slop HUD & Touch Ergonomics",
    },
    {
      id: "webapp-testing",
      name: "webapp-testing",
      desc: "Playwright Headless Chromium & Hardened Visual QA Gate",
    },
  ];

  function renderSidebarSkills() {
    if (!sidebarSkillsList) return;
    sidebarSkillsList.innerHTML = "";
    SIDEBAR_SKILLS.forEach(function (sk) {
      var btn = document.createElement("button");
      btn.type = "button";
      var isOn =
        typeof activeSkills !== "undefined" && activeSkills.indexOf(sk.id) >= 0;
      btn.className = "v0-skill-row" + (isOn ? " active" : "");
      var nm = document.createElement("span");
      nm.className = "v0-skill-name";
      nm.textContent = "⚡ " + sk.name + (isOn ? " (active)" : "");
      var ds = document.createElement("span");
      ds.className = "v0-skill-desc";
      ds.textContent = sk.desc;
      btn.appendChild(nm);
      btn.appendChild(ds);
      btn.addEventListener("click", function () {
        if (typeof toggleSkill === "function") {
          toggleSkill(sk.id);
        }
        renderSidebarSkills();
      });
      sidebarSkillsList.appendChild(btn);
    });
  }

  function setSidebarSection(sec) {
    activeSidebarSection = sec;
    if (sidebarNavChats)
      sidebarNavChats.classList.toggle("active", sec === "chats");
    if (sidebarNavSkills)
      sidebarNavSkills.classList.toggle("active", sec === "skills");
    if (sidebarNavSysdesign)
      sidebarNavSysdesign.classList.toggle("active", sec === "sysdesign");

    if (!sec) {
      if (sidebarBody) sidebarBody.classList.add("hidden");
      if (sidebarChatsPanel) sidebarChatsPanel.classList.add("hidden");
      if (sidebarSkillsPanel) sidebarSkillsPanel.classList.add("hidden");
      return;
    }

    if (sidebarBody) sidebarBody.classList.remove("hidden");
    if (sidebarChatsPanel)
      sidebarChatsPanel.classList.toggle("hidden", sec !== "chats");
    if (sidebarSkillsPanel)
      sidebarSkillsPanel.classList.toggle("hidden", sec !== "skills");

    if (sec === "chats") {
      if (sidebarSub) {
        sidebarSub.textContent =
          "Inactive / unkilled terminals — click any session to resume where it left off.";
      }
      showSidebarList();
      if (sidebarList) sidebarList.innerHTML = "";
      var loading = document.createElement("div");
      loading.className = "sidebar-empty";
      loading.textContent = "Loading terminals…";
      if (sidebarList) sidebarList.appendChild(loading);
      fetch("/api/studio/chats")
        .then(function (res) {
          return res.ok ? res.json() : [];
        })
        .then(renderSidebarList)
        .catch(function () {
          renderSidebarList([]);
        });
    } else if (sec === "skills") {
      if (sidebarSub) {
        sidebarSub.textContent =
          "Agent skills — click to toggle active skills for the next build.";
      }
      renderSidebarSkills();
    } else if (sec === "sysdesign") {
      if (sidebarSub) {
        sidebarSub.textContent = "System Design & Pipeline";
      }
    }
  }

  if (sidebarNavChats) {
    sidebarNavChats.addEventListener("click", function () {
      setSidebarSection(activeSidebarSection === "chats" ? null : "chats");
    });
  }
  if (sidebarNavSkills) {
    sidebarNavSkills.addEventListener("click", function () {
      setSidebarSection(activeSidebarSection === "skills" ? null : "skills");
    });
  }
  if (sidebarNavSysdesign) {
    sidebarNavSysdesign.addEventListener("click", function () {
      setSidebarSection(
        activeSidebarSection === "sysdesign" ? null : "sysdesign",
      );
    });
  }
  function triggerSidebarNewChat() {
    closeSidebar();
    var topNewChat = document.getElementById("newchat-btn");
    if (topNewChat) topNewChat.click();
  }
  if (sidebarNewchatBtn)
    sidebarNewchatBtn.addEventListener("click", triggerSidebarNewChat);
  if (sidebarNewchatMore)
    sidebarNewchatMore.addEventListener("click", triggerSidebarNewChat);

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
    activeGameId = null;
    activeGameTitle = "";
    activeWindowId = null;
    if (sidebarView) sidebarView.classList.add("hidden");
    if (sidebarList) sidebarList.classList.remove("hidden");
  }

  function renderSidebarList(list) {
    if (!sidebarList) return;
    sidebarList.innerHTML = "";
    var chats = Array.isArray(list) ? list : [];
    if (!chats.length) {
      var empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent =
        "No inactive terminals yet — click New Chat to spawn a background terminal.";
      sidebarList.appendChild(empty);
      return;
    }
    chats.forEach(function (c) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "sidebar-item";
      var title = document.createElement("p");
      title.className = "sidebar-item-title";
      title.textContent =
        c.transcript === false
          ? "Terminal " +
            (c.windowId || "") +
            (c.windowActive ? " (active)" : " (inactive / resumable)")
          : c.id || "terminal";
      item.appendChild(title);
      var meta = document.createElement("p");
      meta.className = "sidebar-item-meta";
      meta.textContent =
        [fmtChatTime(c.createdAt), fmtChatSize(c.size)]
          .filter(Boolean)
          .join(" · ") || "unkilled tmux terminal";
      item.appendChild(meta);
      if (c.live) {
        var live = document.createElement("p");
        live.className = "sidebar-item-meta";
        live.textContent =
          "● UNKILLED " +
          (c.windowId || "") +
          (c.windowActive ? " · current" : " · ready to resume");
        item.appendChild(live);
      }
      if (c.preview) {
        var prev = document.createElement("p");
        prev.className = "sidebar-item-preview";
        prev.textContent = c.preview;
        item.appendChild(prev);
      }
      if (c.gameId) {
        var gm = document.createElement("p");
        gm.className = "sidebar-item-preview";
        gm.textContent = "Game: " + (c.gameTitle || c.gameId);
        item.appendChild(gm);
      }
      var view = document.createElement("span");
      view.className = "sidebar-item-view";
      view.textContent = "Resume terminal →";
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
    fetch("/api/studio/chats/" + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) throw new Error("chat load failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        activeChatId = data && data.id ? data.id : id;
        activeChatContent =
          data && typeof data.content === "string" ? data.content : "";
        activeGameId = data && data.gameId ? data.gameId : null;
        activeGameTitle = data && data.gameTitle ? String(data.gameTitle) : "";
        activeWindowId = data && data.windowId ? data.windowId : null;
        if (sidebarMeta)
          sidebarMeta.textContent =
            activeChatId + (activeGameTitle ? " · " + activeGameTitle : "");
        if (sidebarTranscript)
          sidebarTranscript.textContent =
            data && data.transcript === false
              ? "(Unkilled background terminal — click Continue terminal to switch straight back to it.)"
              : activeChatContent || "(empty)";
        if (sidebarTranscript) sidebarTranscript.scrollTop = 0;
      })
      .catch(function () {
        if (sidebarTranscript)
          sidebarTranscript.textContent = "Could not load this terminal.";
        setStatus("Could not load terminal.", "error");
      });
  }

  function openSidebar() {
    pausePreviewGame();
    if (sidebar) {
      sidebar.classList.add("open");
      sidebar.setAttribute("aria-hidden", "false");
    }
    if (sidebarOverlay) sidebarOverlay.classList.remove("hidden");
    setSidebarSection(null);
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
      // Fast path first: the chat's tmux window may still be alive — the
      // server switches straight to it (and activates its linked game).
      // Only dead/unlinked chats use the legacy context-seeding flow below.
      var legacyContinue = function () {
        var prompt =
          "Continuing from a previous chat (archived " +
          activeChatId +
          "). Key context:\n" +
          String(activeChatContent || "").slice(0, 1500) +
          "\n---\nUser will now continue.";
        loadTerminalInline();
        // Restore this chat's linked game into the live preview FIRST so
        // the session continues with the same game + context it archived.
        var restore = Promise.resolve(false);
        var readOnlyHit = false;
        if (activeGameId) {
          setStatus('Restoring "' + (activeGameTitle || activeGameId) + '"…');
          restore = fetch(
            "/api/studio/games/" +
              encodeURIComponent(activeGameId) +
              "/activate",
            { method: "POST" },
          )
            .then(function (res) {
              if (!res.ok) throw new Error("activate failed: " + res.status);
              return res.json();
            })
            .then(function (data) {
              playPreview(
                (data && data.url) || "/studio/live-preview/index.html",
                (data && data.title) || activeGameTitle || "Game Preview",
              );
              return true;
            })
            .catch(function () {
              setStatus(
                "Saved game missing — continuing with chat context only.",
                "warn",
              );
              return false;
            });
        }
        restore
          .then(function (gameRestored) {
            return fetch("/api/studio/terminal/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: prompt,
                scope: scopeEl ? scopeEl.value : "game",
                skills: activeSkills.slice(),
              }),
            }).then(function (res) {
              if (res.status === 401) {
                readOnlyHit = true;
                return gameRestored;
              }
              if (!res.ok) throw new Error("send failed: " + res.status);
              return gameRestored;
            });
          })
          .then(function (gameRestored) {
            closeSidebar();
            if (readOnlyHit) {
              setStatus(READ_ONLY_MSG, "warn");
              return;
            }
            setStatus(
              gameRestored
                ? "Game + context restored — continue in the live terminal."
                : "Context sent — continue in the live terminal.",
              "ok",
            );
          })
          .catch(function () {
            setStatus("Could not send context to the live terminal.", "error");
          })
          .then(function () {
            sidebarContinue.disabled = false;
          });
      };
      fetch(
        "/api/studio/chats/" + encodeURIComponent(activeChatId) + "/continue",
        { method: "POST" },
      )
        .then(function (res) {
          if (!res.ok) throw new Error("continue failed: " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.switched) {
            if (data.gameActivated) {
              playPreview(
                data.url || "/studio/live-preview/index.html",
                data.title || activeGameTitle || "Game Preview",
              );
              refreshLibraryCount();
            }
            loadTerminalInline();
            closeSidebar();
            setStatus(
              "Switched to live terminal " +
                (data.windowId || "") +
                " — your agent is still there.",
              "ok",
            );
            sidebarContinue.disabled = false;
            return;
          }
          legacyContinue();
        })
        .catch(function () {
          legacyContinue();
        });
    });

  // VM backend health check (Cloud icon + Green/Grey status dot)
  function setLiveHealth(online) {
    if (liveDot) {
      liveDot.className = online ? "live-dot on" : "live-dot off";
    }
    if (liveText) {
      liveText.textContent = online ? "vm live" : "vm offline";
    }
  }

  function checkBackendHealth() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLiveHealth(false);
      return;
    }
    var t0 = Date.now();
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (e) {
            /* ignore */
          }
        }, 2500)
      : null;
    fetch("/api/studio/health", {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("offline");
        return res.json();
      })
      .then(function (data) {
        var rtt = Date.now() - t0;
        if (data && data.ok && rtt <= 2200) {
          setLiveHealth(true);
        } else {
          setLiveHealth(false);
        }
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        setLiveHealth(false);
      });
  }
  checkBackendHealth();
  setInterval(checkBackendHealth, 4000);
  window.addEventListener("online", checkBackendHealth);
  window.addEventListener("offline", function () {
    setLiveHealth(false);
  });

  // Terminal scrollbar handle (invisible track, visible thumb handle) + touch scroll
  var termDragging = false;
  var termLastRatioSentAt = 0;
  var termPendingTimer = null;

  function renderTermThumbAtRatio(ratio, history, paneHeight) {
    if (!termScrollbar || !termScrollThumb) return;
    var trackH = termScrollbar.clientHeight || 240;
    var h = Math.max(16, Number(paneHeight) || 32);
    var hist = Math.max(0, Number(history) || 0);
    var total = h + hist;
    var frac = total > h ? h / total : 0.25;
    var thumbH = Math.max(
      36,
      Math.min(Math.round(trackH * 0.45), Math.round(trackH * frac)),
    );
    var r = Math.max(0, Math.min(1, Number(ratio)));
    if (!isFinite(r)) r = 1;
    var maxTop = Math.max(0, trackH - thumbH);
    var top = Math.round(r * maxTop);
    termScrollThumb.style.height = thumbH + "px";
    termScrollThumb.style.top = top + "px";
  }

  function updateTermScrollThumb(scrollState) {
    if (!scrollState || termDragging) return;
    var ratio = 1;
    if (scrollState.inMode && scrollState.history > 0) {
      ratio =
        1 - Math.min(1, Math.max(0, scrollState.pos / scrollState.history));
    }
    renderTermThumbAtRatio(ratio, scrollState.history, scrollState.height);
  }

  function sendTermScroll(payload) {
    fetch("/api/studio/terminal/scroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.terminalScroll && !termDragging) {
          updateTermScrollThumb(data.terminalScroll);
        }
      })
      .catch(function () {
        /* ignore */
      });
  }

  function sendTermRatioThrottled(ratio, force) {
    var now = Date.now();
    if (force || now - termLastRatioSentAt >= 65) {
      termLastRatioSentAt = now;
      if (termPendingTimer) {
        clearTimeout(termPendingTimer);
        termPendingTimer = null;
      }
      sendTermScroll({ action: "ratio", ratio: ratio });
    } else if (!termPendingTimer) {
      termPendingTimer = setTimeout(function () {
        termPendingTimer = null;
        termLastRatioSentAt = Date.now();
        sendTermScroll({ action: "ratio", ratio: ratio });
      }, 65);
    }
  }

  function ratioFromClientY(clientY) {
    if (!termScrollbar) return 1;
    var rect = termScrollbar.getBoundingClientRect();
    if (!rect || rect.height <= 0) return 1;
    var y = clientY - rect.top;
    return Math.max(0, Math.min(1, y / rect.height));
  }

  if (termScrollbar && termScrollThumb) {
    renderTermThumbAtRatio(1, 0, 32);

    termScrollbar.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      termDragging = true;
      termScrollThumb.classList.add("dragging");
      if (termScrollbar.setPointerCapture && event.pointerId !== undefined) {
        try {
          termScrollbar.setPointerCapture(event.pointerId);
        } catch (e) {
          /* ignore */
        }
      }
      var r = ratioFromClientY(event.clientY);
      renderTermThumbAtRatio(r, 0, 32);
      sendTermRatioThrottled(r, true);
    });

    termScrollbar.addEventListener("pointermove", function (event) {
      if (!termDragging) return;
      event.preventDefault();
      var r = ratioFromClientY(event.clientY);
      renderTermThumbAtRatio(r, 0, 32);
      sendTermRatioThrottled(r, false);
    });

    function endTermDrag(event) {
      if (!termDragging) return;
      termDragging = false;
      termScrollThumb.classList.remove("dragging");
      if (event && typeof event.clientY === "number") {
        var r = ratioFromClientY(event.clientY);
        renderTermThumbAtRatio(r, 0, 32);
        sendTermRatioThrottled(r, true);
      }
    }

    termScrollbar.addEventListener("pointerup", endTermDrag);
    termScrollbar.addEventListener("pointercancel", endTermDrag);

    termScrollbar.addEventListener(
      "wheel",
      function (event) {
        event.preventDefault();
        sendTermScroll({
          action: event.deltaY < 0 ? "up" : "down",
          lines: 5,
        });
      },
      { passive: false },
    );
  }

  // Watch public/live-preview/ so whenever Muse Code CLI writes or updates
  // a game or 3D model preview, the right-side iframe updates automatically.
  function pollPreviewState() {
    fetch("/api/studio/preview-state")
      .then(function (res) {
        if (!res.ok) {
          setLiveHealth(false);
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.terminalScroll) {
          updateTermScrollThumb(data.terminalScroll);
        }
        // Save-to-library + Refresh-preview button visibility follow the
        // preview-state ready flag: only show header actions when a live game
        // is staged in public/live-preview/. Hidden otherwise.
        if (saveLibraryBtn) {
          saveLibraryBtn.classList.toggle("hidden", !data.ready);
        }
        if (refreshPreviewBtn) {
          refreshPreviewBtn.classList.toggle("hidden", !data.ready);
        }
        if (downloadGameBtn) {
          downloadGameBtn.classList.toggle("hidden", !data.ready);
        }
        if (typeof data.cliBusy === "boolean") {
          if (data.cliBusy) {
            if (!agentWorking) {
              setAgentWorking(true, 0);
            }
          } else if (
            agentWorking &&
            Date.now() >= agentGraceUntil &&
            !running
          ) {
            setAgentWorking(false, 0);
            setStatus("Ready.", "ok");
          }
        }
        if (!data.ready || !data.updatedAt) {
          if (!currentPreviewUrl && headerTitleEl) {
            headerTitleEl.textContent = "Agentic Game Studio";
          }
          return;
        }
        if (
          data.title &&
          headerTitleEl &&
          (!currentPreviewUrl || currentPreviewUrl === data.url)
        ) {
          headerTitleEl.textContent = data.title;
        }
        if (data.updatedAt > lastPreviewUpdatedAt) {
          lastPreviewUpdatedAt = data.updatedAt;
          // The server auto-saved this update into the library — keep the
          // #library-count badge in sync without opening the drawer.
          refreshLibraryCount();
          // Read-only visitor is watching a stored game — never yank the
          // frame (or titles) back to the live preview.
          if (previewReadOnly) return;
          if (titleEl) titleEl.textContent = data.title || "Game Preview";
          if (headerTitleEl) {
            headerTitleEl.textContent = data.title || "Game Preview";
          }
          if (emptyEl) emptyEl.classList.add("hidden");
          if (frameEl) {
            frameEl.classList.remove("hidden");
            currentPreviewUrl = data.url;
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

  // Hackathon judge verification: ?judge=<token> links verify judges so
  // uncached live-AI builds stay open to them (strangers get 403 + cached
  // prompts + library play). The token persists across reloads.
  var JUDGE_TOKEN_KEY = "ags_judge_token";
  function loadJudgeToken() {
    try {
      return localStorage.getItem(JUDGE_TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }
  (function captureJudgeToken() {
    var val = null;
    try {
      val =
        window.location &&
        window.location.search &&
        new URLSearchParams(window.location.search).get("judge");
    } catch (e) {
      val = null;
    }
    if (!val) return;
    try {
      localStorage.setItem(JUDGE_TOKEN_KEY, val);
    } catch (e) {
      /* ignore (privacy mode / quota) */
    }
    fetch("/api/studio/judge-audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-judge-token": val,
      },
      body: JSON.stringify({ event: "judge_visit", judgeToken: val }),
    }).catch(function () {
      /* audit ping is best-effort */
    });
  })();

  // Read-only visitor mode: terminal-owning calls 401 for public judges.
  var READ_ONLY_MSG = "Read-only visitor mode: sign in to run CLI commands.";
  function throwIfReadOnly(res) {
    if (res && res.status === 401) throw { name: "ReadOnlyVisitor" };
  }
  function isReadOnlyErr(err) {
    return Boolean(err && err.name === "ReadOnlyVisitor");
  }

  // Judge Sandbox: public visitors (terminal/send 401) build games through
  // the sandboxed SSE pipeline instead — no VM/terminal access involved.
  // Resolves { judgeSandbox: true } — never throws (own status reporting).
  function sandboxPhaseLabel(ev) {
    if (ev.id === "brain" && ev.status === "running") {
      return "Designing with Muse Wonder 1.0";
    }
    if (ev.id === "webgl" && ev.status === "running") {
      return "Compiling Three.js 3D WebGL game";
    }
    if (ev.id === "image" && ev.status === "running") {
      return "Painting concept art with Muse Image";
    }
    if (ev.id === "store" && ev.status === "running") {
      return "Saving to the game library";
    }
    return ev.label || ev.message || "Working";
  }

  function handleSandboxEvent(raw) {
    var ev = null;
    try {
      ev = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "phase") {
      setStatus("Judge Sandbox: " + sandboxPhaseLabel(ev) + "…", "ok");
      return;
    }
    if (ev.type === "done") {
      setAgentWorking(false, 0);
      if (ev.ok && ev.playUrl) {
        playPreview(ev.playUrl, ev.title || "Judge Build", true);
        refreshLibraryCount();
        setStatus("Judge Sandbox: game ready — playing now.", "ok");
      } else {
        setStatus("Judge Sandbox build failed — try again.", "error");
      }
      return;
    }
    if (ev.type === "error") {
      setAgentWorking(false, 0);
      setStatus("Judge Sandbox build failed — try again.", "error");
    }
  }

  function runJudgeSandboxBuild(prompt, model) {
    setAgentWorking(true, 0);
    setStatus("Judge Sandbox: queueing build…", "ok");
    var judgeToken = loadJudgeToken();
    var genHeaders = { "Content-Type": "application/json" };
    var genBody = {
      prompt: prompt,
      model: model,
      scope: scopeEl ? scopeEl.value : "game",
      skills: activeSkills.slice(),
    };
    if (judgeToken) {
      genHeaders["x-judge-token"] = judgeToken;
      genBody.judgeToken = judgeToken;
    }
    return fetch("/api/studio/generate", {
      method: "POST",
      headers: genHeaders,
      body: JSON.stringify(genBody),
    })
      .then(function (res) {
        if (res.status === 429) {
          setAgentWorking(false, 0);
          setStatus(
            "Judge Sandbox is busy (6 builds per 10 min) — try again in a few minutes.",
            "warn",
          );
          return { judgeSandbox: true };
        }
        if (res.status === 403) {
          setAgentWorking(false, 0);
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (j) {
              setStatus(
                "Judge Sandbox: " +
                  ((j && j.error) || "judge access link required."),
                "warn",
              );
              return { judgeSandbox: true };
            });
        }
        if (!res.ok || !res.body || !res.body.getReader) {
          throw new Error("sandbox failed: " + res.status);
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        var pump = function () {
          return reader.read().then(function (r) {
            if (r.done) return { judgeSandbox: true };
            buf += decoder.decode(r.value, { stream: true });
            var parts = buf.split("\n\n");
            buf = parts.pop();
            parts.forEach(function (chunk) {
              chunk.split("\n").forEach(function (line) {
                line = line.replace(/^\s+|\s+$/g, "");
                if (line.indexOf("data:") === 0) {
                  handleSandboxEvent(line.slice(5).trim());
                }
              });
            });
            return pump();
          });
        };
        return pump();
      })
      .catch(function () {
        setAgentWorking(false, 0);
        setStatus("Judge Sandbox build failed — try again.", "error");
        return { judgeSandbox: true };
      });
  }

  // Enter submits (Shift+Enter inserts a newline); Escape stops running CLI when prompt is empty
  promptEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (running || agentWorking) return;
      formEl.requestSubmit();
      return;
    }
    if (
      event.key === "Escape" &&
      (running || agentWorking) &&
      !promptEl.value.trim()
    ) {
      event.preventDefault();
      stopAgentRun();
    }
  });

  if (sendBtn) {
    sendBtn.addEventListener("click", function (event) {
      if (running || agentWorking) {
        event.preventDefault();
        event.stopPropagation();
        stopAgentRun();
      }
    });
  }

  // Switching the model picker switches the live CLI model in the terminal
  modelEl.addEventListener("change", function () {
    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelEl.value,
        scope: scopeEl ? scopeEl.value : "game",
        skills: activeSkills.slice(),
      }),
    })
      .then(function (res) {
        throwIfReadOnly(res);
        if (!res.ok) throw new Error("model switch failed");
        setStatus("Switched CLI model to " + modelEl.value + ".", "ok");
      })
      .catch(function (err) {
        if (isReadOnlyErr(err)) {
          setStatus(READ_ONLY_MSG, "warn");
          return;
        }
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
    if (open) closePlusMenu();
    modelMenu.classList.toggle("hidden", !open);
    modelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeModelMenu() {
    setModelOpen(false);
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
      closePlusMenu();
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
    closeFlyout();
  }
  function setSubOpen(toggle, panel, open) {
    if (!toggle || !panel) return;
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function isSubOpen(panel) {
    return !!panel && !panel.classList.contains("hidden");
  }

  /* Floating second-level panels (flyouts beside the row; hover on desktop, click on touch) */
  var PLUS_SUBS = [
    [plusSkillsToggle, plusSkills],
    [plusInstructionsToggle, plusInstructions],
    [plusMcpsToggle, plusMcps],
    [plusPermissionsToggle, plusPermissions],
  ];
  var openSub = null;
  var flyoutTimer = null;
  // Reparent panels to <body> so the parent menu's scroll/overflow never clips them
  PLUS_SUBS.forEach(function (pair) {
    if (pair[1] && pair[1].parentNode !== document.body) {
      document.body.appendChild(pair[1]);
      pair[1].classList.add("plus-flyout");
    }
  });
  function positionFlyout(row, panel) {
    var rect = row.getBoundingClientRect();
    var width = panel.offsetWidth || 240;
    var left = rect.right + 8;
    if (left + width + 8 > window.innerWidth) {
      left = Math.max(8, rect.left - width - 8);
    }
    var pad = 16;
    var height = panel.offsetHeight || 240;
    var top = rect.top;
    if (top + height + pad > window.innerHeight) {
      top = Math.max(pad, window.innerHeight - height - pad);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.maxHeight =
      Math.max(180, window.innerHeight - top - pad) + "px";
  }
  function openFlyout(row, panel) {
    if (!row || !panel) return;
    if (openSub && openSub.panel !== panel)
      setSubOpen(openSub.row, openSub.panel, false);
    setSubOpen(row, panel, true);
    positionFlyout(row, panel);
    openSub = { row: row, panel: panel };
  }
  function closeFlyout() {
    if (openSub) {
      setSubOpen(openSub.row, openSub.panel, false);
      openSub = null;
    }
  }
  function scheduleFlyoutClose() {
    clearTimeout(flyoutTimer);
    flyoutTimer = setTimeout(closeFlyout, 180);
  }
  function toggleSub(toggle, panel) {
    var wasOpen = isSubOpen(panel);
    closeFlyout();
    if (!wasOpen) openFlyout(toggle, panel);
  }
  if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
    PLUS_SUBS.forEach(function (pair) {
      var row = pair[0];
      var panel = pair[1];
      if (!row || !panel) return;
      row.addEventListener("mouseenter", function () {
        clearTimeout(flyoutTimer);
        openFlyout(row, panel);
      });
      row.addEventListener("mouseleave", scheduleFlyoutClose);
      panel.addEventListener("mouseenter", function () {
        clearTimeout(flyoutTimer);
      });
      panel.addEventListener("mouseleave", scheduleFlyoutClose);
    });
  }
  window.addEventListener(
    "scroll",
    function (event) {
      if (openSub && openSub.panel.contains(event.target)) {
        return; // scrolling inside the flyout is fine
      }
      closeFlyout();
    },
    true,
  );
  window.addEventListener("resize", closeFlyout);
  if (attachBtn) {
    attachBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      closeModelMenu();
      if (plusMenu) plusMenu.classList.toggle("hidden");
    });
  }
  if (scopeEl) {
    scopeEl.addEventListener("mousedown", function () {
      closePlusMenu();
      closeModelMenu();
    });
    scopeEl.addEventListener("focus", function () {
      closePlusMenu();
      closeModelMenu();
    });
  }
  if (promptEl) {
    promptEl.addEventListener("mousedown", function () {
      closePlusMenu();
      closeModelMenu();
    });
    promptEl.addEventListener("focus", function () {
      closePlusMenu();
      closeModelMenu();
    });
  }
  document.addEventListener("click", function (event) {
    var inFlyout = PLUS_SUBS.some(function (pair) {
      return pair[1] && pair[1].contains(event.target);
    });
    if (
      plusMenu &&
      !plusMenu.classList.contains("hidden") &&
      !plusMenu.contains(event.target) &&
      !inFlyout &&
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
  if (plusPermissionsToggle) {
    plusPermissionsToggle.addEventListener("click", function () {
      toggleSub(plusPermissionsToggle, plusPermissions);
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
  var skillTerm = "";
  function renderSkillItems() {
    var listEl = plusSkills.querySelector(".plus-skill-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    var term = skillTerm.toLowerCase();
    var shown = cachedCapabilities.skills.filter(function (s) {
      if (!term) return true;
      return (
        (s.id || "").toLowerCase().indexOf(term) !== -1 ||
        (s.description || "").toLowerCase().indexOf(term) !== -1
      );
    });
    if (!shown.length) {
      var none = document.createElement("div");
      none.className = "plus-hint";
      none.textContent = term
        ? "No skills match this search."
        : "No skills found in this workspace.";
      listEl.appendChild(none);
    }
    shown.forEach(function (s) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "plus-item";
      item.setAttribute("role", "menuitem");
      item.title = s.description || s.id;
      var name = document.createElement("span");
      name.textContent = s.id;
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
      listEl.appendChild(item);
    });
  }
  function ensureSkillsShell() {
    if (plusSkills.querySelector(".plus-skill-list")) return;
    var search = document.createElement("input");
    search.type = "text";
    search.className = "plus-search";
    search.placeholder = "Search skills…";
    search.setAttribute("aria-label", "Search skills");
    search.maxLength = 40;
    search.addEventListener("input", function () {
      skillTerm = search.value || "";
      renderSkillItems();
    });
    var list = document.createElement("div");
    list.className = "plus-skill-list";
    plusSkills.appendChild(search);
    plusSkills.appendChild(list);
  }
  function renderPlusMenu() {
    if (plusSkills) {
      ensureSkillsShell();
      renderSkillItems();
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
      function hueFromId(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++)
          h = (h * 31 + str.charCodeAt(i)) >>> 0;
        return h % 360;
      }
      var MCP_ICON_MAP = {
        context7: "/studio/icons/mcp/context7.ico",
        playwright: "/studio/icons/mcp/playwright.svg",
        shadcn: "/studio/icons/mcp/shadcn.svg",
        "sequential-thinking": "/studio/icons/mcp/default.svg",
        "studio-3d-tools": "/studio/icons/mcp/studio-3d-tools.svg",
      };
      function brandIconSrc(name) {
        var key = (name || "").toLowerCase();
        if (MCP_ICON_MAP[key]) return MCP_ICON_MAP[key];
        var mark = Object.keys(MCP_ICON_MAP).filter(function (k) {
          return key.indexOf(k) !== -1;
        });
        return mark.length ? MCP_ICON_MAP[mark[0]] : "";
      }
      function makeMcpIcon(srv) {
        var holder = document.createElement("span");
        holder.className = "mcp-badge";
        var hue = hueFromId(srv.name || "mcp");
        function fallbackLetter() {
          holder.style.background = "hsl(" + hue + ", 65%, 45%)";
          var letter = document.createElement("span");
          letter.textContent = (srv.name || "m").charAt(0).toUpperCase();
          holder.appendChild(letter);
        }
        var src = brandIconSrc(srv.name);
        if (src) {
          var img = document.createElement("img");
          img.className = "mcp-badge-img";
          img.alt = "";
          img.addEventListener("error", fallbackLetter);
          img.src = src;
          holder.appendChild(img);
          return holder;
        }
        fallbackLetter();
        return holder;
      }
      servers.forEach(function (srv) {
        var row = document.createElement("div");
        row.className = "plus-item plus-mcp-row";
        row.appendChild(makeMcpIcon(srv));
        var name = document.createElement("span");
        name.className = "mcp-name";
        name.textContent = srv.name;
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

  // Microphone dictation: real Meta muse-voice-transcribe-1.0 first
  // (MediaRecorder -> POST /api/studio/voice/transcribe, owner-only),
  // browser SpeechRecognition as the visitor/offline fallback.
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var metaMic = { recording: false, rec: null, chunks: [], stream: null };
  function insertDictation(text) {
    if (!text) return;
    var clean = String(text).trim();
    if (!clean) return;
    // Never insert non-speech placeholder stems into the prompt box.
    if (/^\[non-speech audio stem/i.test(clean)) return;
    var current = promptEl.value || "";
    // Avoid double-insert when the same transcript arrives twice.
    if (current.indexOf(clean) !== -1) {
      promptEl.focus();
      return;
    }
    promptEl.value = (current ? current + " " : "") + clean;
    scheduleDraftSave();
    promptEl.focus();
  }
  function stopMetaTracks() {
    try {
      (metaMic.stream ? metaMic.stream.getTracks() : []).forEach(function (t) {
        t.stop();
      });
    } catch (e) {
      /* ignore */
    }
    metaMic.stream = null;
  }
  var legacyRec = null;
  var legacyRecognizing = false;
  function startLegacyDictation() {
    if (!SpeechRec) {
      setStatus("Voice input needs a microphone-capable browser.", "error");
      return;
    }
    if (!legacyRec) {
      legacyRec = new SpeechRec();
      legacyRec.lang = "en-US";
      legacyRec.interimResults = false;
      legacyRec.addEventListener("result", function (event) {
        var text = "";
        for (var i = 0; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
        }
        insertDictation(text);
      });
      legacyRec.addEventListener("end", function () {
        legacyRecognizing = false;
        micBtn.classList.remove("busy");
      });
    }
    if (legacyRecognizing) {
      try {
        legacyRec.stop();
      } catch (e) {
        /* ignore */
      }
      return;
    }
    legacyRecognizing = true;
    micBtn.classList.add("busy");
    try {
      legacyRec.start();
    } catch (e) {
      legacyRecognizing = false;
      micBtn.classList.remove("busy");
    }
  }
  function sendMetaVoice(blob) {
    var fd = new FormData();
    fd.append("audio", blob, "mic.webm");
    setStatus("Transcribing via muse-voice-transcribe-1.0…", "ok");
    fetch("/api/studio/voice/transcribe", { method: "POST", body: fd })
      .then(function (res) {
        if (res.status === 401) {
          setStatus("Visitor mode: falling back to browser dictation…", "warn");
          startLegacyDictation();
          return null;
        }
        if (!res.ok) throw new Error("transcribe failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        var t = String(data.transcript || "").trim();
        if (!t || /^\[non-speech audio stem/i.test(t)) {
          setStatus("No speech detected — try again.", "warn");
          return;
        }
        insertDictation(t);
        setStatus("Transcribed via muse-voice-transcribe-1.0.", "ok");
      })
      .catch(function () {
        setStatus("Voice transcription failed — try again.", "error");
      });
  }
  function startMetaDictation() {
    var gum =
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : null;
    if (!gum || !window.MediaRecorder) {
      startLegacyDictation();
      return;
    }
    gum({ audio: true })
      .then(function (stream) {
        metaMic.stream = stream;
        metaMic.chunks = [];
        var mime = "audio/webm;codecs=opus";
        try {
          if (!window.MediaRecorder.isTypeSupported(mime)) mime = "";
        } catch (e) {
          mime = "";
        }
        var rec = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        metaMic.rec = rec;
        metaMic.recording = true;
        micBtn.classList.add("busy");
        setStatus(
          "Listening… (muse-voice-transcribe-1.0, 5s — click mic to cancel)",
          "ok",
        );
        rec.addEventListener("dataavailable", function (ev) {
          if (ev.data && ev.data.size) metaMic.chunks.push(ev.data);
        });
        rec.addEventListener("stop", function () {
          var wasRecording = metaMic.recording;
          metaMic.recording = false;
          metaMic.rec = null;
          micBtn.classList.remove("busy");
          stopMetaTracks();
          if (!wasRecording) return; // cancelled via second click
          var blob = new Blob(metaMic.chunks, { type: "audio/webm" });
          metaMic.chunks = [];
          if (!blob.size) {
            setStatus("No audio captured — try again.", "error");
            return;
          }
          sendMetaVoice(blob);
        });
        rec.start();
        setTimeout(function () {
          try {
            if (metaMic.rec === rec && rec.state !== "inactive") rec.stop();
          } catch (e) {
            /* ignore */
          }
        }, 5000);
      })
      .catch(function () {
        setStatus("Microphone blocked — using browser dictation…", "warn");
        startLegacyDictation();
      });
  }
  if (micBtn) {
    var canMetaMic = Boolean(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.MediaRecorder,
    );
    if (canMetaMic || SpeechRec) micBtn.classList.remove("hidden");
    micBtn.addEventListener("click", function () {
      if (metaMic.recording && metaMic.rec) {
        metaMic.recording = false; // stop handler sees cancel, sends nothing
        try {
          metaMic.rec.stop();
        } catch (e) {
          /* ignore */
        }
        setStatus("Mic cancelled.", "warn");
        return;
      }
      if (legacyRecognizing && legacyRec) {
        try {
          legacyRec.stop();
        } catch (e) {
          /* ignore */
        }
        return;
      }
      startMetaDictation();
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
    if (running || agentWorking) {
      stopAgentRun();
      return;
    }
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
    setAgentWorking(true, 4500);
    setBusy(true);
    setStatus("Sending to Muse Code CLI…");

    loadTerminalInline();

    var controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    sendAbortController = controller;

    fetch("/api/studio/terminal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: finalPrompt,
        model: model,
        attachments: currentAttachments,
        scope: scope,
        skills: activeSkills.slice(),
      }),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (res.status === 401) {
          // Public visitor: build via the sandboxed judge pipeline instead.
          return runJudgeSandboxBuild(finalPrompt, model);
        }
        if (!res.ok) throw new Error("Backend answered " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.judgeSandbox) return;
        if (controller && controller.signal.aborted) return;
        promptEl.value = "";
        clearDraft();
        attachments = [];
        activeSkills = [];
        customInstructions = [];
        renderAttachments();
        renderSkillChips();
        renderInstructionChips();
        renderPlusMenu();
        setStatus("Muse Code CLI working (" + model + ")…", "ok");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        setAgentWorking(false, 0);
        setStatus("Could not reach the VM CLI terminal.", "error");
      })
      .then(function () {
        if (sendAbortController === controller) {
          sendAbortController = null;
        }
        running = false;
        setBusy(false);
        promptEl.focus();
      });
  });

  // New chat: reset UI conversation state; the backend snapshots the current
  // tmux window and opens a FRESH window beside it (never kills the
  // session). The new window is auto-active so ttyd follows by itself.
  // Manual reattach (veil + delayed reload) survives below for the rare
  // dead-socket case via the reconnect button (ui-taste: no light box, no
  // manual keypress, no spinner; muted text on black).
  var newchatBtn = document.getElementById("newchat-btn");
  var TERMINAL_URL = "https://spurcode.duckdns.org/terminal/?v=14";
  var reconnectTimer = null;
  var reconnectSafety = null;
  var reconnectBtn = document.getElementById("terminal-reconnect-btn");

  function hideReconnectBtn() {
    if (reconnectBtn) reconnectBtn.classList.add("hidden");
  }

  function showReconnectBtn() {
    var frame = document.getElementById("cli-frame");
    // Only offer a manual retry when the inline terminal is active.
    if (!frame || !frame.getAttribute("src")) return;
    if (reconnectBtn) reconnectBtn.classList.remove("hidden");
  }

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
    // Inline terminal without src — nothing to refresh, just load it.
    if (!frame || !frame.getAttribute("src")) {
      loadTerminalInline();
      return;
    }
    hideReconnectBtn();
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
        showReconnectBtn();
        setStatus("Fresh terminal is taking long — please wait.", "warn");
      }, 20000);
    }, 2500);
  }

  // Fresh attach confirmed: drop the veil. Guarded so the initial
  // inline load (no veil showing) is unaffected.
  var cliFrameEl = document.getElementById("cli-frame");
  if (cliFrameEl) {
    cliFrameEl.addEventListener("load", function () {
      hideReconnectBtn();
      var overlay = document.getElementById("terminal-reconnect");
      if (overlay && !overlay.classList.contains("hidden")) {
        if (reconnectSafety) {
          clearTimeout(reconnectSafety);
          reconnectSafety = null;
        }
        hideTerminalLoading();
      }
    });
    cliFrameEl.addEventListener("error", function () {
      showReconnectBtn();
    });
  }
  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", function () {
      reconnectTerminalFresh();
    });
  }

  function newChat() {
    pausePreviewGame();
    // Busy guard: confirm before interrupting, then stop gracefully so the
    // backend archives a settled game + chat instead of mid-write files.
    var wasBusy = Boolean(running || agentWorking);
    if (wasBusy) {
      var proceed = false;
      try {
        proceed = window.confirm(
          "The agent is still working in this terminal. It will KEEP " +
            "running there. Start a new chat alongside it? " +
            "Your current game and a chat snapshot will be archived first.",
        );
      } catch (e) {
        proceed = false;
      }
      if (!proceed) return;
      stopComposerRequest();
    }
    if (sendAbortController) {
      try {
        sendAbortController.abort();
      } catch (e) {
        /* ignore */
      }
      sendAbortController = null;
    }
    running = false;
    setAgentWorking(false, 0);
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
    closeModelMenu();
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
    currentPreviewUrl = null;
    previewReadOnly = false;
    if (titleEl) titleEl.textContent = "Game Preview";
    if (headerTitleEl) headerTitleEl.textContent = "Agentic Game Studio";
    if (frameEl) {
      frameEl.classList.add("hidden");
      frameEl.removeAttribute("src");
    }
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (promptEl && window.innerWidth > 960) promptEl.focus();
    // The backend auto-saves the live game + archives the chat (linked by
    // gameId). Delay slightly after a busy-stop so the stop lands first.
    var requestFreshSession = function () {
      fetch("/api/studio/session/new", { method: "POST" })
        .then(function (res) {
          if (res.status === 401) {
            setStatus(READ_ONLY_MSG, "warn");
            return null;
          }
          if (!res.ok) throw new Error("new session failed: " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data) return;
          var saved =
            data && data.savedGame && data.savedGame.title
              ? 'Game "' + data.savedGame.title + '" saved to library. '
              : "";
          setStatus(
            saved +
              "Previous chat archived — old terminal kept alive. " +
              "Fresh terminal ready.",
            "ok",
          );
          refreshLibraryCount();
          // No iframe reload: the session was never killed, and the new
          // window is already active, so ttyd shows it by itself.
        })
        .catch(function () {
          setStatus(
            "UI reset. Fresh terminal unavailable — start failed.",
            "warn",
          );
        });
    };
    if (wasBusy) {
      setTimeout(requestFreshSession, 700);
    } else {
      requestFreshSession();
    }
  }
  if (newchatBtn) newchatBtn.addEventListener("click", newChat);

  // Terminal inline preview: loads directly in-app, no sign-in gate.
  // The iframe always renders; no connect card or manual load button.
  // Auth guard (CSP fix): GitHub login refuses framing (frame-ancestors),
  // so the iframe src is only set when an owner session exists. Logged-out
  // visitors get a compact sign-in link (top-level tab, never framed) that
  // auto-loads the terminal the moment the session appears — the blocked
  // "Framing 'https://github.com/' violates default-src 'self'" frame
  // can never occur.
  var terminalInlineBound = false;
  function showInlineTerminal() {
    var frame = document.getElementById("cli-frame");
    if (!frame) return;
    frame.classList.remove("hidden");
  }
  function loadTerminalInline() {
    var frame = document.getElementById("cli-frame");
    if (!frame) return;
    if (!frame.getAttribute("src")) {
      frame.src = TERMINAL_URL;
    }
    var signin = document.getElementById("terminal-signin");
    if (signin && signin.parentNode) signin.parentNode.removeChild(signin);
    frame.classList.remove("hidden");
    if (!terminalInlineBound) {
      terminalInlineBound = true;
      frame.addEventListener("load", showInlineTerminal);
    }
  }
  function showTerminalSignin() {
    var frame = document.getElementById("cli-frame");
    if (frame) frame.classList.add("hidden");
    var box = document.querySelector(".terminal-section .terminal-box");
    if (!box || document.getElementById("terminal-signin")) return;
    var wrap = document.createElement("div");
    wrap.id = "terminal-signin";
    wrap.className = "terminal-connect";
    var mark = document.createElement("div");
    mark.className = "connect-mark";
    mark.setAttribute("aria-hidden", "true");
    wrap.appendChild(mark);
    var text = document.createElement("p");
    text.className = "terminal-connect-text";
    text.textContent =
      "Sign in with GitHub to load the live terminal. It opens in a new tab; the terminal appears here automatically.";
    wrap.appendChild(text);
    var actions = document.createElement("div");
    actions.className = "terminal-connect-actions";
    var link = document.createElement("a");
    link.className = "terminal-btn terminal-btn-primary";
    link.href = "https://spurcode.duckdns.org/terminal/";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Sign in with GitHub";
    link.addEventListener("click", function () {
      var poll = setInterval(function () {
        fetch("/api/studio/git/status", { cache: "no-store" })
          .then(function (res) {
            if (res.ok) {
              clearInterval(poll);
              loadTerminalInline();
            }
          })
          .catch(function () {});
      }, 3000);
      setTimeout(function () {
        clearInterval(poll);
      }, 120000);
    });
    actions.appendChild(link);
    wrap.appendChild(actions);
    box.appendChild(wrap);
  }
  function initInlineTerminal() {
    // Direct open: set the iframe src immediately for everyone.
    loadTerminalInline();
    // Downgrade-only probe (CSP fix): GitHub login refuses framing
    // (frame-ancestors), so a logged-out iframe ends in a CSP-blocked
    // "Framing 'https://github.com/' violates default-src 'self'" page.
    // Same-origin terminal pages stay readable — anything else means the
    // session is missing, so swap the dead frame for the sign-in link
    // instead of ever showing the browser's blocked-content error.
    setTimeout(function () {
      var frame = document.getElementById("cli-frame");
      if (!frame || !frame.getAttribute("src")) return;
      var readable = false;
      try {
        var doc =
          frame.contentDocument ||
          (frame.contentWindow && frame.contentWindow.document);
        if (doc) readable = true;
      } catch (e) {
        readable = false;
      }
      if (!readable) showTerminalSignin();
    }, 4000);
  }
  initInlineTerminal();

  // PWA offline (ui-taste: silent, no UI chrome): register the service
  // worker only where it can work — https or localhost. No inline scripts
  // anywhere (CSP script-src 'self'), so this lives in studio.js.
  (function registerOfflineWorker() {
    if (!("serviceWorker" in navigator)) return;
    var proto = window.location.protocol;
    var host = window.location.hostname;
    var local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "";
    if (proto !== "https:" && !local) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/studio/sw.js").catch(function () {
        /* offline support unavailable — app still works online */
      });
    });
  })();
})();
