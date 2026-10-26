"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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

const DEFAULT_PROMPT =
  "Build a compact lunar rover challenge with low-gravity jumps, collectible signal beacons, and precise collision physics.";

const PIPELINE = [
  { title: "Architecture & Mechanics Plan", source: "Meta Muse Spark" },

  { title: "Physics & Collision Engine Assembly", source: "" },
  { title: "Playability & Performance Verification", source: "" },
];

const INITIAL_STAGES = ["done", "done", "running", "pending"];
const TABS = [
  { id: "reasoning", label: "Agent Reasoning", icon: Activity },
  { id: "code", label: "Generated Code", icon: FileCode2 },
  { id: "assets", label: "Assets", icon: Box },
];

const SAMPLE_ASSETS = [
  { name: "Rover chassis", kind: "3D mesh", size: "2.4 MB", polygons: "8.4k tris" },
  { name: "Signal beacon", kind: "3D mesh", size: "680 KB", polygons: "1.2k tris" },
  { name: "Moon terrain", kind: "Environment", size: "4.8 MB", polygons: "18.6k tris" },
  { name: "Surface rocks", kind: "3D mesh", size: "1.1 MB", polygons: "3.8k tris" },
];

const THREE_CODE = `import * as THREE from "three";

export function createLunarRoverScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#09090b");

  const camera = new THREE.PerspectiveCamera(
    46,
    container.clientWidth / container.clientHeight,
    0.1,
    120,
  );
  camera.position.set(10.5, 12.5, 17.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 26),
    new THREE.MeshStandardMaterial({ color: 0x383a3e, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const rover = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.8, 1.26),
    new THREE.MeshStandardMaterial({ color: 0x85888d, flatShading: true }),
  );
  rover.position.y = 0.55;
  rover.castShadow = true;
  scene.add(rover);

  scene.add(new THREE.HemisphereLight(0xd9dcdf, 0x282a2f, 1.8));
  const keyLight = new THREE.DirectionalLight(0xf2f2ee, 2.1);
  keyLight.position.set(-8, 17, 10);
  keyLight.castShadow = true;
  scene.add(keyLight);

  function render() {
    requestAnimationFrame(render);
    renderer.render(scene, camera);
  }
  render();

  return () => {
    renderer.dispose();
    container.replaceChildren();
  };
}`;

