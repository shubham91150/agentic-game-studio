"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import GameViewport from "./game-viewport.js";

export default function GamePlayer({ idea }) {
  const [isPaused, setIsPaused] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const [moveInput, setMoveInput] = useState({ x: 0, z: 0 });

  const pressHandlers = (vector) => ({
    onPointerDown: (event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setMoveInput(vector);
    },
    onPointerUp: () => setMoveInput({ x: 0, z: 0 }),
    onPointerCancel: () => setMoveInput({ x: 0, z: 0 }),
    onPointerLeave: () => setMoveInput({ x: 0, z: 0 }),
    onClick: (event) => {
      if (event.detail === 0) {
        setMoveInput(vector);
        window.setTimeout(() => setMoveInput({ x: 0, z: 0 }), 150);
      }
    },
  });

  return (
    <main className="game-player-shell">
      <header className="player-topbar">
        <Link className="player-brand" href="/">
          <span className="studio-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>Agentic Game Studio</span>
        </Link>
        <div className="player-top-actions">
          <span className="demo-badge">Demo build</span>
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
            aria-label={isPaused ? "Resume demo" : "Pause demo"}
            title={isPaused ? "Resume demo" : "Pause demo"}
            onClick={() => setIsPaused((paused) => !paused)}
          >
            {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          </button>
        </div>
      </header>

      <section className="player-main" aria-labelledby="player-title">
        <div className="player-heading">
          <div>
            <p className="dialog-kicker">Illustrative WebGL scene</p>
            <h1 id="player-title">Lunar rover course</h1>
            <p className="player-idea">{idea || "Explore a low-gravity course and collect signal beacons."}</p>
          </div>
          <span className="player-status"><span className="status-dot" />Touch controls ready</span>
        </div>

        <div className="player-viewport">
          <GameViewport
            isPlaying={!isPaused}
            resetRevision={resetRevision}
            moveInput={moveInput}
          />
        </div>

        <div className="player-controls-row">
          <div className="player-instructions">
            <strong>Move the rover</strong>
            <span>Use the controls or WASD / arrow keys. Drag the scene to orbit.</span>
          </div>
          <div className="touch-pad" aria-label="Rover movement controls">
            <button className="touch-key touch-up-left" type="button" aria-label="Move forward and left" {...pressHandlers({ x: -1, z: -1 })}>
              <ArrowUpLeft aria-hidden="true" />
            </button>
            <button className="touch-key touch-up" type="button" aria-label="Move forward" {...pressHandlers({ x: 0, z: -1 })}>
              <ArrowUp aria-hidden="true" />
            </button>
            <button className="touch-key touch-up-right" type="button" aria-label="Move forward and right" {...pressHandlers({ x: 1, z: -1 })}>
              <ArrowUpRight aria-hidden="true" />
            </button>
            <button className="touch-key touch-left" type="button" aria-label="Move left" {...pressHandlers({ x: -1, z: 0 })}>
              <ArrowLeft aria-hidden="true" />
            </button>
            <span className="touch-pad-center" aria-hidden="true" />
            <button className="touch-key touch-right" type="button" aria-label="Move right" {...pressHandlers({ x: 1, z: 0 })}>
              <ArrowRight aria-hidden="true" />
            </button>
            <span className="touch-pad-empty" aria-hidden="true" />
            <button className="touch-key touch-down" type="button" aria-label="Move backward" {...pressHandlers({ x: 0, z: 1 })}>
              <ArrowDown aria-hidden="true" />
            </button>
            <span className="touch-pad-empty" aria-hidden="true" />
          </div>
        </div>

        <p className="player-disclaimer">This is a local demo scene. It does not call Meta Muse, Modal, or SAM services.</p>
      </section>
    </main>
  );
}
