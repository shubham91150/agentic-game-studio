"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  Expand,
  ExternalLink,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Smartphone,
  Terminal,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import GameViewport from "./game-viewport.js";

// All agent work happens on the VM. The Vercel app is only the remote:
// prompt composer at the bottom, live Muse Code terminal on top.
const STUDIO_API_BASE =
  process.env.NEXT_PUBLIC_STUDIO_API_BASE || "https://spurcode.duckdns.org";

// Only models verified live on this VM may be offered here.
const CLI_MODELS = [
  { id: "muse-spark-1.3", label: "Muse Spark 1.3", hint: "Fast · CLI default" },
  { id: "muse-wonder-1.0", label: "Muse Wonder 1.0", hint: "High reasoning" },
];

const DEFAULT_PROMPT =
  "Build a compact lunar rover challenge with low-gravity jumps, collectible signal beacons, and precise collision physics.";

const TEMPLATES = [
  {
    title: "Lunar rover course",
    description: "Low gravity, beacon pickups, and collision-aware movement.",
    prompt: DEFAULT_PROMPT,
  },
  {
    title: "Orbital courier",
    description: "A compact delivery route through a quiet asteroid field.",
    prompt:
      "Create an orbital courier game with a small ship, readable docking targets, and momentum-based steering.",
  },
  {
    title: "Signal garden",
    description: "Explore a quiet world and reconnect scattered beacons.",
    prompt:
      "Build a calm exploration scene where players reconnect signal beacons across a low-poly landscape.",
  },
];

