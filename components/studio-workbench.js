"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Box,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Download,
  Expand,
  ExternalLink,
  FileCode2,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Terminal,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import GameViewport from "./game-viewport.js";

// VM backend that runs the Muse Code CLI and the Baseten planner.
// The Vercel-hosted UI only renders; all agent work happens there.
const STUDIO_API_BASE =
  process.env.NEXT_PUBLIC_STUDIO_API_BASE || "https://spurcode.duckdns.org";

const DEFAULT_PROMPT =
  "Build a compact lunar rover challenge with low-gravity jumps, collectible signal beacons, and precise collision physics.";

const PIPELINE = [
  { id: "shield", title: "Prompt safety check", source: "local rules" },
  {
    id: "brain",
    title: "Game design",
    source: "Muse Wonder 1.0 + Spark Open",
  },
  { id: "image", title: "Concept art", source: "Muse Image 1.0" },
  {
    id: "cli",
    title: "File pass on VM",
    source: "Muse Code CLI · Spark 1.3",
  },
  { id: "world", title: "World terrain + layout", source: "procedural" },
  { id: "webgl", title: "WebGL runtime", source: "Three.js" },
  { id: "unity", title: "Unity C# script", source: "CLI or template" },
  { id: "qa", title: "Physics QA checks", source: "BFS + math" },
  { id: "store", title: "Save to library", source: "VM storage" },
];

const TABS = [
  { id: "reasoning", label: "Agent Reasoning", icon: Activity },
  { id: "code", label: "Generated Code", icon: FileCode2 },
  { id: "assets", label: "Assets", icon: Box },
];

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

const EMPTY_STAGES = Object.fromEntries(PIPELINE.map((s) => [s.id, "pending"]));

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

