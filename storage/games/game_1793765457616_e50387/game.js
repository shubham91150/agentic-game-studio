/* Ashes of St. Vermilion — boot, fixed-step loop, states (Stage 1+2+3).
 * States: menu -> playing <-> paused -> stageclear | gameover. ESC/P pause.
 * Restart resets run state (pos, torch, crouch, key, door, timer, HUD,
 * trauma, enemy, beats) and never reloads the page. E near the key
 * (<=1.6m, Classroom B) unlocks the chapel door; E at the door (<=2.2m)
 * with the key clears the stage; Agatha catching the player (<=0.8m)
 * plays a 2s jumpscare beat, then the gameover screen.
 * Renderer: ACES tone mapping + sRGB + PCFSoft shadows.
 * Quality: Low (shadows off, pixelRatio<=1) / Med (<=1.5) / High (<=2),
 * with auto step-down when fps<45 for 3s. ?debug=1 overlay + window.game.
 * r128 global THREE. No module syntax. No per-frame allocations.
 * HN2: EffectComposer chain (Render + UnrealBloom 0.55/0.45/0.72 +
 * teal-indigo/warm grade + vignette) on Med/High, direct render on Low;
 * hide/search interactions via guarded sibling spots + player hide API.
 */
(function () {
  "use strict";

  var FIXED = 1 / 60;
  var MAX_STEPS = 3;
  var CLAMP_DT = 0.05;
  var KEY_RADIUS = 1.6;
  var DOOR_RADIUS = 2.2;
  var AUTO_FPS = 45;
  var AUTO_SECS = 3;
  /* HN2: hide/search touch radius + corner rooms for the search
   * distraction (keys/coords mirror enemy.js ROOM_CENTERS; each room is
   * the closest named room to one map corner). */
  var HIDE_RADIUS = 1.6;
  var CORNER_ROOMS = [
    { room: "classroom a", x: -5, z: -2 },
    { room: "classroom b", x: 5, z: -2 },
    { room: "west store", x: -8, z: 7 },
    { room: "east store", x: 8, z: 7 },
  ];

  var DEBUG = false;
  try {
    DEBUG = /[?&]debug=1\b/.test(window.location.search);
  } catch (err) {
    DEBUG = false;
  }

  var Story = window.StV_Story || {
    TITLE: "ASHES OF ST. VERMILION",
    INTRO: [],
    OBJECTIVES: [""],
  };
  var Save = window.StV_Save || null;
  var settings = {
    volume: 0.8,
    quality: "High",
    sensitivity: 1.0,
    mute: false,
    bestMs: null,
    difficulty: "Normal",
    bestSurvivalMs: null,
  };
  if (Save) {
    try {
      settings = Save.load();
    } catch (err) {
      /* defaults stand */
    }
  }
  /* Stage 2+3: older saves predate these keys. */
  if (
    settings.difficulty !== "Easy" &&
    settings.difficulty !== "Normal" &&
    settings.difficulty !== "Hard"
  ) {
    settings.difficulty = "Normal";
  }
  if (typeof settings.bestSurvivalMs !== "number") {
    settings.bestSurvivalMs = null;
  }

  function persist() {
    if (!Save) return;
    try {
      settings = Save.save(settings);
    } catch (err) {
      /* session-only */
    }
  }

  var state = "menu";
  var renderer = null;
  var scene = null;
  var camera = null;
  var world = null;
  var player = null;
  var enemy = null;
  var vfx = null;
  var UI = window.StV_UI || null;
  var Audio8 = window.StV_Audio || null;
  /* HN2 post chain: null until buildPost() succeeds; every consumer
   * treats null as "direct renderer.render", so a missing/broken pass
   * can never crash the frame loop. */
  var composer = null;
  var bloomPass = null;

  /* Stage 2+3 run state: door lock, jumpscare, horror-beat flags. */
  var doorLocked = true;
  var jumpscare = false;
  var jumpscareT = 0;
  var b1fired = false;
  var b2fired = false;
  var b3fired = false;
  var b4fired = false;
  var wasInB = false;
  var alertTick = 0;
  /* Stage 2+3: single 4Hz enemy sample shared by HUD + debug overlay,
   * so both always show the same state/dist from one timestamp. */
  var esCache = { state: "PATROL", suspicion: 0, dist: 99, alert01: 0.15 };
  var psState = {
    x: 0,
    z: 8.5,
    noise: 0,
    torchOn: true,
    crouch: false,
    keyHeld: false,
    inClassB: false,
    hidden: false,
  };

  var colliders = [];
  var bounds = { x0: -12, z0: -9, x1: 12, z1: 9 };
  var spawn = { x: 0, z: 8.5, ry: 0 };
  var keyFound = false;
  var aiLastPoll = 0;
  var aiPollBusy = false;
  var aiKeyFlip = false;
  var timerMs = 0;
  var elapsed = 0;
  var keys = {};
  var lockEl = null;
  var container = null;

  var tmpV = null;
  var frames = 0;
  var fpsWindow = 0;
  var fpsShown = 60;
  var lowTime = 0;
  var dbgEl = null;
  var started = false;

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (err) {
      return null;
    }
  }

  function toast(txt) {
    if (UI && UI.toast) {
      try {
        UI.toast(txt);
      } catch (err) {
        /* x */
      }
    }
  }

  function normQuality(q) {
    var s = String(q || "").toLowerCase();
    if (s === "low") return "Low";
    if (s === "med" || s === "medium") return "Med";
    return "High";
  }

  function applyQuality(q) {
    settings.quality = normQuality(q);
    if (!renderer) return;
    var dpr = 1;
    try {
      dpr = window.devicePixelRatio || 1;
    } catch (err) {
      dpr = 1;
    }
    var cap =
      settings.quality === "Low" ? 1 : settings.quality === "Med" ? 1.5 : 2;
    try {
      renderer.setPixelRatio(Math.min(dpr, cap));
    } catch (err) {
      /* x */
    }
    /* HN2: keep composer buffers on the same pixel ratio (quality
     * toggles change it), and lazily build the chain if quality rose
     * from a composer-less Low boot. */
    try {
      if (composer && composer.setPixelRatio && renderer.getPixelRatio) {
        composer.setPixelRatio(renderer.getPixelRatio());
      }
    } catch (err) {
      /* x */
    }
    try {
      if (!composer && postWanted()) buildPost();
    } catch (err) {
      /* direct render stands */
    }
    var wantShadow = settings.quality !== "Low";
    try {
      if (renderer.shadowMap.enabled !== wantShadow) {
        renderer.shadowMap.enabled = wantShadow;
        scene.traverse(function (o) {
          if (o && o.material) {
            if (o.material.needsUpdate !== undefined)
              o.material.needsUpdate = true;
          }
          if (o && o.isSpotLight) o.castShadow = wantShadow;
        });
      }
    } catch (err) {
      /* x */
    }
    onResize();
  }

  function stepQualityDown() {
    if (settings.quality === "High") return "Med";
    if (settings.quality === "Med") return "Low";
    return "Low";
  }

  function onResize() {
    if (!renderer || !camera || !container) return;
    var w = 1;
    var hgt = 1;
    try {
      w = container.clientWidth || window.innerWidth || 1;
      hgt = container.clientHeight || window.innerHeight || 1;
    } catch (err) {
      /* keep 1x1 */
    }
    try {
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      renderer.setSize(w, hgt);
      pausedRendered = false;
    } catch (err) {
      /* x */
    }
    /* HN2: composer buffers + bloom mips follow the canvas (composer
     * propagates to passes itself; the explicit bloom call pins the
     * same effective size). */
    try {
      if (composer && composer.setSize) {
        var pr = 1;
        try {
          pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        } catch (e2) {
          pr = 1;
        }
        composer.setSize(w, hgt);
        if (bloomPass && bloomPass.setSize) {
          bloomPass.setSize(Math.round(w * pr), Math.round(hgt * pr));
        }
      }
    } catch (err) {
      /* direct render unaffected */
    }
  }

  /* HN2 post chain: EffectComposer(RenderPass + UnrealBloomPass +
   * grade ShaderPass). Grade = teal-indigo shadow lift + warm golden
   * highlight gain + soft 0.32 vignette. The encodings include keeps
   * sRGB output identical to the direct path; tone mapping is NOT
   * repeated here (r128 applies ACES inside RenderPass already). */
  var GRADE_VERT = [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix *",
    "    vec4(position, 1.0);",
    "}",
  ].join("\n");

  var GRADE_FRAG = [
    "uniform sampler2D tDiffuse;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 tex = texture2D(tDiffuse, vUv);",
    "  vec3 col = tex.rgb;",
    "  float luma = dot(col, vec3(0.299, 0.587, 0.114));",
    "  float shadowM = 1.0 - smoothstep(0.0, 0.45, luma);",
    "  col += vec3(0.0392, 0.1020, 0.1412) * (shadowM * 0.55);",
    "  float hiM = smoothstep(0.45, 1.0, luma);",
    "  col *= mix(vec3(1.0), vec3(1.0, 0.8510, 0.6275), hiM * 0.45);",
    "  vec2 dc = vUv - vec2(0.5);",
    "  float vig = 1.0 - smoothstep(0.35, 0.85, length(dc));",
    "  col *= mix(0.68, 1.0, vig);",
    "  gl_FragColor = vec4(col, tex.a);",
    "  #include <encodings_fragment>",
    "}",
  ].join("\n");

  function postWanted() {
    try {
      return String(settings.quality || "").toLowerCase() !== "low";
    } catch (err) {
      return true;
    }
  }

  function buildPost() {
    if (composer || !postWanted()) return;
    try {
      if (!renderer || !scene || !camera) return;
      var T = window.THREE || {};
      if (typeof T.EffectComposer !== "function") return;
      if (typeof T.RenderPass !== "function") return;
      if (typeof T.UnrealBloomPass !== "function") return;
      if (typeof T.ShaderPass !== "function") return;
      var w = 1;
      var hgt = 1;
      try {
        w = container.clientWidth || window.innerWidth || 1;
        hgt = container.clientHeight || window.innerHeight || 1;
      } catch (err) {
        /* 1x1; onResize corrects */
      }
      var comp = new T.EffectComposer(renderer);
      comp.addPass(new T.RenderPass(scene, camera));
      var bloom = new T.UnrealBloomPass(
        new T.Vector2(w, hgt),
        0.55,
        0.45,
        0.72,
      );
      comp.addPass(bloom);
      comp.addPass(
        new T.ShaderPass({
          uniforms: { tDiffuse: { value: null } },
          vertexShader: GRADE_VERT,
          fragmentShader: GRADE_FRAG,
        }),
      );
      comp.setSize(w, hgt);
      composer = comp;
      bloomPass = bloom;
    } catch (err) {
      composer = null;
      bloomPass = null;
    }
  }

  /* HN2: single render entry — composer on Med/High, direct fallback
   * on Low or after any post failure (fail-safe, never throws). */
  function renderFrame() {
    if (composer && postWanted()) {
      try {
        composer.render();
        return;
      } catch (err) {
        composer = null;
        bloomPass = null;
      }
    }
    renderer.render(scene, camera);
  }

  function requestLock() {
    if (!lockEl) return;
    try {
      if (document.pointerLockElement === lockEl) return;
      var p = lockEl.requestPointerLock && lockEl.requestPointerLock();
      if (p && p.catch)
        p.catch(function () {
          /* drag-look fallback */
        });
    } catch (err) {
      /* drag-look fallback keeps game playable */
    }
  }

  function exitLock() {
    try {
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch (err) {
      /* x */
    }
  }

  function setAudioDim(d) {
    if (Audio8 && Audio8.setDimmed) {
      try {
        Audio8.setDimmed(d);
      } catch (err) {
        /* x */
      }
    }
  }

  function show(name) {
    try {
      if (document && document.body && document.body.classList) {
        document.body.classList.toggle("playing", name === "playing");
        document.body.classList.add("touch");
      }
    } catch (e0) {}
    if (UI && UI.show) {
      try {
        UI.show(name);
      } catch (err) {
        /* x */
      }
    }
  }

  /* Stage 2+3 helper: jumpscare red-vignette overlay on/off. */
  function setJumpscare(on) {
    try {
      var el = $("jumpscare");
      if (!el) return;
      if (on) el.classList.add("on");
      else el.classList.remove("on");
    } catch (err) {
      /* x */
    }
  }

  /* Stage 2+3 helper: chapel-door lock tint (slit glows amber unlocked).
   * levels.js untouched: the slit is found by material, game-side. */
  function tintDoor(unlocked) {
    doorLocked = !unlocked;
    if (!world || !world.chapelDoor) return;
    try {
      world.chapelDoor.userData.locked = !unlocked;
      world.chapelDoor.traverse(function (o) {
        if (o && o.material && o.material.isMeshBasicMaterial) {
          o.material.color.setHex(unlocked ? 0xffc06a : 0x7a9fc0);
        }
      });
    } catch (err) {
      /* x */
    }
  }

  /* Stage 2+3 helper: Classroom B footprint (east room). */
  function inClassB(x, z) {
    return x > 1 && x < 9 && z > -6 && z < 2;
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var mins = Math.floor(s / 60);
    var secs = s % 60;
    return (
      (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs
    );
  }

  /* Stage 2+3 helper: best survival persists on clear AND gameover. */
  function persistSurvival() {
    if (
      settings.bestSurvivalMs === null ||
      timerMs > settings.bestSurvivalMs
    ) {
      settings.bestSurvivalMs = Math.round(timerMs);
      persist();
    }
  }

  function pickGameOverLine() {
    try {
      var lines = Story.GAMEOVER;
      if (lines && lines.length) {
        return lines[Math.floor(timerMs / 1000) % lines.length];
      }
    } catch (err) {
      /* x */
    }
    return "";
  }

  function resetRun() {
    timerMs = 0;
    keyFound = false;
    /* HN2: search spots reset to unsearched with the rest of run state. */
    try {
      var sa = window.__stvSearchSpots;
      if (sa && sa.length) {
        for (var si = 0; si < sa.length; si++) {
          try {
            sa[si].searched = false;
          } catch (e2) {
            /* x */
          }
        }
      }
    } catch (err) {
      /* x */
    }
    psState.hidden = false;
    lowTime = 0;
    keys = {};
    alertTick = 0;
    jumpscare = false;
    jumpscareT = 0;
    esCache.state = "PATROL";
    esCache.suspicion = 0;
    esCache.dist = 99;
    esCache.alert01 = 0.15;
    b1fired = false;
    b2fired = false;
    b3fired = false;
    b4fired = false;
    wasInB = false;
    setJumpscare(false);
    playerHP = 100;
    playerHurtCd = 0;
    zombieKills = 0;
    WEAPONS[0].mag = 30; WEAPONS[0].reserve = 120;
    WEAPONS[1].mag = 8;  WEAPONS[1].reserve = 40;
    WEAPONS[2].mag = 5;  WEAPONS[2].reserve = 20;
    reloadTimer = 0;
    fireCd = 0;
    initZombieHorde();
    updateShooterHUD();
    try {
      if (window.speechSynthesis && window.speechSynthesis.cancel) {
        window.speechSynthesis.cancel();
      }
    } catch (err) {
      /* x */
    }
    if (player) {
      player.reset(spawn.x, spawn.z, spawn.ry || 0);
      player.setTorch(true);
      player.setCrouch(false);
      /* HN2: a restart never strands the player inside a cabinet. */
      try {
        if (typeof player.isHidden === "function" && player.isHidden()) {
          if (typeof player.exitHide === "function") player.exitHide();
        }
      } catch (err) {
        /* x */
      }
    }
    if (enemy) {
      try {
        enemy.reset();
      } catch (err) {
        /* x */
      }
    }
    if (vfx && vfx.reset) {
      try {
        vfx.reset();
      } catch (err) {
        /* x */
      }
    }
    if (world && world.keyMesh) {
      try {
        world.keyMesh.visible = true;
      } catch (err) {
        /* x */
      }
    }
    if (world && world.chapelDoor) {
      try {
        world.chapelDoor.rotation.y = 0;
      } catch (err) {
        /* x */
      }
    }
    tintDoor(false);
    if (Audio8 && Audio8.setAlert01) {
      try {
        Audio8.setAlert01(0.15);
      } catch (err) {
        /* x */
      }
    }
    if (UI) {
      try {
        if (UI.setKey) UI.setKey(false);
        if (UI.setObjective) UI.setObjective(Story.OBJECTIVES[0] || "");
        if (UI.setNoise) UI.setNoise(0);
        if (UI.setEnemy) UI.setEnemy("PATROL", 99);
        if (UI.banner) UI.banner(null);
      } catch (err) {
        /* x */
      }
    }
  }

  function startGame() {
    if (state !== "menu") return;
    loopPaused = false;
    pausedRendered = false;
    if (Audio8) {
      try {
        Audio8.init();
      } catch (err) {
        /* x */
      }
      try {
        Audio8.ambientStart();
      } catch (err) {
        /* x */
      }
      if (Audio8.resumeAll && !settings.mute) {
        try {
          Audio8.resumeAll();
        } catch (err) {
          /* x */
        }
      }
    }
    setAudioDim(false);
    resetRun();
    state = "playing";
    if (player) player.setEnabled(true);
    show("playing");
    requestLock();
    if (UI && UI.banner) {
      try {
        UI.banner(Story.OBJECTIVES[0] || "", 5000);
      } catch (err) {
        /* x */
      }
    }
  }

  function pauseGame() {
    loopPaused = true;
    if (state === "playing") {
      state = "paused";
      if (player) player.setEnabled(false);
      show("paused");
      exitLock();
    }
    setAudioDim(true);
    if (Audio8 && Audio8.suspendAll) {
      try {
        Audio8.suspendAll();
      } catch (err) {
        /* x */
      }
    }
  }

  function resumeGame() {
    if (state !== "paused") return;
    loopPaused = false;
    pausedRendered = false;
    state = "playing";
    setAudioDim(false);
    if (Audio8 && Audio8.resumeAll && !settings.mute) {
      try {
        Audio8.resumeAll();
      } catch (err) {
        /* x */
      }
    }
    if (player) player.setEnabled(true);
    show("playing");
    requestLock();
  }

  function restartGame() {
    if (state !== "paused" && state !== "stageclear" && state !== "gameover")
      return;
    loopPaused = false;
    pausedRendered = false;
    if (Audio8) {
      try {
        Audio8.init();
      } catch (err) {
        /* x */
      }
      if (Audio8.resumeAll && !settings.mute) {
        try {
          Audio8.resumeAll();
        } catch (err) {
          /* x */
        }
      }
    }
    setAudioDim(false);
    resetRun();
    state = "playing";
    if (player) player.setEnabled(true);
    show("playing");
    requestLock();
  }

  function syncTouchBtn() {
    try {
      var tb = $("btn-torch");
      if (tb && player && player.isTorchOn) {
        if (player.isTorchOn()) tb.classList.add("on");
        else tb.classList.remove("on");
      }
      var cb = $("btn-crouch");
      if (cb && player && player.isCrouch) {
        if (player.isCrouch()) cb.classList.add("on");
        else cb.classList.remove("on");
      }
    } catch (err) {
      /* x */
    }
  }

  var lastPrompt = null;
  function updatePrompt() {
    var txt = null;
    if (state === "playing" && player && tmpV) {
      var pp = player.pos();
      /* HN2: hidden wins (only exit is available); key/door keep their
       * existing priority so a cabinet radius can never swallow the
       * stage-critical pickup, then hide, then unsearched search. */
      if (isHiddenNow()) {
        txt = "E \u2014 Step out";
        try {
          if (UI && UI.showHideCrack) UI.showHideCrack(true);
        } catch (err) { /* x */ }
      } else {
        try {
          if (UI && UI.showHideCrack) UI.showHideCrack(false);
        } catch (err) { /* x */ }
        var kp = keyPos(tmpV);
        if (!keyFound && kp && distXZ(pp.x, pp.z, kp.x, kp.z) <= KEY_RADIUS) {
          txt = "E \u2014 Chapel Key";
        } else {
          var dp = doorPos(tmpV);
          if (dp && distXZ(pp.x, pp.z, dp.x, dp.z) <= DOOR_RADIUS) {
            txt =
              keyFound && !doorLocked
                ? "E \u2014 Chapel Door (khol do!)"
                : "E \u2014 Chapel Door (locked)";
          } else {
            var hsNear = nearSpot(hideSpots(), pp.x, pp.z, HIDE_RADIUS);
            if (hsNear) {
              txt = "E \u2014 Hide inside Gothic Cabinet";
            } else {
              var ssNear = nearSpot(searchSpots(), pp.x, pp.z, HIDE_RADIUS);
              if (ssNear && !ssNear.searched) {
                txt = "E \u2014 Search Cabinet";
              } else if (distXZ(pp.x, pp.z, CLOCK_LURE.x, CLOCK_LURE.z) <= 1.8 &&
                  Date.now() >= clockCdUntil) {
                txt = "E \u2014 Ring the Grandfather Clock";
              }
            }
          }
        }
      }
    }
    if (txt !== lastPrompt) {
      lastPrompt = txt;
      if (UI && UI.setPrompt) {
        try {
          UI.setPrompt(txt);
        } catch (err) {
          /* x */
        }
      }
    }
  }

  function quitToMenu() {
    if (state !== "paused" && state !== "stageclear" && state !== "gameover")
      return;
    state = "menu";
    setAudioDim(true);
    if (Audio8 && Audio8.suspendAll) {
      try {
        Audio8.suspendAll();
      } catch (err) {
        /* x */
      }
    }
    if (player) {
      player.setEnabled(false);
      player.reset(spawn.x, spawn.z, spawn.ry || 0);
    }
    /* Stage 2+3: Agatha parks at spawn, jumpscare overlay clears. */
    jumpscare = false;
    jumpscareT = 0;
    setJumpscare(false);
    if (enemy) {
      try {
        enemy.reset();
      } catch (err) {
        /* x */
      }
    }
    show("menu");
    exitLock();
  }

  function fmtTime(ms) {
    var t = Math.max(0, Math.round(ms / 100));
    var tenths = t % 10;
    var s = Math.floor(t / 10);
    var secs = s % 60;
    var mins = Math.floor(s / 60);
    return mins + ":" + (secs < 10 ? "0" : "") + secs + "." + tenths;
  }

  /* Stage 2+3: Agatha's onCaught lands here — 2s jumpscare beat,
   * then the gameover screen. */
  function handleCaught() {
    if (state !== "playing" || jumpscare) return;
    if (typeof hurtPlayer === "function") {
      if (hurtPlayer(28, "ALPHA BLOODFANG SLASH!")) return;
    }
    jumpscare = true;
    jumpscareT = 0;
    if (player) player.setEnabled(false);
    if (vfx) {
      try {
        vfx.addTrauma(1);
      } catch (err) {
        /* x */
      }
    }
    if (Audio8 && Audio8.queueWhisper) {
      try {
        Audio8.queueWhisper("chase");
      } catch (err) {
        /* x */
      }
    }
    setJumpscare(true);
    if (UI && UI.setEnemy) {
      try {
        UI.setEnemy("CAUGHT", 0);
      } catch (err) {
        /* x */
      }
    }
  }

  function enterGameOver() {
    if (state !== "playing") return;
    state = "gameover";
    jumpscare = false;
    setJumpscare(false);
    /* Dim only (no suspend): the caught-whisper finishes over the screen. */
    setAudioDim(true);
    if (player) player.setEnabled(false);
    exitLock();
    persistSurvival();
    if (UI) {
      try {
        if (UI.setGameOverStats) {
          UI.setGameOverStats(
            "Survived " +
              fmtClock(timerMs) +
              " · " +
              (settings.difficulty || "Normal"),
            pickGameOverLine(),
          );
        }
      } catch (err) {
        /* x */
      }
    }
    show("gameover");
  }

  function clearStage() {
    if (state !== "playing") return;
    state = "stageclear";
    setAudioDim(true);
    if (Audio8 && Audio8.suspendAll) {
      try {
        Audio8.suspendAll();
      } catch (err) {
        /* x */
      }
    }
    if (player) player.setEnabled(false);
    exitLock();
    persistSurvival();
    var isBest = false;
    if (settings.bestMs === null || timerMs < settings.bestMs) {
      settings.bestMs = Math.round(timerMs);
      isBest = true;
      persist();
    }
    if (UI) {
      try {
        if (UI.setClearStats) {
          UI.setClearStats(
            "TIME  " + fmtTime(timerMs),
            "BEST  " + fmtTime(settings.bestMs),
            isBest,
          );
        }
      } catch (err) {
        /* x */
      }
    }
    show("stageclear");
  }

  /* HN2 hide/search helpers: sibling levels.js exports
   * window.__stvHideSpots=[{x,z,ry,name}] and window.__stvSearchSpots=
   * [{x,z,name}]; sibling player.js adds enterHide/exitHide/isHidden.
   * Everything here is guarded — the game plays identically when any
   * of it is absent. */
  function hideSpots() {
    try {
      var a = window.__stvHideSpots;
      return a && a.length ? a : null;
    } catch (err) {
      return null;
    }
  }

  function searchSpots() {
    try {
      var a = window.__stvSearchSpots;
      return a && a.length ? a : null;
    } catch (err) {
      return null;
    }
  }

  function isHiddenNow() {
    try {
      return !!(player && player.isHidden && player.isHidden());
    } catch (err) {
      return false;
    }
  }

  function nearSpot(list, px, pz, r) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || typeof s.x !== "number" || typeof s.z !== "number") continue;
      if (distXZ(px, pz, s.x, s.z) <= r) return s;
    }
    return null;
  }

  /* HN2: farthest named corner room from (px,pz) — the search
   * distraction target. Keys match enemy.js ROOM_CENTERS (lowercase);
   * unknown rooms are a safe no-op inside applyDirectorOrder. */
  function farthestCornerRoom(px, pz) {
    var best = "north corridor";
    var bd = -1;
    try {
      for (var i = 0; i < CORNER_ROOMS.length; i++) {
        var c = CORNER_ROOMS[i];
        var dx = px - c.x;
        var dz = pz - c.z;
        var d = dx * dx + dz * dz;
        if (d > bd) {
          bd = d;
          best = c.room;
        }
      }
    } catch (err) {
      /* default stands */
    }
    return best;
  }

  /* HN2 search: one-time per spot; marks the spot, toasts the clue,
   * and sends Agatha to inspect the farthest corner room. */
  /* Goosebump clockwork lure: the grandfather clock at (-3.65, 6.5)
   * (levels.js U_CLOCK spot) rings on E and pulls Agatha to the
   * Entrance Hall to investigate — 30s cooldown vs lure spam. */
  var CLOCK_LURE = { x: -3.65, z: 6.5 };
  var clockCdUntil = 0;
  function doClockLure() {
    clockCdUntil = Date.now() + 30000;
    toast("Ghadi baj gayi — Agatha hall ki taraf aa rahi hai!");
    try {
      if (Audio8 && Audio8.chime) Audio8.chime();
      else if (Audio8 && Audio8.pickup) Audio8.pickup();
    } catch (err) { /* x */ }
    try {
      if (enemy && typeof enemy.applyDirectorOrder === "function") {
        enemy.applyDirectorOrder({
          tactic: "inspect_hideout",
          targetRoom: "entrance hall",
          alertBoost: 20,
          whisper: "Kaun bajata hai meri ghadi..."
        });
      }
    } catch (err) { /* x */ }
    lastPrompt = "force-refresh";
    updatePrompt();
  }

  function doSearch(spot) {
    try {
      spot.searched = true;
    } catch (err) {
      /* x */
    }
    var nm = "Cabinet";
    try {
      if (spot && spot.name) nm = String(spot.name);
    } catch (err) {
      /* x */
    }
    toast("Clue mila: " + nm + " — Agatha bhatak gayi!");
    try {
      if (enemy && typeof enemy.applyDirectorOrder === "function" && player) {
        var pp = player.pos();
        enemy.applyDirectorOrder({
          tactic: "inspect_hideout",
          targetRoom: farthestCornerRoom(pp.x, pp.z),
          alertBoost: 15,
        });
      }
    } catch (err) {
      /* distraction cosmetic */
    }
    try {
      if (Audio8) {
        if (typeof Audio8.chime === "function") Audio8.chime();
        else if (typeof Audio8.pickup === "function") Audio8.pickup();
      }
    } catch (err) {
      /* x */
    }
    lastPrompt = "force-refresh";
    updatePrompt();
  }

  function distXZ(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function keyPos(out) {
    if (!world || !world.keyMesh) return null;
    try {
      world.keyMesh.getWorldPosition(out);
      return out;
    } catch (err) {
      return null;
    }
  }

  function doorPos(out) {
    if (!world || !world.chapelDoor) return null;
    try {
      world.chapelDoor.getWorldPosition(out);
      return out;
    } catch (err) {
      return null;
    }
  }

  function doInteract() {
    if (state !== "playing" || jumpscare || !player || !tmpV) return;
    /* HN2: hidden E always steps out (never grabs key/door remotely). */
    if (isHiddenNow()) {
      try {
        if (typeof player.exitHide === "function") player.exitHide();
      } catch (err) {
        /* x */
      }
      psState.hidden = isHiddenNow();
      lastPrompt = "force-refresh";
      updatePrompt();
      return;
    }
    var pp = player.pos();
    var kp = keyPos(tmpV);
    /* Stage 2+3 win edge: key pickup unlocks the door, it no longer
     * clears the stage on its own. */
    if (!keyFound && kp && distXZ(pp.x, pp.z, kp.x, kp.z) <= KEY_RADIUS) {
      keyFound = true;
      try {
        world.keyMesh.visible = false;
      } catch (err) {
        /* x */
      }
      if (UI && UI.setKey) {
        try {
          UI.setKey(true);
        } catch (err) {
          /* x */
        }
      }
      tintDoor(true);
      if (UI && UI.setObjective) {
        try {
          UI.setObjective(Story.OBJECTIVES[1] || "");
        } catch (err) {
          /* x */
        }
      }
      if (UI && UI.banner) {
        try {
          UI.banner(Story.OBJECTIVES[1] || "", 5000);
        } catch (err) {
          /* x */
        }
      }
      if (Audio8 && Audio8.pickup) {
        try {
          Audio8.pickup();
        } catch (err) {
          /* x */
        }
      }
      if (vfx) {
        try {
          vfx.addTrauma(0.25);
        } catch (err) {
          /* x */
        }
      }
      toast("Chapel Key mila! Darwaza kholo — jaldi!");
      lastPrompt = "force-refresh";
      aiKeyFlip = true; // immediate AI Director re-plan on key pickup
      updatePrompt();
      return;
    }
    var dp = doorPos(tmpV);
    if (dp && distXZ(pp.x, pp.z, dp.x, dp.z) <= DOOR_RADIUS) {
      if (keyFound && !doorLocked) {
        try {
          if (world && world.chapelDoor) {
            world.chapelDoor.rotation.y = -1.9;
          }
        } catch (err) {
          /* x */
        }
        if (Audio8 && Audio8.doorCreak) {
          try {
            Audio8.doorCreak();
          } catch (err) {
            /* x */
          }
        }
        clearStage();
      } else {
        toast("Chapel ka darwaza band hai — pehle Chapel Key dhoondo.");
      }
      return;
    }
    /* HN2 hide: enter the cabinet (sibling player API, guarded).
     * Sibling signature is enterHide(x, z, ry) — numbers, not the spot
     * object; hidden state is read back, never assumed. */
    var hsAct = nearSpot(hideSpots(), pp.x, pp.z, HIDE_RADIUS);
    if (hsAct && player && typeof player.enterHide === "function") {
      try {
        // Spot ry is the MODEL rotation (doors = local +Z); facing yaw
        // is opposite (ry+PI) so the eye looks OUT of the cabinet.
        player.enterHide(hsAct.x, hsAct.z, hsAct.ry + Math.PI);
      } catch (err) {
        /* x */
      }
      psState.hidden = isHiddenNow();
      lastPrompt = "force-refresh";
      updatePrompt();
      return;
    }
    /* HN2 search: one-time clue + Agatha distraction. */
    var ssAct = nearSpot(searchSpots(), pp.x, pp.z, HIDE_RADIUS);
    if (ssAct && !ssAct.searched) {
      doSearch(ssAct);
      return;
    }
    /* Goosebump clock lure (30s cooldown). */
    if (distXZ(pp.x, pp.z, CLOCK_LURE.x, CLOCK_LURE.z) <= 1.8 &&
        Date.now() >= clockCdUntil) {
      doClockLure();
    }
  }

  function togglePause() {
    if (jumpscare) return;
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
  }

  function toggleTorch() {
    if (state !== "playing" || jumpscare || !player) return;
    var now = true;
    try {
      now = player.isTorchOn ? !player.isTorchOn() : true;
      player.setTorch(now);
    } catch (err) {
      /* x */
    }
    syncTouchBtn();
    toast(now ? "Torch ON" : "Torch OFF");
  }

  function toggleCrouch() {
    if (state !== "playing" || jumpscare || !player) return;
    try {
      var now = player.isCrouch ? !player.isCrouch() : true;
      player.setCrouch(now);
    } catch (err) {
      /* x */
    }
    syncTouchBtn();
  }

  function toggleMute() {
    settings.mute = !settings.mute;
    if (Audio8 && Audio8.setMuted) {
      try {
        Audio8.setMuted(settings.mute);
      } catch (err) {
        /* x */
      }
    }
    /* Mute silences in-flight whispers too (speech bypasses WebAudio). */
    if (settings.mute) {
      try {
        if (window.speechSynthesis && window.speechSynthesis.cancel) {
          window.speechSynthesis.cancel();
        }
      } catch (err) {
        /* x */
      }
    }
    persist();
    if (UI && UI.syncSettings) {
      try {
        UI.syncSettings(settings);
      } catch (e) {
        /* x */
      }
    }
    toast(settings.mute ? "Muted" : "Sound ON");
  }

  function buildInput() {
    return {
      f: !!(keys.KeyW || keys.ArrowUp),
      b: !!(keys.KeyS || keys.ArrowDown),
      l: !!(keys.KeyA || keys.ArrowLeft),
      r: !!(keys.KeyD || keys.ArrowRight),
      run: !!(keys.ShiftLeft || keys.ShiftRight),
    };
  }


  /* ============================================================================
   * CRIMSON OUTBREAK: QUARANTINE SECTOR 7 — 3D ZOMBIE SHOOTER COMBAT ENGINE
   * ============================================================================ */
  var WEAPONS = [
    { name: "M4-X PULSE CARBINE", mag: 30, maxMag: 30, reserve: 120, dmg: 45, headMult: 2.4, cd: 0.13, pellets: 1, spread: 0.010, color: 0x38f9d4 },
    { name: "M870 BREACHER SHOTGUN", mag: 8, maxMag: 8, reserve: 40, dmg: 28, headMult: 2.0, cd: 0.52, pellets: 6, spread: 0.058, color: 0xff9933 },
    { name: "VGGT BIO-RAILCANNON", mag: 5, maxMag: 5, reserve: 20, dmg: 175, headMult: 3.0, cd: 0.72, pellets: 1, spread: 0.002, color: 0xa855f7 }
  ];
  var curWep = 0;
  var fireCd = 0;
  var reloadTimer = 0;
  var fireHeld = false;
  var playerHP = 100;
  var playerMaxHP = 100;
  var playerHurtCd = 0;
  var zombieKills = 0;
  var KILL_GOAL = 8;
  var hordeZombies = [];
  var activeFX = [];
  var raycaster = null;
  var hitTimer = 0;
  var popTimer = 0;
  var bloodSpriteTex = null;

  function getBloodSpriteTex() {
    if (bloodSpriteTex) return bloodSpriteTex;
    try {
      var cv = document.createElement("canvas");
      cv.width = 64; cv.height = 64;
      var cx = cv.getContext("2d");
      var g = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,60,60,0.85)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, 64, 64);
      bloodSpriteTex = new THREE.CanvasTexture(cv);
    } catch (e) {}
    return bloodSpriteTex;
  }

  function updateShooterHUD() {
    try {
      var w = WEAPONS[curWep];
      var vw = $("val-weapon");
      if (vw) {
        vw.textContent = w.name;
        vw.style.color = curWep === 1 ? "#ff9933" : (curWep === 2 ? "#c084fc" : "#38f9d4");
      }
      var va = $("val-ammo");
      if (va) {
        va.textContent = reloadTimer > 0 ? "RELOADING..." : (w.mag + " / " + w.reserve);
      }
      var vh = $("val-hp");
      if (vh) {
        vh.textContent = Math.max(0, Math.round(playerHP)) + " HP";
        vh.style.color = playerHP > 50 ? "#34d399" : (playerHP > 25 ? "#fbbf24" : "#ef4444");
      }
      var hf = $("hp-bar-fill");
      if (hf) hf.style.width = Math.max(0, Math.min(100, playerHP)) + "%";
      var hk = $("hud-kills");
      if (hk) hk.textContent = "KILLS: " + zombieKills + " / " + KILL_GOAL;
    } catch (eHud) {}
  }

  function showHitmarker(isCrit) {
    try {
      var hm = $("hitmarker");
      if (!hm) return;
      hm.style.color = isCrit ? "#ffd166" : "#ff3b3b";
      hm.style.transform = isCrit ? "translate(-50%, -50%) scale(1.35)" : "translate(-50%, -50%) scale(1.0)";
      hm.style.opacity = "1";
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(function () {
        hm.style.opacity = "0";
      }, 140);
    } catch (eHm) {}
  }

  function showCombatPopup(txt, col) {
    try {
      var cp = $("combat-popup");
      if (!cp) return;
      cp.textContent = txt;
      cp.style.color = col || "#ffd166";
      cp.style.opacity = "1";
      if (popTimer) clearTimeout(popTimer);
      popTimer = setTimeout(function () {
        cp.style.opacity = "0";
      }, 950);
    } catch (eCp) {}
  }

  function playGunshotSFX(wIdx, isHead, isKill) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || settings.mute) return;
      if (!window.__stvGunCtx) window.__stvGunCtx = new AC();
      var ctx = window.__stvGunCtx;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = wIdx === 2 ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(wIdx === 1 ? 120 : (wIdx === 2 ? 320 : 165), now);
      osc.frequency.exponentialRampToValueAtTime(28, now + (wIdx === 1 ? 0.22 : 0.14));
      g.gain.setValueAtTime(0.42 * (settings.volume || 0.8), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + (wIdx === 1 ? 0.24 : 0.15));
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (wIdx === 1 ? 0.25 : 0.16));

      if (isHead || isKill) {
        var bell = ctx.createOscillator();
        var bg = ctx.createGain();
        bell.type = "sine";
        bell.frequency.setValueAtTime(isHead ? 1320 : 880, now + 0.02);
        bell.frequency.exponentialRampToValueAtTime(isHead ? 1760 : 660, now + 0.18);
        bg.gain.setValueAtTime(0.26 * (settings.volume || 0.8), now + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
        bell.connect(bg);
        bg.connect(ctx.destination);
        bell.start(now + 0.02);
        bell.stop(now + 0.21);
      }
    } catch (eSfx) {}
  }

  function spawnBloodOrSparks(pos, isBlood, count) {
    try {
      if (!scene) return;
      var n = count || (isBlood ? 18 : 10);
      var geo = new THREE.BufferGeometry();
      var pArr = new Float32Array(n * 3);
      var vels = [];
      for (var i = 0; i < n; i++) {
        pArr[i * 3] = pos.x;
        pArr[i * 3 + 1] = pos.y;
        pArr[i * 3 + 2] = pos.z;
        vels.push({
          vx: (Math.random() - 0.5) * 3.8,
          vy: 0.8 + Math.random() * 2.6,
          vz: (Math.random() - 0.5) * 3.8
        });
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pArr, 3));
      var mat = new THREE.PointsMaterial({
        size: isBlood ? 0.24 : 0.16,
        map: getBloodSpriteTex(),
        color: isBlood ? 0xdc2626 : 0xffbe55,
        transparent: true,
        opacity: 0.95,
        blending: isBlood ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false
      });
      var pts = new THREE.Points(geo, mat);
      scene.add(pts);
      activeFX.push({
        type: "points",
        obj: pts,
        geo: geo,
        mat: mat,
        vels: vels,
        age: 0,
        life: isBlood ? 0.55 : 0.32
      });
    } catch (eFx) {}
  }

  function spawnTracer(p0, p1, colHex) {
    try {
      if (!scene) return;
      var geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
      var mat = new THREE.LineBasicMaterial({
        color: colHex || 0x38f9d4,
        transparent: true,
        opacity: 0.92
      });
      var line = new THREE.Line(geo, mat);
      scene.add(line);
      activeFX.push({
        type: "line",
        obj: line,
        geo: geo,
        mat: mat,
        age: 0,
        life: 0.085
      });
    } catch (eTr) {}
  }

  function detonateBarrel(bRec) {
    if (!bRec || !bRec.alive || !scene) return;
    bRec.alive = false;
    bRec.respawnT = 14.0;
    if (bRec.group) bRec.group.visible = false;
    var center = new THREE.Vector3(bRec.x, 0.7, bRec.z);
    spawnBloodOrSparks(center, false, 36);
    if (vfx && vfx.addTrauma) vfx.addTrauma(0.65);
    if (Audio8 && Audio8.thunder) {
      try { Audio8.thunder(); } catch (eT) {}
    }
    try {
      var expLight = new THREE.PointLight(0xff6b22, 6.5, 16, 1.5);
      expLight.position.copy(center);
      scene.add(expLight);
      var sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 14, 12),
        new THREE.MeshBasicMaterial({
          color: 0xff7722,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      sphere.position.copy(center);
      scene.add(sphere);
      activeFX.push({
        type: "explosion",
        obj: sphere,
        light: expLight,
        geo: sphere.geometry,
        mat: sphere.material,
        age: 0,
        life: 0.48
      });
    } catch (eEx) {}

    var blastKills = 0;
    for (var zi = 0; zi < hordeZombies.length; zi++) {
      var hz = hordeZombies[zi];
      if (!hz || hz.deadT > 0) continue;
      var dx = hz.x - bRec.x;
      var dz = hz.z - bRec.z;
      if (dx * dx + dz * dz <= 4.8 * 4.8) {
        if (damageHordeZombie(hz, 220, true)) blastKills++;
      }
    }
    if (enemy && enemy.getPos && enemy.damage) {
      var ep = enemy.getPos();
      if (!ep.dead) {
        var edx = ep.x - bRec.x;
        var edz = ep.z - bRec.z;
        if (edx * edx + edz * edz <= 4.8 * 4.8) {
          var er = enemy.damage(220, true);
          if (er && er.killed) {
            blastKills++;
            onZombieKilled(true);
          }
        }
      }
    }
    showCombatPopup(
      blastKills > 0
        ? "BIO-BARREL DETONATED! +" + blastKills + " KILLS!"
        : "BIO-BARREL DETONATED!",
      "#ff9933"
    );
  }

  function onZombieKilled(isBoss) {
    zombieKills += isBoss ? 2 : 1;
    if (zombieKills >= KILL_GOAL && !keyFound) {
      keyFound = true;
      if (world && world.keyMesh) {
        try { world.keyMesh.visible = false; } catch (eK) {}
      }
      if (UI && UI.setKey) {
        try { UI.setKey(true); } catch (eU) {}
      }
      tintDoor(true);
      if (UI && UI.setObjective) {
        try { UI.setObjective(Story.OBJECTIVES[1] || ""); } catch (eO) {}
      }
      if (UI && UI.banner) {
        try { UI.banner("HORDE PURGED! North Extraction Gate Unlocked [Press E]", 5500); } catch (eB) {}
      }
    } else if (!keyFound && UI && UI.setObjective) {
      try {
        UI.setObjective("Purge Infected (" + Math.min(zombieKills, KILL_GOAL) + "/" + KILL_GOAL + ") & Secure Bio-Key");
      } catch (eO2) {}
    }
    updateShooterHUD();
  }

  function initZombieHorde() {
    if (!scene || hordeZombies.length > 0) return;
    var SPAWNS = [
      { x: -0.45, z: 4.3, patrol: [[-0.45, 4.3], [-3.2, 3.2], [2.8, 3.5]] },
      { x:  1.65, z: 2.2, patrol: [[ 1.65, 2.2], [ 4.2, -1.2], [1.2, -1.5]] },
      { x: -2.4,  z: 0.2, patrol: [[-2.4,  0.2], [-4.8, -2.5], [0.0, -3.2]] },
      { x: -5.2,  z: -5.8, patrol: [[-5.2, -5.8], [0, -6.8], [5.2, -5.8]] },
      { x:  5.2,  z:  3.2, patrol: [[5.2, 3.2], [7.2, 1.5], [4.2, -2.5]] }
    ];
    for (var i = 0; i < SPAWNS.length; i++) {
      (function (sp, idx) {
        var grp = new THREE.Group();
        grp.position.set(sp.x, 0, sp.z);
        scene.add(grp);
        var eyeSp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getBloodSpriteTex(),
            color: 0xff1e1e,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          })
        );
        eyeSp.position.set(0, 1.62, 0.18);
        eyeSp.scale.set(0.14, 0.06, 1);
        eyeSp.visible = false;
        grp.add(eyeSp);

        var hitBox = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.42, 1.82, 8),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hitBox.position.y = 0.91;
        grp.add(hitBox);

        var zRec = {
          id: idx,
          x: sp.x,
          z: sp.z,
          yaw: 0,
          hp: idx === 0 ? 160 : 100,
          maxHp: idx === 0 ? 160 : 100,
          staggerT: 0,
          deadT: 0,
          atkCd: 0,
          wpIdx: 0,
          patrol: sp.patrol,
          group: grp,
          hitBox: hitBox,
          mixer: null,
          actions: {},
          activeClip: ""
        };
        hitBox.userData.hordeZombie = zRec;
        hordeZombies.push(zRec);

        var gl = new THREE.GLTFLoader();
        if (window.THREE._agathaDraco) {
          try { gl.setDRACOLoader(window.THREE._agathaDraco); } catch (eD) {}
        }
        var zModels = [
          "./assets/chained_zombie.glb",
          "./assets/faceless_zombie.glb",
          "./assets/undead_warrior_boss.glb",
          "./assets/chained_zombie.glb",
          "./assets/faceless_zombie.glb"
        ];
        var zUrl = zModels[idx % zModels.length];
        gl.load(zUrl, function (gltf) {
          var root = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
          if (!root) return;
          var box = new THREE.Box3().setFromObject(root);
          var sz = box.getSize(new THREE.Vector3());
          var maxDim = Math.max(sz.x, Math.max(sz.y, sz.z));
          if (maxDim > 0.01) root.scale.setScalar(1.72 / maxDim);
          box.setFromObject(root);
          root.position.y -= box.min.y;
          zRec.bones = {};
          root.traverse(function (n) {
            if (n && n.isMesh) {
              n.userData.hordeZombie = zRec;
            }
            if (n && n.isBone && n.name) {
              var bn = n.name.toLowerCase();
              if (!zRec.bones.thighL && (bn === "thigh.l" || bn === "thigh_fk.l" || bn.indexOf("upleg") >= 0 && bn.indexOf("l") >= 0)) zRec.bones.thighL = n;
              if (!zRec.bones.thighR && (bn === "thigh.r" || bn === "thigh_fk.r" || bn.indexOf("upleg") >= 0 && bn.indexOf("r") >= 0)) zRec.bones.thighR = n;
              if (!zRec.bones.armL && (bn === "arm.l" || bn === "arm_fk.l" || bn === "upper_arm.l")) zRec.bones.armL = n;
              if (!zRec.bones.armR && (bn === "arm.r" || bn === "arm_fk.r" || bn === "upper_arm.r")) zRec.bones.armR = n;
            }
          });
          grp.add(root);
          if (gltf.animations && gltf.animations.length && THREE.AnimationMixer) {
            var mx = new THREE.AnimationMixer(root);
            zRec.mixer = mx;
            for (var ai = 0; ai < gltf.animations.length; ai++) {
              var cl = gltf.animations[ai];
              var nm = (cl.name || "").toLowerCase();
              if (!zRec.actions.idle && nm.indexOf("idle") >= 0) zRec.actions.idle = mx.clipAction(cl);
              if (!zRec.actions.walk && nm.indexOf("walk") >= 0) zRec.actions.walk = mx.clipAction(cl);
              if (!zRec.actions.run && nm.indexOf("run") >= 0) zRec.actions.run = mx.clipAction(cl);
              if (!zRec.actions.hit && nm.indexOf("hit") >= 0) {
                zRec.actions.hit = mx.clipAction(cl);
                zRec.actions.hit.setLoop(THREE.LoopOnce, 1);
                zRec.actions.hit.clampWhenFinished = true;
              }
              if (!zRec.actions.dead && nm.indexOf("dead front") >= 0) {
                zRec.actions.dead = mx.clipAction(cl);
                zRec.actions.dead.setLoop(THREE.LoopOnce, 1);
                zRec.actions.dead.clampWhenFinished = true;
              }
            }
            if (zRec.actions.walk) {
              zRec.actions.walk.play();
              zRec.activeClip = "walk";
            }
          }
        });
      })(SPAWNS[i], i);
    }
  }

  function playZombieClip(z, name) {
    if (!z || !z.mixer || !z.actions[name] || z.activeClip === name) return;
    try {
      if (z.actions[z.activeClip]) z.actions[z.activeClip].fadeOut(0.12);
      z.actions[name].reset().fadeIn(0.12).play();
      z.activeClip = name;
    } catch (eC) {}
  }

  function damageHordeZombie(z, dmg, isHead) {
    if (!z || z.deadT > 0) return false;
    z.hp = Math.max(0, z.hp - dmg);
    if (z.hp <= 0) {
      z.deadT = 6.5;
      playZombieClip(z, "dead");
      onZombieKilled(false);
      return true;
    }
    z.staggerT = isHead ? 0.55 : 0.30;
    if (z.actions.hit) {
      try { z.actions.hit.reset().play(); } catch (eH) {}
    }
    return false;
  }

  function hurtPlayer(dmg, reason) {
    if (playerHurtCd > 0 || state !== "playing" || jumpscare) return true;
    playerHurtCd = 1.25;
    playerHP = Math.max(0, playerHP - (dmg || 24));
    updateShooterHUD();
    if (vfx && vfx.addTrauma) vfx.addTrauma(0.42);
    try {
      var fl = $("flash");
      if (fl) {
        fl.style.background = "radial-gradient(circle, rgba(220,38,38,0.15), rgba(185,28,28,0.65))";
        fl.style.opacity = "1";
        setTimeout(function () { fl.style.opacity = "0"; }, 220);
      }
    } catch (eFl) {}
    showCombatPopup((reason || "INFECTED CLAW HIT!") + " -" + (dmg || 24) + " HP", "#ef4444");
    if (playerHP <= 0) {
      return false;
    }
    return true;
  }

  function reloadWeapon() {
    if (state !== "playing" || reloadTimer > 0) return;
    var w = WEAPONS[curWep];
    if (w.mag >= w.maxMag || w.reserve <= 0) return;
    reloadTimer = 0.85;
    if (player && player.triggerReloadFX) player.triggerReloadFX();
    showCombatPopup("RELOADING " + w.name + "...", "#38f9d4");
    updateShooterHUD();
  }

  function selectWeapon(idx) {
    var next = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (next === curWep) return;
    curWep = next;
    reloadTimer = 0;
    if (player && player.triggerReloadFX) player.triggerReloadFX();
    showCombatPopup("EQUIPPED: " + WEAPONS[curWep].name, "#38f9d4");
    updateShooterHUD();
  }

  function fireWeapon() {
    if (state !== "playing" || jumpscare || !camera || !scene) return;
    if (fireCd > 0 || reloadTimer > 0) return;
    var w = WEAPONS[curWep];
    if (w.mag <= 0) {
      reloadWeapon();
      return;
    }
    w.mag--;
    fireCd = w.cd;
    if (player && player.triggerShootFX) player.triggerShootFX(curWep);
    if (vfx && vfx.addTrauma) vfx.addTrauma(curWep === 1 ? 0.16 : 0.07);
    updateShooterHUD();

    if (!raycaster) raycaster = new THREE.Raycaster();
    var muzzleOrigin = new THREE.Vector3(0.16, -0.12, -0.45).applyMatrix4(camera.matrixWorld);
    var anyHead = false;
    var anyKill = false;
    var anyHit = false;
    var totalDmgDealt = 0;

    for (var p = 0; p < w.pellets; p++) {
      var sx = (p === 0 && w.pellets === 1) ? 0 : (Math.random() - 0.5) * w.spread;
      var sy = (p === 0 && w.pellets === 1) ? 0 : (Math.random() - 0.5) * w.spread;
      raycaster.setFromCamera({ x: sx, y: sy }, camera);
      var hits = raycaster.intersectObjects(scene.children, true);
      var endPt = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(26));
      for (var hi = 0; hi < hits.length; hi++) {
        var h = hits[hi];
        if (!h || !h.object || h.distance < 0.45) continue;
        var anc = h.object;
        var isCamChild = false;
        var hitBarrel = null;
        var hitHorde = null;
        var hitAlpha = false;
        var alphaGrp = enemy && enemy.getGroup ? enemy.getGroup() : null;
        while (anc) {
          if (anc === camera) { isCamChild = true; break; }
          if (anc.userData && anc.userData.hordeZombie) hitHorde = anc.userData.hordeZombie;
          if (alphaGrp && anc === alphaGrp) hitAlpha = true;
          if (window.__stvBarrels) {
            for (var bi = 0; bi < window.__stvBarrels.length; bi++) {
              if (window.__stvBarrels[bi].alive && window.__stvBarrels[bi].group === anc) {
                hitBarrel = window.__stvBarrels[bi];
              }
            }
          }
          anc = anc.parent;
        }
        if (isCamChild) continue;
        endPt = h.point.clone();

        if (hitBarrel) {
          detonateBarrel(hitBarrel);
          anyHit = true;
          anyKill = true;
          break;
        }
        if (hitHorde && hitHorde.deadT <= 0) {
          var isHead = h.point.y >= 1.28;
          var dmg = Math.round(w.dmg * (isHead ? w.headMult : 1));
          totalDmgDealt += dmg;
          anyHit = true;
          if (isHead) anyHead = true;
          spawnBloodOrSparks(h.point, true, isHead ? 24 : 14);
          if (damageHordeZombie(hitHorde, dmg, isHead)) anyKill = true;
          break;
        }
        if (hitAlpha && enemy && enemy.damage) {
          var isHeadA = h.point.y >= 1.28;
          var dmgA = Math.round(w.dmg * (isHeadA ? w.headMult : 1));
          totalDmgDealt += dmgA;
          anyHit = true;
          if (isHeadA) anyHead = true;
          spawnBloodOrSparks(h.point, true, isHeadA ? 26 : 16);
          var resA = enemy.damage(dmgA, isHeadA);
          if (resA && resA.killed) {
            anyKill = true;
            onZombieKilled(true);
          }
          break;
        }
        if (h.object.isMesh && h.object.visible) {
          spawnBloodOrSparks(h.point, false, 8);
          break;
        }
      }
      spawnTracer(muzzleOrigin, endPt, w.color);
    }

    playGunshotSFX(curWep, anyHead, anyKill);
    if (anyHit) {
      showHitmarker(anyHead || anyKill);
      if (anyKill) {
        showCombatPopup(anyHead ? "CRITICAL HEADSHOT KILL! +" + totalDmgDealt : "INFECTED ELIMINATED! +" + totalDmgDealt, "#ffd166");
      } else if (anyHead) {
        showCombatPopup("HEADSHOT! -" + totalDmgDealt, "#ffd166");
      } else {
        showCombatPopup("HIT -" + totalDmgDealt, "#f87171");
      }
    }
    if (w.mag <= 0 && w.reserve > 0) reloadWeapon();
  }

  function updateShooterStep(dt) {
    if (fireCd > 0) fireCd = Math.max(0, fireCd - dt);
    if (playerHurtCd > 0) playerHurtCd = Math.max(0, playerHurtCd - dt);
    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloadTimer = 0;
        var w = WEAPONS[curWep];
        var need = w.maxMag - w.mag;
        var take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        updateShooterHUD();
      }
    }
    if (fireHeld && fireCd <= 0 && reloadTimer <= 0) {
      fireWeapon();
    }

    for (var fi = activeFX.length - 1; fi >= 0; fi--) {
      var fx = activeFX[fi];
      fx.age += dt;
      var u = fx.age / fx.life;
      if (u >= 1) {
        if (fx.obj && scene) scene.remove(fx.obj);
        if (fx.light && scene) scene.remove(fx.light);
        if (fx.geo) fx.geo.dispose();
        if (fx.mat) fx.mat.dispose();
        activeFX.splice(fi, 1);
        continue;
      }
      if (fx.type === "line") {
        fx.mat.opacity = 1 - u;
      } else if (fx.type === "points") {
        var posAttr = fx.geo.getAttribute("position");
        var arr = posAttr.array;
        for (var pi = 0; pi < fx.vels.length; pi++) {
          var v = fx.vels[pi];
          v.vy -= 9.8 * dt;
          arr[pi * 3] += v.vx * dt;
          arr[pi * 3 + 1] = Math.max(0.05, arr[pi * 3 + 1] + v.vy * dt);
          arr[pi * 3 + 2] += v.vz * dt;
        }
        posAttr.needsUpdate = true;
        fx.mat.opacity = 1 - u;
      } else if (fx.type === "explosion") {
        var sc = 1 + u * 6.5;
        fx.obj.scale.set(sc, sc, sc);
        fx.mat.opacity = (1 - u) * 0.9;
        if (fx.light) fx.light.intensity = 6.5 * (1 - u);
      }
    }

    var pp = player ? player.pos() : { x: 0, z: 8.5 };
    if (window.__stvBarrels) {
      for (var bi = 0; bi < window.__stvBarrels.length; bi++) {
        var b = window.__stvBarrels[bi];
        if (!b.alive) {
          b.respawnT -= dt;
          if (b.respawnT <= 0) {
            b.alive = true;
            if (b.group) b.group.visible = true;
          }
        } else if (b.ring) {
          b.ring.rotation.z += dt * 1.8;
        }
      }
    }
    if (window.__stvSupplyCrates) {
      for (var si = 0; si < window.__stvSupplyCrates.length; si++) {
        var sc2 = window.__stvSupplyCrates[si];
        if (sc2.cd > 0) {
          sc2.cd -= dt;
          if (sc2.cd <= 0 && sc2.group) sc2.group.visible = true;
          continue;
        }
        if (sc2.ring) sc2.ring.rotation.z += dt * 2.2;
        var sdx = pp.x - sc2.x;
        var sdz = pp.z - sc2.z;
        if (sdx * sdx + sdz * sdz <= 1.35 * 1.35) {
          if (sc2.type === "ammo") {
            WEAPONS[0].reserve += 60;
            WEAPONS[1].reserve += 16;
            WEAPONS[2].reserve += 8;
            sc2.cd = 18;
            if (sc2.group) sc2.group.visible = false;
            showCombatPopup("+AMMO RESUPPLY CRATE!", "#38f9d4");
            updateShooterHUD();
          } else if (sc2.type === "medkit" && playerHP < 100) {
            playerHP = Math.min(100, playerHP + 45);
            sc2.cd = 18;
            if (sc2.group) sc2.group.visible = false;
            showCombatPopup("+45 HP TRIAGE MEDKIT!", "#34d399");
            updateShooterHUD();
          }
        }
      }
    }

    for (var zi = 0; zi < hordeZombies.length; zi++) {
      var hz = hordeZombies[zi];
      if (!hz) continue;
      if (hz.mixer) {
        try { hz.mixer.update(dt); } catch (eMx) {}
      }
      if (hz.deadT > 0) {
        hz.deadT -= dt;
        hz.group.rotation.x += (-Math.PI / 2 - hz.group.rotation.x) * Math.min(1, dt * 10);
        hz.group.position.y = 0.18;
        if (hz.deadT <= 0) {
          hz.hp = hz.maxHp;
          hz.group.rotation.x = 0;
          hz.group.position.y = 0;
          var sp = hz.patrol[Math.floor(Math.random() * hz.patrol.length)];
          hz.x = sp[0];
          hz.z = sp[1];
          hz.group.position.set(hz.x, 0, hz.z);
          playZombieClip(hz, "walk");
        }
        continue;
      }
      if (hz.staggerT > 0) {
        hz.staggerT -= dt;
        hz.group.rotation.x = -0.32 * (hz.staggerT / 0.55);
        continue;
      }
      hz.group.rotation.x = 0;
      if (hz.atkCd > 0) hz.atkCd -= dt;
      var zdx = pp.x - hz.x;
      var zdz = pp.z - hz.z;
      var zdist = Math.sqrt(zdx * zdx + zdz * zdz);
      var chasing = zdist < 10.5 && !(player && player.isHidden && player.isHidden());
      var tx = pp.x;
      var tz = pp.z;
      if (!chasing) {
        var wp = hz.patrol[hz.wpIdx % hz.patrol.length];
        tx = wp[0];
        tz = wp[1];
        if ((tx - hz.x) * (tx - hz.x) + (tz - hz.z) * (tz - hz.z) < 0.45) {
          hz.wpIdx = (hz.wpIdx + 1) % hz.patrol.length;
        }
      }
      playZombieClip(hz, chasing ? "run" : "walk");
      var spd = chasing ? 3.25 : 1.55;
      var mvx = tx - hz.x;
      var mvz = tz - hz.z;
      var mvd = Math.sqrt(mvx * mvx + mvz * mvz);
      if (mvd > 0.05) {
        var nx = hz.x + (mvx / mvd) * spd * dt;
        var nz = hz.z + (mvz / mvd) * spd * dt;
        var blocked = false;
        for (var ci = 0; ci < colliders.length; ci++) {
          var c = colliders[ci];
          if (nx > c.x0 - 0.3 && nx < c.x1 + 0.3 && nz > c.z0 - 0.3 && nz < c.z1 + 0.3) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          hz.x = nx;
          hz.z = nz;
        } else {
          hz.wpIdx = (hz.wpIdx + 1) % hz.patrol.length;
        }
        hz.yaw = Math.atan2(mvx, mvz);
      }
      hz.phase = (hz.phase || (zi * 1.3)) + dt * (chasing ? 9.5 : 5.2);
      var sw = Math.sin(hz.phase);
      if (hz.bones) {
        if (hz.bones.thighL) hz.bones.thighL.rotation.x = sw * 0.45;
        if (hz.bones.thighR) hz.bones.thighR.rotation.x = -sw * 0.45;
      }
      hz.group.position.set(hz.x, Math.abs(sw) * 0.045, hz.z);
      hz.group.rotation.y = hz.yaw;
      hz.group.rotation.z = sw * 0.055;

      if (zdist <= 1.15 && hz.atkCd <= 0 && !isHiddenNow()) {
        hz.atkCd = 1.4;
        if (!hurtPlayer(22, "BLOODFANG ZOMBIE BITE!")) {
          handleCaught();
        }
      }
    }
  }

  function step(dt) {
    try { updateShooterStep(dt); } catch (eSh) {}
    var input = buildInput();
    timerMs += dt * 1000;
    if (player) {
      try {
        player.update(dt, input);
      } catch (err) {
        /* x */
      }
    }
    /* Stage 2+3: Agatha advances on the same fixed step. */
    if (enemy) {
      try {
        var pp = player ? player.pos() : null;
        psState.x = pp ? pp.x : 0;
        psState.z = pp ? pp.z : 8.5;
        psState.noise = player ? player.noiseLevel() : 0;
        psState.torchOn = player ? player.isTorchOn() : true;
        psState.crouch = player ? player.isCrouch() : false;
        psState.keyHeld = keyFound;
        psState.inClassB = inClassB(psState.x, psState.z);
        /* HN2: hidden flag mirrors the player hide API every step. */
        psState.hidden = isHiddenNow();
        enemy.update(dt, timerMs / 1000, psState);
      } catch (err) {
        /* x */
      }
    }
    if (vfx && camera) {
      try {
        vfx.update(dt, camera);
      } catch (err) {
        /* x */
      }
    }
  }

  /* LIVE AI DIRECTOR poll (~14s + instant on key flip): POSTs telemetry
   * to /api/studio/ai/director and applies the order to BOTH Agatha's
   * brain (enemy.applyDirectorOrder) and the 3D environment
   * (world.applyAiEnvironment), plus whisper banner + HUD pill. Fully
   * guarded: AI down/rate-limited => silent skip, gameplay unaffected. */
  function pollAiDirector() {
    if (aiPollBusy || state !== "playing") return;
    if (typeof fetch !== "function") return;
    var room = "";
    try {
      var hr = document.querySelector("#hud-room");
      room = hr ? String(hr.textContent || "").replace(/^◉\s*/, "") : "";
    } catch (eRoom) { room = ""; }
    var body = {
      room: room,
      noise: psState.noise || 0,
      torchOn: !!psState.torchOn,
      crouch: !!psState.crouch,
      hasKey: !!keyFound,
      enemyState: (typeof esCache !== "undefined" && esCache.state) || "PATROL",
      dist: (typeof esCache !== "undefined" && esCache.dist) || 99,
      survivalSec: Math.round(timerMs / 1000)
    };
    aiPollBusy = true;
    fetch("/api/studio/ai/director", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r || !r.ok) throw new Error("http " + (r && r.status));
      return r.json();
    }).then(function (order) {
      aiPollBusy = false;
      if (!order || order.ok !== true) return;
      try {
        if (enemy && typeof enemy.applyDirectorOrder === "function") {
          enemy.applyDirectorOrder(order);
        }
      } catch (eBrain) { /* AI steer cosmetic */ }
      try {
        if (world && typeof world.applyAiEnvironment === "function") {
          world.applyAiEnvironment(order);
        }
      } catch (eEnv) { /* AI env cosmetic */ }
      try {
        if (UI && typeof UI.aiPill === "function") {
          UI.aiPill(order.tactic || "stalk_shadow", order.envEvent || "storm_surge");
        }
      } catch (ePill) { /* x */ }
      try {
        if (order.whisper && UI && UI.banner) {
          UI.banner(order.whisper, 6000);
        }
      } catch (eWh) { /* x */ }
      try { window.__stvLastAiOrder = order; } catch (eDbg) { /* x */ }
    }).catch(function () {
      aiPollBusy = false; // offline/rate-limited: play on silently
    });
  }

  /* Stage 2+3: 4Hz director tick — alert fades, HUD, beats, rumble. */
  function directorTick() {
    var es = null;
    if (enemy) {
      try {
        es = enemy.getState();
      } catch (err) {
        es = null;
      }
    }
    /* Publish the single shared sample (HUD + debug read this). */
    try {
      if (es) {
        esCache.state = es.state;
        esCache.suspicion = es.suspicion;
        esCache.dist = es.dist;
        esCache.alert01 = es.alert01;
      }
    } catch (err) {
      /* x */
    }
    /* Goosebump EM proximity: Agatha <9m => lanterns shudder. */
    try {
      var emD = (es && typeof es.dist === "number") ? es.dist : 99;
      var emF = emD < 9 ? 1 - emD / 9 : 0;
      if (world && typeof world.setThreatFactor === "function") {
        world.setThreatFactor(emF);
      }
      if (player && typeof player.setEMFlicker === "function") {
        player.setEMFlicker(emF);
      }
    } catch (err) {
      /* x */
    }
    /* LIVE AI DIRECTOR cadence: wall-clock 14s (tick counts drift when
     * fps sags, so timestamps keep it honest). Key flip forces an
     * immediate re-plan on the next tick. */
    try {
      if (state === "playing") {
        var aiNow = Date.now();
        if (aiLastPoll === 0) { aiLastPoll = aiNow; }
        if (aiKeyFlip || aiNow - aiLastPoll >= 14000) {
          aiLastPoll = aiNow;
          aiKeyFlip = false;
          pollAiDirector();
        }
      } else {
        aiLastPoll = 0;
        aiKeyFlip = false;
      }
    } catch (err) {
      /* x */
    }
    var runT = timerMs / 1000;
    var inB = inClassB(psState.x, psState.z);
    var entered = inB && !wasInB;
    wasInB = inB;
    if (!b1fired) {
      if (runT >= 35 && es && es.dist > 8) {
        b1fired = true;
        if (Audio8 && Audio8.thunder) {
          try {
            Audio8.thunder();
          } catch (err) {
            /* x */
          }
        }
        if (vfx && vfx.silhouetteReveal) {
          try {
            vfx.silhouetteReveal();
          } catch (err) {
            /* x */
          }
        }
      } else if (runT >= 60) {
        b1fired = true;
      }
    }
    if (!b2fired && (entered || (runT >= 80 && inB))) {
      b2fired = true;
      if (enemy) {
        try {
          enemy.setAlert(1);
        } catch (err) {
          /* x */
        }
      }
      if (Audio8 && Audio8.queueWhisper) {
        try {
          Audio8.queueWhisper("near");
        } catch (err) {
          /* x */
        }
      }
    }
    if (!b4fired && keyFound) {
      b4fired = true;
      if (enemy) {
        try {
          enemy.setAlert(2);
        } catch (err) {
          /* x */
        }
      }
      if (Audio8 && Audio8.queueWhisper) {
        try {
          Audio8.queueWhisper("chase");
        } catch (err) {
          /* x */
        }
      }
      if (UI && UI.banner) {
        try {
          UI.banner(Story.OBJECTIVES[2] || "", 5000);
        } catch (err) {
          /* x */
        }
      }
    }
    var floor = 0.15;
    if (b4fired) floor = 1.0;
    else if (b2fired) floor = 0.6;
    var crouchNow = false;
    try {
      crouchNow = player ? player.isCrouch() : false;
    } catch (err) {
      /* x */
    }
    if (runT >= 125 && es && es.state === "SEARCH" && es.dist < 8) {
      if (crouchNow) {
        floor = Math.max(floor, 0.85);
        if (!b3fired) {
          b3fired = true;
          if (Audio8 && Audio8.queueWhisper) {
            try {
              Audio8.queueWhisper("near");
            } catch (err) {
              /* x */
            }
          }
        }
      }
    }
    var alert = Math.max(floor, es ? es.alert01 : 0.15);
    if (Audio8 && Audio8.setAlert01) {
      try {
        Audio8.setAlert01(alert);
      } catch (err) {
        /* x */
      }
    }
    /* Master sound overhaul: spatial listener/Agatha poses, adaptive
     * threat tier + heartbeat, and lantern crackle (4Hz director tick). */
    if (Audio8) {
      try {
        if (Audio8.setListener) {
          var yawNow = 0;
          try {
            yawNow = camera && camera.rotation ? camera.rotation.y || 0 : 0;
          } catch (e) {
            /* x */
          }
          Audio8.setListener(psState.x, psState.z, yawNow);
        }
      } catch (err) {
        /* x */
      }
      try {
        if (Audio8.setAgatha && window.__stvAgathaXZ) {
          Audio8.setAgatha(window.__stvAgathaXZ[0], window.__stvAgathaXZ[1]);
        }
      } catch (err) {
        /* x */
      }
      try {
        if (Audio8.setEnemyState && es) {
          Audio8.setEnemyState(es.state, es.dist);
        }
      } catch (err) {
        /* x */
      }
      try {
        if (Audio8.lanternTick) Audio8.lanternTick();
      } catch (err) {
        /* x */
      }
    }
    if (UI && UI.setEnemy) {
      try {
        UI.setEnemy(es ? es.state : "PATROL", es ? es.dist : 99);
      } catch (err) {
        /* x */
      }
    }
    if (es && es.state === "CHASE" && vfx && vfx.chaseRumble) {
      try {
        var prox = 1 - es.dist / 14;
        if (prox < 0) prox = 0;
        if (prox > 1) prox = 1;
        vfx.chaseRumble(prox);
      } catch (err) {
        /* x */
      }
    }
  }

  var acc = 0;
  var lastT = 0;
  var pausedRendered = false;
  var loopPaused = false;

  function frame(now) {
    if (!started || !renderer) return;
    var raw = (now - lastT) / 1000;
    lastT = now;
    if (!(raw > 0)) raw = 0;
    /* Stage 2+3: unclamped wall-clock for the jumpscare beat (2s real). */
    var rawReal = raw > 1 ? 1 : raw;
    if (raw > CLAMP_DT) raw = CLAMP_DT;
    if (state === "paused" || loopPaused) {
      if (!pausedRendered) {
        pausedRendered = true;
        try {
          renderFrame();
        } catch (err) {
          /* ignore */
        }
      }
      return;
    }
    pausedRendered = false;
    elapsed += raw;

    /* World ambience runs in every state except paused. */
    if (state !== "paused" && world && world.update) {
      try {
        world.update(raw, elapsed);
      } catch (err) {
        /* x */
      }
    }

    if (state === "playing") {
      acc += raw;
      var n = 0;
      while (acc >= FIXED && n < MAX_STEPS) {
        step(FIXED);
        acc -= FIXED;
        n++;
      }
      if (n === MAX_STEPS) acc = 0;
      if (UI && UI.setNoise && player) {
        try {
          UI.setNoise(player.noiseLevel());
        } catch (err) {
          /* x */
        }
      }
      updatePrompt();
      /* Stage 2+3: director at 4Hz, jumpscare beat at 2s. */
      alertTick += raw;
      if (alertTick >= 0.25) {
        alertTick = 0;
        try {
          directorTick();
        } catch (err) {
          /* x */
        }
      }
      if (jumpscare) {
        jumpscareT += rawReal;
        if (vfx) {
          try {
            vfx.addTrauma(0.06);
          } catch (err) {
            /* x */
          }
        }
        if (jumpscareT >= 2) enterGameOver();
      }
    } else if (state === "menu" && camera) {
      /* Slow menu drift over the spawn vista (frozen when reduced motion). */
      var sway = 0;
      var rm = false;
      try {
        rm =
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (err) {
        rm = false;
      }
      if (!rm) sway = Math.sin(elapsed * 0.25) * 0.12;
      camera.position.set(spawn.x, 1.6, spawn.z);
      camera.rotation.set(-0.03, (spawn.ry || 0) + sway, 0);
    }

    try {
      renderFrame();
    } catch (err) {
      /* surface lost; next frame retries */
    }

    /* FPS meter + auto quality step-down + debug overlay. */
    frames++;
    fpsWindow += raw;
    if (fpsWindow >= 0.5) {
      fpsShown = Math.round(frames / fpsWindow);
      frames = 0;
      fpsWindow = 0;
      if (state === "playing") {
        if (fpsShown < AUTO_FPS) lowTime += 0.5;
        else lowTime = 0;
        if (lowTime >= AUTO_SECS && settings.quality !== "Low") {
          var next = stepQualityDown();
          applyQuality(next);
          persist();
          if (UI && UI.syncSettings) {
            try {
              UI.syncSettings(settings);
            } catch (err) {
              /* x */
            }
          }
          toast("Quality: " + next + " (auto)");
          lowTime = 0;
        }
      }
      if (DEBUG && dbgEl && player) {
        try {
          var p = player.pos();
          var ag = "";
          try {
            /* Shared 4Hz sample: always identical to the HUD readout. */
            ag =
              "  AG " +
              esCache.state +
              " S" +
              esCache.suspicion +
              " " +
              esCache.dist +
              "m";
            ag += " " + (window.__stvAgathaTier || "?");
          } catch (e2) {
            /* x */
          }
          dbgEl.textContent =
            "FPS " +
            fpsShown +
            "  XYZ " +
            p.x.toFixed(1) +
            " / " +
            p.y.toFixed(1) +
            " / " +
            p.z.toFixed(1) +
            ag;
        } catch (err) {
          /* x */
        }
      }
    }
  }

  function renderIntroCards() {
    var menu = $("menu");
    if (!menu || !Story.INTRO || !Story.INTRO.length) return;
    var box = $("intro-cards") || $("story-cards") || $("menu-cards");
    if (!box) {
      try {
        box = document.createElement("div");
        box.id = "intro-cards";
        var anchor = $("menu-start") || $("btn-start");
        if (anchor && anchor.parentNode === menu)
          menu.insertBefore(box, anchor);
        else menu.appendChild(box);
      } catch (err) {
        return;
      }
    }
    try {
      box.textContent = "";
      /* Compact inline styling (own nodes only): keep menu above the fold. */
      var bs = box.style;
      bs.display = "flex";
      bs.flexDirection = "column";
      bs.gap = "8px";
      bs.maxWidth = "560px";
      bs.margin = "2px 0";
    } catch (err) {
      /* x */
    }
    var i;
    for (i = 0; i < Story.INTRO.length; i++) {
      (function (card) {
        var d = document.createElement("div");
        d.className = "intro-card";
        var h = document.createElement("h3");
        h.textContent = card.title || "";
        var hs = h.style;
        hs.margin = "0";
        hs.fontSize = "15px";
        hs.fontWeight = "normal";
        hs.letterSpacing = "0.12em";
        hs.color = "#ffb14e";
        var p = document.createElement("p");
        p.textContent = card.body || card.text || "";
        var ps = p.style;
        ps.margin = "2px 0 0";
        ps.fontSize = "14px";
        ps.lineHeight = "1.45";
        ps.color = "#cbbf9f";
        d.appendChild(h);
        d.appendChild(p);
        box.appendChild(d);
      })(Story.INTRO[i]);
    }
  }

  function renderTitle() {
    try {
      document.title = Story.TITLE || document.title;
    } catch (err) {
      /* x */
    }
    var t = $("menu-title") || $("game-title");
    if (!t) {
      try {
        t = document.querySelector("#menu h1");
      } catch (err) {
        t = null;
      }
    }
    if (t) t.textContent = Story.TITLE || "";
  }

  function wireKeys() {
    document.addEventListener(
      "keydown",
      function (ev) {
        var c = ev.code || "";
        if (
          c === "Space" ||
          c === "ArrowUp" ||
          c === "ArrowDown" ||
          c === "ArrowLeft" ||
          c === "ArrowRight" ||
          c === "Tab"
        ) {
          try {
            ev.preventDefault();
          } catch (err) {
            /* x */
          }
        }
        keys[c] = true;
        if (ev.repeat) return;
        if (c === "Escape" || c === "KeyP") togglePause();
        else if (c === "Space" || c === "KeyF") fireWeapon();
        else if (c === "KeyR") reloadWeapon();
        else if (c === "Digit1") selectWeapon(0);
        else if (c === "Digit2") selectWeapon(1);
        else if (c === "Digit3") selectWeapon(2);
        else if (c === "KeyQ") selectWeapon(curWep + 1);
        else if (c === "KeyE") doInteract();
        else if (c === "KeyC") toggleCrouch();
        else if (c === "KeyT") toggleTorch();
        else if (c === "KeyM") toggleMute();
        else if (c === "Enter" && state === "menu") startGame();
      },
      false,
    );
    document.addEventListener(
      "keyup",
      function (ev) {
        keys[ev.code || ""] = false;
      },
      false,
    );
    /* Edge-triggered auto-pause: only a true held->lost transition pauses.
     * Stale duplicate unlock events (rapid pause/resume, late delivery)
     * arrive with haveLock already false and must not steal gameplay. */
    var haveLock = false;
    document.addEventListener(
      "pointerlockchange",
      function () {
        var locked = false;
        try {
          locked = !!document.pointerLockElement;
        } catch (err) {
          locked = false;
        }
        if (locked) {
          haveLock = true;
          return;
        }
        var was = haveLock;
        haveLock = false;
        if (was && state === "playing") pauseGame();
      },
      false,
    );
    document.addEventListener(
      "pointerlockerror",
      function () {
        /* Keep playing with drag-look fallback. */
      },
      false,
    );
    window.addEventListener(
      "message",
      function (ev) {
        if (ev && ev.data && ev.data.type === "ags-pause") {
          pauseGame();
        } else if (ev && ev.data && ev.data.type === "ags-resume-loop") {
          loopPaused = false;
          pausedRendered = false;
        }
      },
      false,
    );
    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.hidden || document.visibilityState === "hidden") {
          pauseGame();
        }
      },
      false,
    );
    window.addEventListener(
      "pagehide",
      function () {
        pauseGame();
      },
      false,
    );
    window.addEventListener(
      "blur",
      function () {
        keys = {};
        pauseGame();
      },
      false,
    );
  }

  function wireCanvasClick() {
    if (!container) return;
    container.addEventListener(
      "mousedown",
      function (ev) {
        if (state !== "playing") return;
        if (ev.button === 2) {
          if (player && player.setADS) player.setADS(!player.isADS());
          return;
        }
        requestLock();
        fireHeld = true;
        fireWeapon();
      },
      false,
    );
    window.addEventListener("mouseup", function () { fireHeld = false; }, false);
    container.addEventListener("contextmenu", function (ev) {
      try { ev.preventDefault(); } catch (e) {}
    }, false);

    var bFire = $("btn-fire");
    if (bFire) {
      function fDown(ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        fireHeld = true;
        fireWeapon();
      }
      function fUp(ev) {
        try { if (ev) ev.preventDefault(); } catch (e) {}
        fireHeld = false;
      }
      bFire.addEventListener("pointerdown", fDown, false);
      bFire.addEventListener("pointerup", fUp, false);
      bFire.addEventListener("pointercancel", fUp, false);
      bFire.addEventListener("touchstart", fDown, { passive: false });
      bFire.addEventListener("touchend", fUp, false);
      bFire.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        fireWeapon();
      }, false);
    }
    var bAds = $("btn-ads");
    if (bAds) {
      bAds.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        if (player && player.setADS) {
          var nextAds = !player.isADS();
          player.setADS(nextAds);
          bAds.classList.toggle("on", nextAds);
        }
      }, false);
    }
    var bRel = $("btn-reload");
    if (bRel) {
      bRel.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        reloadWeapon();
      }, false);
    }
    var bWep = $("btn-weapon");
    if (bWep) {
      bWep.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        selectWeapon(curWep + 1);
      }, false);
    }
    var bPauseHud = $("btn-pause-hud");
    if (bPauseHud) {
      bPauseHud.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        togglePause();
      }, false);
    }
  }

  function boot() {
    if (!window.THREE) {
      var msg = "THREE failed to load — check vendor script tags.";
      try {
        console.error("[stv] " + msg);
      } catch (err) {
        /* x */
      }
      var c0 = $("canvas-container");
      if (c0) c0.textContent = msg;
      return;
    }

    container = $("canvas-container") || document.body;
    lockEl = container;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      container.textContent = "WebGL unavailable in this browser.";
      return;
    }
    try {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
    } catch (err) {
      /* use defaults */
    }

    scene = new THREE.Scene();
    try {
      scene.fog = new THREE.FogExp2(0x060a0e, 0.045);
      scene.userData.renderer = renderer;
    } catch (err) {
      /* x */
    }

    camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    try {
      scene.add(camera);
    } catch (err) {
      /* x */
    }

    /* Small screens start one notch down; desktops start at saved/High. */
    try {
      var small =
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches &&
        Math.min(window.screen.width || 9999, window.screen.height || 9999) <
          800;
      if (small && settings.quality === "High") settings.quality = "Med";
    } catch (err) {
      /* x */
    }
    applyQuality(settings.quality);
    onResize();
    window.addEventListener("resize", onResize, false);
    /* HN2: build the post chain once the renderer/scene/camera exist
     * (no-op on Low or when a pass is missing — direct render stands). */
    try {
      buildPost();
    } catch (err) {
      /* x */
    }

    if (window.StV_Levels && window.StV_Levels.buildWorld) {
      try {
        world = window.StV_Levels.buildWorld(scene);
      } catch (err) {
        try {
          console.error("[stv] buildWorld failed", err);
        } catch (e) {
          /* x */
        }
        world = null;
      }
    }
    if (!world) {
      world = {
        colliders: [],
        spawn: { x: 0, z: 8.5, ry: 0 },
        bounds: { x0: -12, z0: -9, x1: 12, z1: 9 },
        keyMesh: null,
        chapelDoor: null,
        update: function () {
          /* empty preview until Task 2 lands */
        },
      };
    }
    colliders = world.colliders || [];
    bounds = world.bounds || bounds;
    spawn = world.spawn || spawn;

    if (window.StV_Player) {
      try {
        player = window.StV_Player.create(camera, colliders, bounds);
        player.setSensitivity(settings.sensitivity);
        player.reset(spawn.x, spawn.z, spawn.ry || 0);
        player.setTorch(true);
        player.setEnabled(false);
        player.onStep = function (run) {
          if (Audio8 && Audio8.footstep) {
            try {
              var crouchNow = false;
              try {
                crouchNow = player && player.isCrouch ? !!player.isCrouch() : false;
              } catch (e) {
                /* x */
              }
              Audio8.footstep(run, crouchNow);
            } catch (err) {
              /* x */
            }
          }
        };
      } catch (err) {
        try {
          console.error("[stv] player failed", err);
        } catch (e) {
          /* x */
        }
        player = null;
      }
    }

    if (window.StV_VFX) {
      try {
        vfx = window.StV_VFX.create(scene, renderer);
        window.StV_VFXHook = vfx;
      } catch (err) {
        vfx = null;
      }
    }

    /* Stage 2+3: Mother Agatha. The game boots without her rather than
     * crashing when the enemy module is missing. */
    if (window.StV_Enemy) {
      try {
        enemy = window.StV_Enemy.create(scene, colliders, bounds, player);
        if (enemy) {
          if (enemy.reset) enemy.reset();
          if (enemy.onCaught) enemy.onCaught(handleCaught);
        }
      } catch (err) {
        try {
          console.error("[stv] enemy failed", err);
        } catch (e) {
          /* x */
        }
        enemy = null;
      }
    }

    if (Audio8) {
      try {
        Audio8.setVolume(settings.volume);
      } catch (err) {
        /* x */
      }
      try {
        Audio8.setMuted(settings.mute);
      } catch (err) {
        /* x */
      }
    }

    if (UI && UI.bind) {
      try {
        UI.bind({
          settings: settings,
          getPlayer: function () {
            return player;
          },
          isPlaying: function () {
            return state === "playing";
          },
          getMuted: function () {
            return !!settings.mute;
          },
          onStart: startGame,
          onResume: resumeGame,
          onRestart: restartGame,
          onQuit: quitToMenu,
          onTorch: toggleTorch,
          onCrouch: toggleCrouch,
          onAct: doInteract,
          onVolume: function (v) {
            if (typeof v === "number" && isFinite(v)) {
              settings.volume = Math.min(1, Math.max(0, v));
              if (Audio8 && Audio8.setVolume) {
                try {
                  Audio8.setVolume(settings.volume);
                } catch (err) {
                  /* x */
                }
              }
              persist();
            }
          },
          onQuality: function (q) {
            applyQuality(q);
            persist();
            if (UI && UI.syncSettings) {
              try {
                UI.syncSettings(settings);
              } catch (err) {
                /* x */
              }
            }
          },
          onSensitivity: function (v) {
            if (typeof v === "number" && isFinite(v)) {
              settings.sensitivity = Math.min(2, Math.max(0.5, v));
              if (player) {
                try {
                  player.setSensitivity(settings.sensitivity);
                } catch (err) {
                  /* x */
                }
              }
              persist();
            }
          },
          onMute: function (m) {
            settings.mute = !!m;
            if (Audio8 && Audio8.setMuted) {
              try {
                Audio8.setMuted(settings.mute);
              } catch (err) {
                /* x */
              }
            }
            if (settings.mute) {
              try {
                if (window.speechSynthesis && window.speechSynthesis.cancel) {
                  window.speechSynthesis.cancel();
                }
              } catch (err) {
                /* x */
              }
            }
            persist();
            if (UI && UI.syncSettings) {
              try {
                UI.syncSettings(settings);
              } catch (err) {
                /* x */
              }
            }
          },
          onDifficulty: function (d) {
            if (d === "Easy" || d === "Normal" || d === "Hard") {
              settings.difficulty = d;
              persist();
              if (UI && UI.syncSettings) {
                try {
                  UI.syncSettings(settings);
                } catch (err) {
                  /* x */
                }
              }
              toast("Agatha: " + d);
            }
          },
        });
      } catch (err) {
        try {
          console.error("[stv] ui bind failed", err);
        } catch (e) {
          /* x */
        }
      }
    }

    renderTitle();
    renderIntroCards();
    resetRun();
    if (player) player.setEnabled(false);
    syncTouchBtn();
    show("menu");

    tmpV = new THREE.Vector3();

    if (DEBUG) {
      try {
        dbgEl = $("debug");
        if (dbgEl) {
          dbgEl.classList.remove("hidden");
        } else {
          dbgEl = document.createElement("div");
          dbgEl.setAttribute(
            "style",
            "position:absolute;top:8px;right:8px;z-index:60;" +
              "padding:4px 8px;font:12px monospace;color:#7fd4ff;" +
              "background:rgba(0,0,0,0.55);border-radius:4px;pointer-events:none;",
          );
          document.body.appendChild(dbgEl);
        }
        dbgEl.textContent = "FPS --";
      } catch (err) {
        dbgEl = null;
      }
    }

    window.game = {
      scene: scene,
      player: player,
      enemy: enemy,
      world: world,
      fire: fireWeapon,
      reload: reloadWeapon,
      switchWeapon: selectWeapon,
      getShooterStats: function () {
        return {
          hp: playerHP,
          kills: zombieKills,
          weapon: WEAPONS[curWep].name,
          mag: WEAPONS[curWep].mag,
          reserve: WEAPONS[curWep].reserve,
          hordeCount: hordeZombies.length
        };
      },
      getState: function () {
        return state;
      },
      pause: pauseGame,
      resume: resumeGame,
      warp: function (x, z) {
        if (!player) return;
        var cx = Math.min(bounds.x1 - 0.5, Math.max(bounds.x0 + 0.5, +x || 0));
        var cz = Math.min(bounds.z1 - 0.5, Math.max(bounds.z0 + 0.5, +z || 0));
        player.reset(cx, cz);
      },
      /* Stage 2+3: debug win grants the key, warps to the chapel
       * door-front, and presses E — one call still clears. */
      win: function () {
        if (state !== "playing") return;
        if (!keyFound) {
          keyFound = true;
          if (world && world.keyMesh) {
            try {
              world.keyMesh.visible = false;
            } catch (err) {
              /* x */
            }
          }
          if (UI && UI.setKey) {
            try {
              UI.setKey(true);
            } catch (err) {
              /* x */
            }
          }
          tintDoor(true);
          if (UI && UI.setObjective) {
            try {
              UI.setObjective(Story.OBJECTIVES[1] || "");
            } catch (err) {
              /* x */
            }
          }
        }
        if (player) {
          try {
            player.reset(0, -7.0);
          } catch (err) {
            /* x */
          }
        }
        doInteract();
      },
      giveAll: function () {
        if (state === "playing" && window.game && window.game.win)
          window.game.win();
      },
      /* Stage 2+3 debug: force the onCaught path. */
      die: function () {
        handleCaught();
      },
    };

    wireKeys();
    wireCanvasClick();
    started = true;
    lastT = performance.now();
    renderer.setAnimationLoop(frame);
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, false);
    } else {
      boot();
    }
  } catch (err) {
    try {
      console.error("[stv] boot failed", err);
    } catch (e) {
      /* x */
    }
  }
})();