function downloadText(filename, content, mimeType) {
  const file = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

export default function StudioWorkbench() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState(CLI_MODELS[0].id);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("terminal");
  const [isBuilding, setIsBuilding] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [activity, setActivity] = useState("Checking VM backend…");
  const [activityLevel, setActivityLevel] = useState("info");
  const [usage, setUsage] = useState(null);
  const [backend, setBackend] = useState({ state: "checking", cli: false });
  const [generated, setGenerated] = useState(null);
  const [library, setLibrary] = useState([]);
  const [stats, setStats] = useState({ fps: 60, drawCalls: 24 });
  const [isPaused, setIsPaused] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const qrDialogRef = useRef(null);
  const templateDialogRef = useRef(null);
  const previewFrameRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const promptRef = useRef(null);

  const currentCode =
    generated?.unityCode ||
    "// No generated code yet.\n// Press Send — the Muse Code CLI writes AgenticPlayerController.cs on the VM\n// and it will appear here verbatim.";

  const onStats = useCallback((nextStats) => {
    setStats((current) => ({ ...current, ...nextStats }));
  }, []);

  const say = useCallback((text, level = "info") => {
    setActivity(text);
    setActivityLevel(level);
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === previewFrameRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch(`${STUDIO_API_BASE}/api/studio/games`);
      if (!res.ok) return;
      const games = await res.json();
      if (Array.isArray(games)) setLibrary(games);
    } catch {
      /* backend offline — library stays empty */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${STUDIO_API_BASE}/api/studio/health`);
        if (!res.ok) throw new Error("bad status");
        const data = await res.json();
        if (cancelled) return;
        setBackend({
          state: "online",
          cli: Boolean(data.components?.museCodeCLI),
        });
        say(
          data.components?.museCodeCLI
            ? "VM backend online. Muse Code CLI detected — describe a game below."
            : "VM backend online, but Muse Code CLI was not detected there.",
          "ok",
        );
      } catch {
        if (cancelled) return;
        setBackend({ state: "offline", cli: false });
        say(
          "VM backend unreachable — builds will fail until it is back.",
          "error",
        );
      }
    })();
    refreshLibrary();
    return () => {
      cancelled = true;
    };
  }, [say, refreshLibrary]);

  const handleEvent = useCallback(
    (evt) => {
      switch (evt.type) {
        case "start":
          say(`Run started: "${evt.prompt}"`, "info");
          break;
        case "log":
          say(evt.message, evt.level || "info");
          break;
        case "cli":
          say(`${evt.stream === "stderr" ? "! " : "$ "}${evt.line}`, "cli");
          break;
        case "reasoning":
          say(`· ${evt.line}`, "reason");
          break;
        case "spec":
          setGenerated((current) => ({
            ...(current || {}),
            spec: evt.spec,
            title: evt.spec?.title,
          }));
          say(`Spec ready: biome ${evt.spec?.world?.biome || "?"}`, "ok");
          break;
        case "proof":
          say(
            `[proof] ${evt.name} — ${evt.passed ? "PASSED" : "FAILED"}`,
            evt.passed ? "ok" : "warn",
          );
          break;
        case "artifact":
          if (evt.kind === "unity") {
            setGenerated((current) => ({
              ...(current || {}),
              unityCode: evt.content,
              unitySource: evt.source,
            }));
            say(
              evt.source === "muse-cli"
                ? "Unity C# received from Muse Code CLI (written on VM)."
                : "Unity C# is from the local template fallback.",
              evt.source === "muse-cli" ? "ok" : "warn",
            );
          }
          break;
        case "usage": {
          const totals = (evt.models || []).reduce(
            (acc, m) => ({
              in: acc.in + (m.input_tokens || 0),
              out: acc.out + (m.output_tokens || 0),
              cached: acc.cached + (m.cached_tokens || 0),
            }),
            { in: 0, out: 0, cached: 0 },
          );
          setUsage(totals);
          say(
            `CLI tokens this run: ${totals.in} in / ${totals.out} out (${totals.cached} cached)`,
            "info",
          );
          break;
        }
        case "error":
          say(evt.message, "error");
          break;
        case "done":
          if (evt.ok && evt.playUrl) {
            setGenerated((current) => ({
              ...(current || {}),
              gameId: evt.gameId,
              title: evt.title,
              playUrl: `${STUDIO_API_BASE}${evt.playUrl}`,
              imageUrl: evt.imageUrl
                ? `${STUDIO_API_BASE}${evt.imageUrl}`
                : current?.imageUrl || null,
              unitySource: evt.unitySource,
            }));
            say(
              `Game ready: "${evt.title}" in ${(evt.elapsedMs / 1000).toFixed(1)}s`,
              "ok",
            );
            setTab("game");
            refreshLibrary();
          } else {
            say("Run finished without a playable game.", "error");
          }
          break;
        default:
          break;
      }
    },
    [say, refreshLibrary],
  );

  async function readSseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const block of parts) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            handleEvent(JSON.parse(payload));
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  }
  const handleBuild = async () => {
    if (isBuilding) return;
    if (!prompt.trim()) {
      setPromptError(true);
      say("Add a game idea before building.", "warn");
      return;
    }
    if (backend.state === "offline") {
      say("VM backend is offline — cannot start a build.", "error");
      return;
    }
    setPromptError(false);
    setIsBuilding(true);
    setUsage(null);
    say("Agent is running on the VM…", "info");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${STUDIO_API_BASE}/api/studio/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          attachments: attachments.map((a) => ({ id: a.id, name: a.name })),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body)
        throw new Error(`Backend answered ${res.status}`);
      await readSseStream(res);
    } catch (err) {
      if (err?.name !== "AbortError") {
        say("Build failed — connection to the VM backend was lost.", "error");
      }
    } finally {
      setIsBuilding(false);
      abortRef.current = null;
    }
  };

  const handleAttach = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        say(`"${file.name}" is over 10MB — skipped.`, "warn");
        continue;
      }
      setUploading(true);
      try {
        const res = await fetch(
          `${STUDIO_API_BASE}/api/studio/upload?name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
          },
        );
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        const data = await res.json();
        setAttachments((current) => [...current, data]);
        say(`Attached "${data.name}".`, "ok");
      } catch {
        say(`Could not upload "${file.name}".`, "error");
      } finally {
        setUploading(false);
      }
    }
  };

  const removeAttachment = (id) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  };

  const handleNewProject = () => {
    abortRef.current?.abort();
    setIsBuilding(false);
    setPrompt("");
    setAttachments([]);
    setUsage(null);
    setPromptError(false);
    setIsPaused(false);
    setGenerated(null);
    setResetRevision((revision) => revision + 1);
    say("New project ready. Add an idea to start.", "info");
    if (promptRef.current) {
      promptRef.current.style.height = "auto";
    }
  };

  const playLibraryGame = (game) => {
    setGenerated((current) => ({
      ...(current || {}),
      gameId: game.id,
      title: game.title,
      playUrl: `${STUDIO_API_BASE}${game.playUrl}`,
      imageUrl: game.imageUrl ? `${STUDIO_API_BASE}${game.imageUrl}` : null,
      unitySource: undefined,
      unityCode: undefined,
      spec: undefined,
    }));
    setTab("game");
    say(`Loaded "${game.title}" from the library.`, "ok");
  };

  const makeShareUrl = () => {
    if (generated?.playUrl) return generated.playUrl;
    const url = new URL("/play", window.location.origin);
    if (prompt.trim()) url.searchParams.set("idea", prompt.trim());
    return url.toString();
  };

  const openQrDialog = () => {
    setShareUrl(makeShareUrl());
    qrDialogRef.current?.showModal();
  };

  const handleCopyShareLink = async () => {
    try {
      await copyText(makeShareUrl());
      say(
        generated?.playUrl ? "Playable game link copied." : "Link copied.",
        "ok",
      );
    } catch {
      say("Could not copy the link.", "error");
    }
  };

  const handleDownloadCode = () => {
    downloadText("AgenticPlayerController.cs", currentCode, "text/plain");
    say(
      generated?.unitySource === "muse-cli"
        ? "Unity C# downloaded (written by Muse Code CLI on the VM)."
        : "Unity C# downloaded.",
      "ok",
    );
  };

  const handleExport = () => {
    if (generated?.playUrl) {
      window.open(generated.playUrl, "_blank", "noopener");
      say("Opened the playable WebGL build in a new tab.", "ok");
    } else {
      say("No WebGL build yet — run Build Game first.", "warn");
    }
  };

  const handleFullscreen = async () => {
    const frame = previewFrameRef.current;
    if (!frame) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.requestFullscreen();
    } catch {
      say("Fullscreen is unavailable in this browser.", "error");
    }
  };

  const selectTemplate = (nextPrompt) => {
    abortRef.current?.abort();
    setIsBuilding(false);
    setPrompt(nextPrompt);
    setPromptError(false);
    say("Template loaded. Review the prompt, then build.", "info");
    templateDialogRef.current?.close();
    window.setTimeout(() => {
      if (promptRef.current) {
        promptRef.current.style.height = "auto";
        promptRef.current.style.height = `${Math.min(promptRef.current.scrollHeight, 160)}px`;
      }
    }, 0);
  };

  const handlePromptKeyDown = (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleBuild();
    }
  };

  const autoGrow = (event) => {
    const field = event.currentTarget;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  };

  const openTerminal = () => {
    window.open(`${STUDIO_API_BASE}/terminal/`, "_blank", "noopener");
  };

  const terminalUrl = `${STUDIO_API_BASE}/terminal/`;

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="studio-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="brand-name">Agentic Game Studio</span>
          <span className="brand-badge">Meta Hackathon</span>
          <span className="demo-badge">
            {backend.state === "online"
              ? "VM live"
              : backend.state === "offline"
                ? "VM offline"
                : "checking"}
          </span>
        </div>

        <nav className="topbar-actions" aria-label="Main navigation">
          <button
            className="topbar-link topbar-template"
            type="button"
            onClick={() => templateDialogRef.current?.showModal()}
          >
            Templates
          </button>
          <a
            className="topbar-link"
            href="https://github.com/shubham91150/agentic-game-studio"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ExternalLink aria-hidden="true" />
          </a>
          <button
            className="button button-primary button-new-project"
            type="button"
            onClick={handleNewProject}
          >
            New Project
          </button>
        </nav>
      </header>

      <div className="studio-body">
        <div className="tab-bar" role="tablist" aria-label="Studio views">
          <button
            className={`tab-btn${tab === "terminal" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === "terminal"}
            onClick={() => setTab("terminal")}
          >
            <Terminal aria-hidden="true" />
            <span>Terminal</span>
          </button>
          <button
            className={`tab-btn${tab === "game" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === "game"}
            onClick={() => setTab("game")}
          >
            <Play aria-hidden="true" />
            <span>Game</span>
          </button>
          <span className="tab-status" aria-live="polite">
            <span
              className={`status-dot${backend.state === "online" ? " status-on" : ""}`}
            />
            {backend.state === "online"
              ? `VM live${backend.cli ? " · Muse Code CLI" : ""}`
              : backend.state === "offline"
                ? "VM offline"
                : "Connecting…"}
          </span>
        </div>

        {tab === "terminal" ? (
          <section className="terminal-pane" aria-labelledby="terminal-title">
            <div className="terminal-card">
              <Terminal aria-hidden="true" className="terminal-icon" />
              <h2 id="terminal-title">Muse Code CLI — live on VM</h2>
              <p>
                The agent terminal runs on the VM. Open it in a new tab (same
                login as here) and type <code>muse</code> to drive the build
                yourself.
              </p>
              <div className="terminal-actions">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={openTerminal}
                >
                  Open Live Terminal
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() =>
                    copyText(terminalUrl).then(
                      () => say("Terminal URL copied.", "ok"),
                      () => say("Could not copy the URL.", "error"),
                    )
                  }
                >
                  <Copy aria-hidden="true" />
                  <span>Copy URL</span>
                </button>
              </div>
              {usage ? (
                <p className="terminal-usage">
                  Last run CLI tokens: {usage.in} in / {usage.out} out
                  {usage.cached ? ` (${usage.cached} cached)` : ""}
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <section
            className="preview-pane game-tab-pane"
            aria-labelledby="preview-title"
            ref={previewFrameRef}
          >
            <div className="preview-header">
              <div className="preview-title-group">
                <h2 id="preview-title">
                  {generated?.title || "Project Preview"}
                </h2>
                <span className="fps-pill">
                  <span className="status-dot" />
                  {stats.fps} FPS
                </span>
              </div>
              <div className="preview-toolbar" aria-label="Preview controls">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Reset view"
                  title="Reset view"
                  onClick={() => {
                    setResetRevision((revision) => revision + 1);
                    setReloadKey((key) => key + 1);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={isPaused ? "Play preview" : "Pause preview"}
                  title={isPaused ? "Play preview" : "Pause preview"}
                  onClick={() => setIsPaused((paused) => !paused)}
                >
                  {isPaused ? (
                    <Play aria-hidden="true" />
                  ) : (
                    <Pause aria-hidden="true" />
                  )}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={
                    isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={handleFullscreen}
                >
                  {isFullscreen ? (
                    <X aria-hidden="true" />
                  ) : (
                    <Expand aria-hidden="true" />
                  )}
                </button>
                <button
                  className="button button-secondary mobile-qr-button"
                  type="button"
                  onClick={openQrDialog}
                >
                  <Smartphone aria-hidden="true" />
                  <span>Mobile QR</span>
                </button>
              </div>
            </div>

            <div className="preview-stage">
              {generated?.playUrl ? (
                <iframe
                  key={generated.gameId}
                  className="game-frame"
                  src={generated.playUrl}
                  title={`Playable build: ${generated.title || "generated game"}`}
                  allow="autoplay; fullscreen"
                />
              ) : (
                <>
                  <GameViewport
                    isPlaying={!isPaused}
                    resetRevision={resetRevision}
                    onStats={onStats}
                  />
                  <div className="viewport-hint" aria-hidden="true">
                    Drag to orbit · WASD to move
                  </div>
                </>
              )}
            </div>

            {generated?.imageUrl ? (
              <div className="concept-row">
                <img
                  src={generated.imageUrl}
                  alt={`Concept art for ${generated.title || "generated game"}`}
                />
                <div className="concept-copy">
                  <strong>Concept art · Muse Image 1.0</strong>
                  <span>{generated.title}</span>
                </div>
              </div>
            ) : null}

            <div className="preview-footer">
              <div className="telemetry-list" aria-label="Preview telemetry">
                <div className="telemetry-item resolution-item">
                  <span>Source</span>
                  <strong>
                    {generated?.playUrl ? "VM build" : "Local preview"}
                  </strong>
                </div>
                <div className="telemetry-item">
                  <span>Draw Calls</span>
                  <strong>{stats.drawCalls}</strong>
                </div>
                <div className="telemetry-item">
                  <span>Unity code</span>
                  <strong>
                    {generated?.unitySource === "muse-cli"
                      ? "Muse CLI"
                      : generated?.unityCode
                        ? "Template"
                        : "—"}
                  </strong>
                </div>
              </div>
              <div className="footer-actions">
                <button
                  className="button button-footer"
                  type="button"
                  onClick={handleDownloadCode}
                >
                  <Download aria-hidden="true" />
                  <span>Export Unity</span>
                </button>
                <button
                  className="button button-footer"
                  type="button"
                  onClick={handleExport}
                >
                  <Expand aria-hidden="true" />
                  <span>Open WebGL</span>
                </button>
                <button
                  className="button button-footer"
                  type="button"
                  onClick={handleCopyShareLink}
                >
                  <Link2 aria-hidden="true" />
                  <span>Copy Share Link</span>
                </button>
              </div>
            </div>

            <div className="library-block" aria-label="Stored games">
              <div className="library-heading">
                <span>Library</span>
                <span>{library.length} saved</span>
              </div>
              {library.length === 0 ? (
                <p className="library-empty">
                  No stored games yet. Build one and it will wait for you here.
                </p>
              ) : (
                <ul className="library-list">
                  {library.slice(0, 8).map((game) => (
                    <li className="library-item" key={game.id}>
                      <div className="library-copy">
                        <strong>{game.title}</strong>
                        <span>
                          {game.biome || "world"} ·{" "}
                          {game.createdAt
                            ? new Date(game.createdAt).toLocaleDateString()
                            : ""}
                        </span>
                      </div>
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        onClick={() => playLibraryGame(game)}
                      >
                        <Play aria-hidden="true" />
                        <span>Play</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {attachments.length > 0 ? (
          <div className="attach-row" aria-label="Attachments">
            {attachments.map((a) => (
              <span className="attach-chip" key={a.id}>
                <span className="attach-name">{a.name}</span>
                <button
                  className="attach-remove"
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={`activity-line activity-${activityLevel}`}
          role="status"
          aria-live="polite"
          title={activity}
        >
          <span className="activity-text">{activity}</span>
          {usage ? (
            <span className="activity-usage">
              CLI {usage.in} in / {usage.out} out
            </span>
          ) : null}
        </div>

        <div className="composer" role="form" aria-label="Game prompt composer">
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            multiple
            onChange={handleAttach}
          />
          <button
            className="icon-button composer-btn"
            type="button"
            aria-label="Attach a file"
            title="Attach a reference file (sent to the agent)"
            disabled={uploading || isBuilding}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <LoaderCircle className="spin-icon" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
          </button>
          <div className="select-wrap composer-select">
            <select
              className="control-select"
              aria-label="Agent model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={isBuilding}
            >
              {CLI_MODELS.map((m) => (
                <option key={m.id} value={m.id} title={m.hint}>
                  {m.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
          <textarea
            ref={promptRef}
            className={`prompt-textarea composer-input${promptError ? " has-error" : ""}`}
            value={prompt}
            rows={1}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (event.target.value.trim()) setPromptError(false);
            }}
            onInput={autoGrow}
            onKeyDown={handlePromptKeyDown}
            placeholder="Describe the game to build… (⌘ Enter to send)"
            aria-label="Game prompt"
            aria-invalid={promptError}
          />
          <button
            className="button button-primary composer-send"
            type="button"
            onClick={handleBuild}
            disabled={isBuilding || uploading}
            aria-label="Send prompt to the agent"
          >
            {isBuilding ? (
              <LoaderCircle className="spin-icon" aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
          </button>
        </div>
        {promptError ? (
          <p className="field-error composer-error" role="alert">
            Enter a game idea to continue.
          </p>
        ) : null}
      </div>

      <dialog
        className="studio-dialog"
        ref={templateDialogRef}
        aria-labelledby="templates-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="dialog-kicker">Starter prompts</p>
            <h2 id="templates-title">Choose a template</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close templates"
            onClick={() => templateDialogRef.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="template-list">
          {TEMPLATES.map((template) => (
            <button
              className="template-option"
              type="button"
              key={template.title}
              onClick={() => selectTemplate(template.prompt)}
            >
              <span className="template-icon">
                <Terminal aria-hidden="true" />
              </span>
              <span className="template-copy">
                <strong>{template.title}</strong>
                <span>{template.description}</span>
              </span>
              <span className="template-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
        <p className="dialog-note">
          Templates only fill the prompt. The build itself runs live on the VM.
        </p>
      </dialog>

      <dialog
        className="studio-dialog qr-dialog"
        ref={qrDialogRef}
        aria-labelledby="qr-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="dialog-kicker">Mobile preview</p>
            <h2 id="qr-title">Open on your phone</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close QR dialog"
            onClick={() => qrDialogRef.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="qr-code-wrap">
          {shareUrl ? (
            <QRCodeSVG
              value={shareUrl}
              size={208}
              bgColor="#f4f4f5"
              fgColor="#09090b"
              includeMargin
            />
          ) : null}
        </div>
        <p className="qr-description">
          Scan to open the playable build with touch controls.
        </p>
        <p className="dialog-note">
          {generated?.playUrl
            ? "This link opens the actual game generated on the VM."
            : "Build a game first — the link will then open the real generated build."}
        </p>
        <button
          className="button button-primary dialog-copy-button"
          type="button"
          onClick={handleCopyShareLink}
        >
          <Copy aria-hidden="true" />
          Copy link
        </button>
      </dialog>
    </main>
  );
}