const UNITY_CODE = `using UnityEngine;

public class LunarRoverDemo : MonoBehaviour
{
    [SerializeField] private float moveSpeed = 4.1f;
    [SerializeField] private float turnSpeed = 120f;

    private void Update()
    {
        var forward = Input.GetAxis("Vertical");
        var turn = Input.GetAxis("Horizontal");
        transform.Translate(
            Vector3.forward * (forward * moveSpeed * Time.deltaTime)
        );
        transform.Rotate(
            Vector3.up,
            turn * turnSpeed * Time.deltaTime
        );
    }
}`;

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
  const [model, setModel] = useState("Meta Muse Spark 1.3");
  const [engine, setEngine] = useState("Three.js WebGL");
  const [controls, setControls] = useState("Keyboard + Mobile Touch");
  const [complexity, setComplexity] = useState("Arcade");
  const [stages, setStages] = useState(INITIAL_STAGES);
  const [activeTab, setActiveTab] = useState("reasoning");
  const [isBuilding, setIsBuilding] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const [stats, setStats] = useState({ fps: 60, drawCalls: 24, geometryMemoryMB: 42 });
  const [notice, setNotice] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logs, setLogs] = useState([
    {
      time: "12:04:12",
      text: "Prompt mapped to movement, environment, and objective constraints.",
    },
    {
      time: "12:04:13",
      text: "Illustrative demo trace. No live model or GPU service is connected.",
    },
  ]);

  const qrDialogRef = useRef(null);
  const templateDialogRef = useRef(null);
  const previewFrameRef = useRef(null);
  const activeRunRef = useRef(0);
  const tabRefs = useRef({});

  const currentCode = engine === "Unity C#" ? UNITY_CODE : THREE_CODE;

  const onStats = useCallback((nextStats) => {
    setStats((current) => ({ ...current, ...nextStats }));
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === previewFrameRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(
    () => () => {
      activeRunRef.current += 1;
    },
    [],
  );

  const addLog = (text) => {
    setLogs((current) => [
      ...current.slice(-5),
      { time: getTimeLabel(), text },
    ]);
  };

  const handleBuild = async () => {
    if (isBuilding) return;
    if (!prompt.trim()) {
      setPromptError(true);
      setNotice("Add a game idea before starting the demo build.");
      return;
    }

    const runId = activeRunRef.current + 1;
    activeRunRef.current = runId;
    setPromptError(false);
    setIsBuilding(true);
    setActiveTab("reasoning");
    setStages(PIPELINE.map(() => "pending"));
    setLogs([
      {
        time: getTimeLabel(),
        text: "Demo run started. Prompt accepted for a simulated pipeline.",
      },
    ]);
    setNotice("Running an illustrative build; no external model or GPU is called.");

    for (let index = 0; index < PIPELINE.length; index += 1) {
      if (activeRunRef.current !== runId) return;

      setStages(
        PIPELINE.map((_, stageIndex) =>
          stageIndex < index
            ? "done"
            : stageIndex === index
              ? "running"
              : "pending",
        ),
      );
      addLog(`${PIPELINE[index].title} started in the local demo pipeline.`);

      await new Promise((resolve) => window.setTimeout(resolve, 520));
      if (activeRunRef.current !== runId) return;

      setStages(
        PIPELINE.map((_, stageIndex) =>
          stageIndex <= index ? "done" : "pending",
        ),
      );
    }

    setIsBuilding(false);
    setNotice("Demo build complete. The 3D scene is an illustrative local preview.");
    addLog("Demo build complete. No Meta Muse, Modal, or SAM service was called.");
  };

  const handleNewProject = () => {
    activeRunRef.current += 1;
    setIsBuilding(false);
    setPrompt("");
    setModel("Meta Muse Spark 1.3");
    setEngine("Three.js WebGL");
    setControls("Keyboard + Mobile Touch");
    setComplexity("Arcade");
    setStages(PIPELINE.map(() => "pending"));
    setActiveTab("reasoning");
    setPromptError(false);
    setIsPaused(false);
    setResetRevision((revision) => revision + 1);
    setNotice("New demo project ready. Add an idea to start.");
    setLogs([
      {
        time: getTimeLabel(),
        text: "New project created. The demo workspace is ready for an idea.",
      },
    ]);
  };

  const makeShareUrl = () => {
    const url = new URL("/play", window.location.origin);
    if (prompt.trim()) url.searchParams.set("idea", prompt.trim());
    return url.toString();
  };

  const openQrDialog = () => {
    const nextUrl = makeShareUrl();
    setShareUrl(nextUrl);
    qrDialogRef.current?.showModal();
  };

  const handleCopyShareLink = async () => {
    try {
      await copyText(makeShareUrl());
      setNotice("Demo share link copied. It includes the current prompt text.");
    } catch {
      setNotice("Could not copy the link. Check clipboard permissions and try again.");
    }
  };

  const handleCopyCode = async () => {
    try {
      await copyText(currentCode);
      setNotice("Code copied to the clipboard.");
    } catch {
      setNotice("Could not copy code. Check clipboard permissions and try again.");
    }
  };

  const handleDownloadCode = () => {
    const isUnity = engine === "Unity C#";
    downloadText(
      isUnity ? "lunar-rover-demo.cs" : "lunar-rover-demo.js",
      currentCode,
      isUnity ? "text/plain" : "text/javascript",
    );
    setNotice("Illustrative scene code downloaded.");
  };

  const handleExport = () => {
    handleDownloadCode();
    setNotice(
      engine === "Unity C#"
        ? "Unity C# demo script downloaded. It is an illustrative scaffold."
        : "Three.js WebGL demo module downloaded. It is an illustrative scaffold.",
    );
  };

  const handleFullscreen = async () => {
    const frame = previewFrameRef.current;
    if (!frame) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await frame.requestFullscreen();
      }
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  };

  const selectTemplate = (nextPrompt) => {
    activeRunRef.current += 1;
    setIsBuilding(false);
    setPrompt(nextPrompt);
    setPromptError(false);
    setStages(INITIAL_STAGES);
    setNotice("Template loaded. Review the prompt, then start a demo build.");
    templateDialogRef.current?.close();
  };

  const handleTabKeyDown = (event, currentTab) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    }
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
            <span className="console-caption">Illustrative {engine} scaffold</span>
            <div className="console-actions">
              <button className="icon-text-button" type="button" onClick={handleCopyCode}>
                <Copy aria-hidden="true" />
                <span>Copy</span>
              </button>
              <button className="icon-text-button" type="button" onClick={handleDownloadCode}>
                <Download aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          </div>
          <pre className="code-block"><code>{currentCode}</code></pre>
        </section>
      );
    }

    if (activeTab === "assets") {
      return (
        <section
          className="console-panel assets-panel"
          id="panel-assets"
          role="tabpanel"
          aria-labelledby="tab-assets"
          tabIndex={0}
        >
          <div className="console-panel-heading">
            <span className="console-caption">Example assets · illustrative metadata</span>
            <span className="asset-total">{SAMPLE_ASSETS.length} items</span>
          </div>
          <ul className="assets-grid">
            {SAMPLE_ASSETS.map((asset) => (
              <li className="asset-item" key={asset.name}>
                <div className="asset-icon"><Box aria-hidden="true" /></div>
                <div className="asset-copy">
                  <strong>{asset.name}</strong>
                  <span>{asset.kind} · {asset.polygons}</span>
                </div>
                <span className="asset-size">{asset.size}</span>
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
          <span className="console-caption">Progress summaries · demo trace</span>
          <span className="console-live"><span /> Local</span>
        </div>
        <div className="log-list" aria-label="Agent progress summaries">
          {logs.map((entry, index) => (
            <div className="log-entry" key={`${entry.time}-${index}`}>
              <time>{entry.time}</time>
              <span>{entry.text}</span>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="studio-mark" aria-hidden="true"><span /><span /><span /></div>
          <span className="brand-name">Agentic Game Studio</span>
          <span className="brand-badge">Meta Hackathon</span>
          <span className="demo-badge">Demo</span>
        </div>

        <nav className="topbar-actions" aria-label="Main navigation">
          <button
            className="topbar-link topbar-template"
            type="button"
            onClick={() => templateDialogRef.current?.showModal()}
          >
            Templates
          </button>
          <a className="topbar-link" href="https://threejs.org/docs/" target="_blank" rel="noreferrer">
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
          <button className="button button-primary button-new-project" type="button" onClick={handleNewProject}>
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
              <span className="illustrative-label">Demo workspace</span>
            </div>

            <label className="field-label" htmlFor="model-select">Model</label>
            <div className="select-wrap model-select-wrap">
              <select
                id="model-select"
                className="control-select"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                <option>Meta Muse Spark 1.3</option>
                <option>Muse Code 1.0</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </div>

            <label className="field-label prompt-label" htmlFor="game-prompt">Game prompt</label>
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
              <p id="prompt-error" className="field-error" role="alert">Enter a game idea to continue.</p>
            ) : (
              <p id="prompt-hint" className="sr-only">Describe the game rules, mechanics, physics, and world environment.</p>
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
              {isBuilding ? <LoaderCircle className="spin-icon" aria-hidden="true" /> : null}
              <span>{isBuilding ? "Building demo…" : "Build Game"}</span>
              {!isBuilding ? <kbd>⌘ Enter</kbd> : null}
            </button>
            <p className="action-notice" role="status" aria-live="polite">{notice}</p>

            <div className="pipeline-heading">
              <span>Agent execution pipeline</span>
              <span className="pipeline-demo-label">Illustrative demo run</span>
            </div>
            <ol className="pipeline-list" aria-label="Illustrative agent execution pipeline" aria-live="polite">
              {PIPELINE.map((step, index) => {
                const stage = stages[index];
                return (
                  <li className={`pipeline-step stage-${stage}`} key={step.title}>
                    <span className="step-indicator" aria-hidden="true">
                      {stage === "done" ? <Check /> : stage === "running" ? <LoaderCircle className="spin-icon" /> : <Circle />}
                    </span>
                    <div className="step-copy">
                      <span className="step-title">{step.title}</span>
                      {step.source ? <span className="step-source">{step.source}</span> : null}
                    </div>
                    <span className="step-status" aria-label={`Status: ${stage}`}>
                      {stage === "done" ? "Done" : stage === "running" ? "Running" : "Pending"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="console-shell">
            <div className="console-tabs" role="tablist" aria-label="Project details">
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
                  ref={(node) => { tabRefs.current[id] = node; }}
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

        <section className="preview-pane" aria-labelledby="preview-title" ref={previewFrameRef}>
          <div className="preview-header">
            <div className="preview-title-group">
              <h2 id="preview-title">Project Preview</h2>
              <span className="fps-pill"><span className="status-dot" />{stats.fps} FPS</span>
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
                {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={handleFullscreen}
              >
                {isFullscreen ? <X aria-hidden="true" /> : <Expand aria-hidden="true" />}
              </button>
              <button className="button button-secondary mobile-qr-button" type="button" onClick={openQrDialog}>
                <Smartphone aria-hidden="true" />
                <span>Mobile QR</span>
              </button>
            </div>
          </div>

          <div className="preview-stage">
            <GameViewport isPlaying={!isPaused} resetRevision={resetRevision} onStats={onStats} />
            <div className="viewport-hint" aria-hidden="true">Drag to orbit · WASD to move</div>
          </div>

          <div className="preview-footer">
            <div className="telemetry-list" aria-label="Illustrative demo telemetry">
              <div className="telemetry-item resolution-item">
                <span>Resolution</span>
                <strong>1920 × 1080</strong>
              </div>
              <div className="telemetry-item">
                <span>Draw Calls</span>
                <strong>{stats.drawCalls}</strong>
              </div>
              <div className="telemetry-item">
                <span>Memory · demo</span>
                <strong>42 MB</strong>
              </div>
            </div>
            <div className="footer-actions">
              <button className="button button-footer" type="button" onClick={handleExport}>
                <Download aria-hidden="true" />
                <span>{engine === "Unity C#" ? "Export Unity" : "Export WebGL"}</span>
              </button>
              <button className="button button-footer" type="button" onClick={handleCopyShareLink}>
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
          <button className="icon-button" type="button" aria-label="Close templates" onClick={() => templateDialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="template-list">
          {TEMPLATES.map((template) => (
            <button className="template-option" type="button" key={template.title} onClick={() => selectTemplate(template.prompt)}>
              <span className="template-icon"><Terminal aria-hidden="true" /></span>
              <span className="template-copy">
                <strong>{template.title}</strong>
                <span>{template.description}</span>
              </span>
              <span className="template-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <p className="dialog-note">Templates are illustrative starting points for this local prototype.</p>
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
            <h2 id="qr-title">Open the demo player</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close QR dialog" onClick={() => qrDialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="qr-code-wrap">
          {shareUrl ? <QRCodeSVG value={shareUrl} size={208} bgColor="#f4f4f5" fgColor="#09090b" includeMargin /> : null}
        </div>
        <p className="qr-description">Scan to open the interactive demo scene with touch controls.</p>
        <p className="dialog-note">The link includes the current prompt text. The rover scene is an illustrative local demo, not a generated build.</p>
        <button className="button button-primary dialog-copy-button" type="button" onClick={handleCopyShareLink}>
          <Copy aria-hidden="true" />
          Copy demo link
        </button>
      </dialog>

    </main>
  );
}