function getTimeLabel() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function StudioWorkbench() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [engine, setEngine] = useState("Three.js WebGL");
  const [controls, setControls] = useState("Keyboard + Mobile Touch");
  const [complexity, setComplexity] = useState("Arcade");
  const [stages, setStages] = useState(EMPTY_STAGES);
  const [activeTab, setActiveTab] = useState("reasoning");
  const [isBuilding, setIsBuilding] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const [stats, setStats] = useState({
    fps: 60,
    drawCalls: 24,
    geometryMemoryMB: 42,
  });
  const [notice, setNotice] = useState("Checking VM backend…");
  const [shareUrl, setShareUrl] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [backend, setBackend] = useState({ state: "checking", cli: false });
  const [generated, setGenerated] = useState(null);
  const [library, setLibrary] = useState([]);

  const qrDialogRef = useRef(null);
  const templateDialogRef = useRef(null);
  const previewFrameRef = useRef(null);
  const abortRef = useRef(null);
  const tabRefs = useRef({});

  const currentCode =
    generated?.unityCode ||
    "// No generated code yet.\n// Press Build Game — the Muse Code CLI writes AgenticPlayerController.cs on the VM\n// and it will appear here verbatim.";

  const onStats = useCallback((nextStats) => {
    setStats((current) => ({ ...current, ...nextStats }));
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

  const addLog = useCallback((text, level = "info") => {
    setLogs((current) => [
      ...current.slice(-300),
      { time: getTimeLabel(), text, level },
    ]);
  }, []);

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

  // Backend health on mount: this is how the UI knows the VM is reachable.
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
        setNotice(
          data.components?.museCodeCLI
            ? "VM backend online. Muse Code CLI detected — ready to build."
            : "VM backend online, but Muse Code CLI was not detected there.",
        );
        addLog("Connected to VM backend. Agent pipeline is live.", "ok");
      } catch {
        if (cancelled) return;
        setBackend({ state: "offline", cli: false });
        setNotice("VM backend unreachable. Builds will fail until it is back.");
        addLog("Could not reach the VM backend.", "error");
      }
    })();
    refreshLibrary();
    return () => {
      cancelled = true;
    };
  }, [addLog, refreshLibrary]);

  const handleEvent = useCallback(
    (evt) => {
      switch (evt.type) {
        case "start":
          addLog(`Run started: "${evt.prompt}"`, "info");
          break;
        case "phase":
          setStages((current) => ({ ...current, [evt.id]: evt.status }));
          if (evt.status === "running") {
            const step = PIPELINE.find((s) => s.id === evt.id);
            if (step) addLog(`→ ${step.title}`, "info");
          }
          break;
        case "log":
          addLog(evt.message, evt.level || "info");
          break;
        case "cli":
          addLog(`${evt.stream === "stderr" ? "! " : "$ "}${evt.line}`, "cli");
          break;
        case "reasoning":
          addLog(`· ${evt.line}`, "reason");
          break;
        case "spec":
          setGenerated((current) => ({
            ...(current || {}),
            spec: evt.spec,
            title: evt.spec?.title,
          }));
          addLog(`Spec ready: biome ${evt.spec?.world?.biome || "?"}`, "ok");
          break;
        case "proof":
          addLog(
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
            addLog(
              evt.source === "muse-cli"
                ? "Unity C# received from Muse Code CLI (written on VM)."
                : "Unity C# is from the local template fallback.",
              evt.source === "muse-cli" ? "ok" : "warn",
            );
          }
          break;
        case "error":
          addLog(evt.message, "error");
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
                : null,
              unitySource: evt.unitySource,
            }));
            addLog(
              `Game ready: "${evt.title}" in ${(evt.elapsedMs / 1000).toFixed(1)}s`,
              "ok",
            );
            setNotice(
              `Build complete — "${evt.title}" is playing in the preview.`,
            );
            refreshLibrary();
          } else {
            addLog("Run finished without a playable build.", "error");
            setNotice(
              "Build finished without a playable game. Check the console.",
            );
          }
          break;
        default:
          break;
      }
    },
    [addLog, refreshLibrary],
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
      setNotice("Add a game idea before building.");
      return;
    }
    if (backend.state === "offline") {
      setNotice("VM backend is offline — cannot start a build.");
      addLog("Build blocked: VM backend offline.", "error");
      return;
    }

    setPromptError(false);
    setIsBuilding(true);
    setActiveTab("reasoning");
    setStages(EMPTY_STAGES);
    setGenerated(null);
    setLogs([]);
    setNotice("Agent is running on the VM — watch the console.");
    addLog("Sending prompt to VM backend…", "info");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${STUDIO_API_BASE}/api/studio/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body)
        throw new Error(`Backend answered ${res.status}`);
      await readSseStream(res);
    } catch (err) {
      if (err?.name !== "AbortError") {
        addLog("Connection to VM backend failed during the run.", "error");
        setNotice("Build failed — connection to the VM backend was lost.");
      }
    } finally {
      setIsBuilding(false);
      abortRef.current = null;
    }
  };

  const handleNewProject = () => {
    abortRef.current?.abort();
    setIsBuilding(false);
    setPrompt("");
    setEngine("Three.js WebGL");
    setControls("Keyboard + Mobile Touch");
    setComplexity("Arcade");
    setStages(EMPTY_STAGES);
    setActiveTab("reasoning");
    setPromptError(false);
    setIsPaused(false);
    setGenerated(null);
    setResetRevision((revision) => revision + 1);
    setNotice("New project ready. Add an idea to start.");
    setLogs([]);
  };

  const playLibraryGame = (game) => {
    setGenerated((current) => ({
      ...(current || {}),
      gameId: game.id,
      title: game.title,
      playUrl: `${STUDIO_API_BASE}${game.playUrl}`,
    }));
    setNotice(`Loaded "${game.title}" from the library.`);
    addLog(`Loaded stored game: ${game.title}`, "ok");
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
      setNotice(
        generated?.playUrl
          ? "Playable game link copied."
          : "Link copied. It includes the current prompt text.",
      );
    } catch {
      setNotice(
        "Could not copy the link. Check clipboard permissions and try again.",
      );
    }
  };

  const handleCopyCode = async () => {
    try {
      await copyText(currentCode);
      setNotice("Code copied to the clipboard.");
    } catch {
      setNotice(
        "Could not copy code. Check clipboard permissions and try again.",
      );
    }
  };

  const handleDownloadCode = () => {
    downloadText("AgenticPlayerController.cs", currentCode, "text/plain");
    setNotice(
      generated?.unitySource === "muse-cli"
        ? "Unity C# downloaded (written by Muse Code CLI on the VM)."
        : "Unity C# downloaded.",
    );
  };

  const handleExport = () => {
    if (engine === "Unity C#") {
      handleDownloadCode();
      return;
    }
    if (generated?.playUrl) {
      window.open(generated.playUrl, "_blank", "noopener");
      setNotice("Opened the playable WebGL build in a new tab.");
    } else {
      setNotice("No WebGL build yet — run Build Game first.");
    }
  };

  const handleFullscreen = async () => {
    const frame = previewFrameRef.current;
    if (!frame) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  };

  const selectTemplate = (nextPrompt) => {
    abortRef.current?.abort();
    setIsBuilding(false);
    setPrompt(nextPrompt);
    setPromptError(false);
    setStages(EMPTY_STAGES);
    setNotice("Template loaded. Review the prompt, then build.");
    templateDialogRef.current?.close();
  };

  const handleTabKeyDown = (event, currentTab) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const handlePromptKeyDown = (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      handleBuild();
    }
  };

  const renderTabPanel = () => {
    if (activeTab === "code") {
      return (
        <section
          className="console-panel code-panel"
          id="panel-code"
          role="tabpanel"
          aria-labelledby="tab-code"
          tabIndex={0}
        >
          <div className="console-panel-heading">
            <span className="console-caption">
              {generated?.unityCode
                ? generated.unitySource === "muse-cli"
                  ? "Unity C# · written by Muse Code CLI on VM"
                  : "Unity C# · template fallback"
                : "Unity C# · not generated yet"}
            </span>
            <div className="console-actions">
              <button
                className="icon-text-button"
                type="button"
                onClick={handleCopyCode}
              >
                <Copy aria-hidden="true" />
                <span>Copy</span>
              </button>
              <button
                className="icon-text-button"
                type="button"
                onClick={handleDownloadCode}
              >
                <Download aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          </div>
          <pre className="code-block">
            <code>{currentCode}</code>
          </pre>
        </section>
      );
    }

    if (activeTab === "assets") {
      const assets = generated?.spec?.focalAssets || [];
      return (
        <section
          className="console-panel assets-panel"
          id="panel-assets"
          role="tabpanel"
          aria-labelledby="tab-assets"
          tabIndex={0}
        >
          {generated?.imageUrl ? (
            <>
              <div className="console-panel-heading">
                <span className="console-caption">
                  Concept art · Muse Image 1.0
                </span>
              </div>
              <img
                src={generated.imageUrl}
                alt={`Concept art for ${generated.title || "generated game"}`}
                style={{
                  width: "100%",
                  borderRadius: 6,
                  border: "1px solid #27272a",
                  marginBottom: 10,
                }}
              />
            </>
          ) : null}
          <div className="console-panel-heading">
            <span className="console-caption">
              {assets.length
                ? "Planned 3D objects · from game design"
                : "No spec yet — build a game first"}
            </span>
            <span className="asset-total">{assets.length} items</span>
          </div>
          <ul className="assets-grid">
            {assets.map((asset) => (
              <li className="asset-item" key={asset.id || asset.prompt}>
                <div className="asset-icon">
                  <Box aria-hidden="true" />
                </div>
                <div className="asset-copy">
                  <strong>{asset.prompt}</strong>
                  <span>
                    {asset.role} · {asset.category}
                  </span>
                </div>
                <span className="asset-size">
                  {(asset.scale || []).join("×")}
                </span>
              </li>
            ))}
          </ul>
          <div className="console-panel-heading" style={{ marginTop: 10 }}>
            <span className="console-caption">Stored games · VM library</span>
            <span className="asset-total">{library.length} games</span>
          </div>
          <ul className="assets-grid">
            {library.slice(0, 6).map((game) => (
              <li className="asset-item" key={game.id}>
                <div className="asset-icon">
                  <Play aria-hidden="true" />
                </div>
                <div className="asset-copy">
                  <strong>{game.title}</strong>
                  <span>
                    {game.biome} ·{" "}
                    {new Date(game.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  className="icon-text-button"
                  type="button"
                  onClick={() => playLibraryGame(game)}
                >
                  <span>Play</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    return (
      <section
        className="console-panel reasoning-panel"
        id="panel-reasoning"
        role="tabpanel"
        aria-labelledby="tab-reasoning"
        tabIndex={0}
      >
        <div className="console-panel-heading">
          <span className="console-caption">
            Live agent stream · VM backend
          </span>
          <span className="console-live">
            <span /> {backend.state}
          </span>
        </div>
        <div className="log-list" aria-label="Agent progress summaries">
          {logs.length === 0 ? (
            <div className="log-entry">
              <time>--:--:--</time>
              <span>
                Waiting for a run. Press Build Game to watch the agent work on
                the VM.
              </span>
            </div>
          ) : (
            logs.map((entry, index) => (
              <div
                className="log-entry"
                data-level={entry.level}
                key={`${entry.time}-${index}`}
              >
                <time>{entry.time}</time>
                <span>{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </section>
    );
  };

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
            href="https://threejs.org/docs/"
            target="_blank"
            rel="noreferrer"
          >
            Docs <ExternalLink aria-hidden="true" />
          </a>
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

      <div className="studio-workspace">
        <section className="workbench-pane" aria-labelledby="workbench-title">
          <div className="workbench-form">
            <div className="workbench-heading">
              <div>
                <h1 id="workbench-title">Prompt &amp; Architecture</h1>
                <p>Shape a playable world from a clear idea.</p>
              </div>
              <span className="illustrative-label">Live VM pipeline</span>
            </div>

            <label className="field-label" htmlFor="model-select">
              Pipeline
            </label>
            <div className="select-wrap model-select-wrap">
              <select
                id="model-select"
                className="control-select"
                value="live"
                disabled
              >
                <option value="live">
                  Muse Spark Open (Baseten) + Muse Code CLI (VM)
                </option>
              </select>
              <ChevronDown aria-hidden="true" />
            </div>

            <label className="field-label prompt-label" htmlFor="game-prompt">
              Game prompt
            </label>
            <textarea
              id="game-prompt"
              className={`prompt-textarea${promptError ? " has-error" : ""}`}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (event.target.value.trim()) setPromptError(false);
              }}
              onKeyDown={handlePromptKeyDown}
              placeholder="Describe the game rules, mechanics, physics, and world environment..."
              aria-invalid={promptError}
              aria-describedby={promptError ? "prompt-error" : "prompt-hint"}
              rows={3}
            />
            {promptError ? (
              <p id="prompt-error" className="field-error" role="alert">
                Enter a game idea to continue.
              </p>
            ) : (
              <p id="prompt-hint" className="sr-only">
                Describe the game rules, mechanics, physics, and world
                environment.
              </p>
            )}

            <div className="settings-grid">
              <label className="setting-field" htmlFor="engine-select">
                <span>Engine</span>
                <span className="select-wrap">
                  <select
                    id="engine-select"
                    className="control-select"
                    value={engine}
                    onChange={(event) => setEngine(event.target.value)}
                  >
                    <option>Three.js WebGL</option>
                    <option>Unity C#</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
              <label className="setting-field" htmlFor="controls-select">
                <span>Controls</span>
                <span className="select-wrap">
                  <select
                    id="controls-select"
                    className="control-select"
                    value={controls}
                    onChange={(event) => setControls(event.target.value)}
                  >
                    <option>Keyboard + Mobile Touch</option>
                    <option>Keyboard</option>
                    <option>Mobile Touch</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
              <label className="setting-field" htmlFor="complexity-select">
                <span>Complexity</span>
                <span className="select-wrap">
                  <select
                    id="complexity-select"
                    className="control-select"
                    value={complexity}
                    onChange={(event) => setComplexity(event.target.value)}
                  >
                    <option>Arcade</option>
                    <option>Simulation</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
            </div>

            <button
              className="button button-build"
              type="button"
              onClick={handleBuild}
              disabled={isBuilding}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              {isBuilding ? (
                <LoaderCircle className="spin-icon" aria-hidden="true" />
              ) : null}
              <span>{isBuilding ? "Agent running on VM…" : "Build Game"}</span>
              {!isBuilding ? <kbd>⌘ Enter</kbd> : null}
            </button>
            <p className="action-notice" role="status" aria-live="polite">
              {notice}
            </p>

            <div className="pipeline-heading">
              <span>Agent execution pipeline</span>
              <span className="pipeline-demo-label">live stream</span>
            </div>
            <ol
              className="pipeline-list"
              aria-label="Agent execution pipeline"
              aria-live="polite"
            >
              {PIPELINE.map((step) => {
                const stage = stages[step.id] || "pending";
                return (
                  <li className={`pipeline-step stage-${stage}`} key={step.id}>
                    <span className="step-indicator" aria-hidden="true">
                      {stage === "pass" || stage === "done" ? (
                        <Check />
                      ) : stage === "running" ? (
                        <LoaderCircle className="spin-icon" />
                      ) : (
                        <Circle />
                      )}
                    </span>
                    <div className="step-copy">
                      <span className="step-title">{step.title}</span>
                      {step.source ? (
                        <span className="step-source">{step.source}</span>
                      ) : null}
                    </div>
                    <span
                      className="step-status"
                      aria-label={`Status: ${stage}`}
                    >
                      {stage === "pass" || stage === "done"
                        ? "Done"
                        : stage === "running"
                          ? "Running"
                          : stage === "warn"
                            ? "Check"
                            : stage === "fail"
                              ? "Failed"
                              : "Pending"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="console-shell">
            <div
              className="console-tabs"
              role="tablist"
              aria-label="Project details"
            >
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  className={`console-tab${activeTab === id ? " is-active" : ""}`}
                  id={`tab-${id}`}
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={activeTab === id ? 0 : -1}
                  ref={(node) => {
                    tabRefs.current[id] = node;
                  }}
                  onClick={() => setActiveTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {renderTabPanel()}
          </div>
        </section>

        <section
          className="preview-pane"
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
                onClick={() => setResetRevision((revision) => revision + 1)}
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
                onClick={handleExport}
              >
                <Download aria-hidden="true" />
                <span>
                  {engine === "Unity C#" ? "Export Unity" : "Open WebGL"}
                </span>
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
        </section>
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
