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
    if (UI && UI.show) {
      try {
        UI.show(name);
      } catch (err) {
        /* x */
      }
    }
    /* Subagent D: the KINDLING veil (index.html) has no other owner —
     * drop it the moment any overlay state paints. */
    try {
      var l = $("loading");
      if (l) l.classList.add("hidden");
    } catch (err) {
      /* x */
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
    /* Subagent D: Hollow Lantern run reset — lives, checkpoint, win
     * flag, crumble/mover dynamics, shard visuals, wraith zone. */
    if (platformMode()) {
      timerMs = 0;
      keys = {};
      alertTick = 0;
      platLives = 3;
      platWon = false;
      platCheckpoint = null;
      platZone = 0;
      platCamInit = false;
      platPosCache = null;
      platHudT = 99;
      try {
        if (window.Levels && window.Levels.resetDynamics) {
          window.Levels.resetDynamics();
        }
      } catch (eDyn) {
        /* x */
      }
      try {
        if (window.Levels && window.Levels.resetOrbs) window.Levels.resetOrbs();
      } catch (eOrb) {
        /* x */
      }
      try {
        if (platCtl) platCtl.reset();
      } catch (eCtl) {
        /* x */
      }
      try {
        if (platWraith) {
          if (platWraith.rehome) platWraith.rehome(ZONE_WPS[0]);
          else platWraith.reset();
        }
      } catch (eWr) {
        /* x */
      }
      try {
        if (vfx && vfx.reset) vfx.reset();
      } catch (eVfx) {
        /* x */
      }
      platHud();
      return;
    }
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
    /* Subagent D: side-view needs no pointer lock; greet with the zone hint. */
    if (!platformMode()) requestLock();
    if (UI && UI.banner) {
      try {
        if (platformMode()) {
          var hint0 = "Follow the fireflies. Mind the still water.";
          try {
            if (window.Levels && window.Levels.zones && window.Levels.zones[0]) {
              hint0 = window.Levels.zones[0].hint || hint0;
            }
          } catch (eHint) {
            /* default stands */
          }
          UI.banner(hint0, 5000);
        } else {
          UI.banner(Story.OBJECTIVES[0] || "", 5000);
        }
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
    if (!platformMode()) requestLock();
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
    if (!platformMode()) requestLock();
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
    /* Subagent C additive: E rings the soul bell in platform mode. */
    if (platformMode()) {
      if (state === "playing") platRingBell();
      return;
    }
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

  function step(dt) {
    /* Subagent C additive: platformer layer owns the fixed step when
     * the platform build opts in; horror path below is untouched. */
    if (platformMode()) {
      timerMs += dt * 1000;
      try {
        platTick(dt);
      } catch (err) {
        /* x */
      }
      return;
    }
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
    /* Subagent D: the wisp sends its own telemetry (zone/orbs/hearts/
     * wraith) so the director never answers with convent-horror lines. */
    var platMode = false;
    try {
      platMode = platformMode();
    } catch (ePM) {
      platMode = false;
    }
    if (platMode) {
      var pZone = "Whispering Roots";
      var pOrbs = 0;
      var pWraith = 99;
      try {
        if (window.Levels && window.Levels.zones && window.Levels.zones[platZone]) {
          pZone = window.Levels.zones[platZone].name || pZone;
        }
        if (platCtl) pOrbs = platCtl.state().orbs || 0;
        if (platWraith) pWraith = platWraith.getState().dist;
      } catch (eTel) {
        /* defaults stand */
      }
      body = {
        mode: "platform",
        room: pZone,
        zone: pZone,
        orbs: pOrbs,
        lives: platLives,
        won: !!platWon,
        enemyState: "WRAITH",
        dist: pWraith,
        survivalSec: Math.round(timerMs / 1000)
      };
    }
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
      /* Subagent D: convent-horror outputs stay in St. Vermilion —
       * the platformer only takes lore / wraith-boost / weather below. */
      try {
        if (!platMode && UI && typeof UI.aiPill === "function") {
          UI.aiPill(order.tactic || "stalk_shadow", order.envEvent || "storm_surge");
        }
      } catch (ePill) { /* x */ }
      try {
        if (!platMode && order.whisper && UI && UI.banner) {
          UI.banner(order.whisper, 6000);
        }
      } catch (eWh) { /* x */ }
      /* Subagent C additive: platformer director lines — Hindi/English
       * lore caption, wraith speed hook, and weather events
       * (spore_bloom / eclipse_mist / updraft_surge) forwarded to the
       * world hook when present. All fail-soft offline. */
      try {
        if (order.lore && UI && UI.lore) {
          UI.lore(order.lore, 6000);
        }
      } catch (eLore) { /* x */ }
      try {
        if (order.alertBoost && platWraith && platWraith.setDirectorBoost) {
          var ab = +order.alertBoost || 0;
          if (ab > 0) platWraith.setDirectorBoost(1 + Math.min(1.5, ab / 60), 8);
        }
      } catch (eBoost) { /* x */ }
      try {
        var pev = order.envEvent;
        if (
          pev === "spore_bloom" ||
          pev === "eclipse_mist" ||
          pev === "updraft_surge"
        ) {
          if (window.StV_Weather && typeof window.StV_Weather.apply === "function") {
            window.StV_Weather.apply(order);
          } else if (UI && UI.aiPill) {
            UI.aiPill(order.tactic || "drift", pev);
          }
          if (UI && UI.lore && !order.lore) {
            var wlore =
              pev === "spore_bloom"
                ? "Spore bloom… bijas tair rahe hain. (the spores drift)"
                : pev === "eclipse_mist"
                  ? "Eclipse mist… andhera gehra ho raha hai. (darkness deepens)"
                  : "Updraft surge… hawa upar uthati hai! (the wind lifts!)";
            UI.lore(wlore, 5000);
          }
        }
      } catch (eWx) { /* x */ }
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
  /* Subagent C additive: real-time hit-stop (timeScale dip that never
   * breaks the fixed 1/60 step) + platformer-layer runtime state.
   * Everything defaults OFF so the horror loop is byte-identical. */
  var hitStopT = 0;
  var hitSlow = 1;
  var platCtl = null;
  var platWraith = null;
  var platJumpQueued = false;
  var platDashQueued = false;
  var platGhostGold = false;
  var platSparkT = 0;
  var platCamX = 0;
  var platCamY = 1;
  var platCamInit = false;
  var platVis = null;
  /* Subagent D integration: Hollow Lantern run state. */
  var platPosCache = null;
  var platCheckpoint = null;
  var platLives = 3;
  var platWon = false;
  var platZone = 0;
  var platHudT = 99;
  var heroRig = null;
  var wraithRig = null;
  var ZONE_WPS = [
    [
      [-6, 1.6],
      [10, 1.6],
      [24, 4],
      [36, 6],
    ],
    [
      [50, 4],
      [66, 5],
      [88, 6],
      [100, 9],
    ],
    [
      [110, 6],
      [126, 11],
      [138, 18],
      [147, 25],
    ],
  ];

  /* 35ms hit-stop: freeze sim briefly, restore on real-time expiry.
   * Newest call owns the restore (overlapping hits never cut short). */
  function triggerHitStop(ms, slow) {
    var d = typeof ms === "number" && isFinite(ms) ? ms / 1000 : 0.035;
    if (d < 0.005) d = 0.005;
    if (d > 0.25) d = 0.25;
    hitStopT = Math.max(hitStopT, d);
    hitSlow = typeof slow === "number" && isFinite(slow) ? slow : 0.05;
    if (hitSlow < 0) hitSlow = 0;
    if (hitSlow > 1) hitSlow = 1;
  }

  try {
    window.__stvHitStop = triggerHitStop;
  } catch (err) {
    /* x */
  }

  /* Platformer layer engages ONLY when the platform build opts in:
   * window.__stvPlatformMode === true + StV_Platformer present. */
  function platformMode() {
    try {
      return (
        window.__stvPlatformMode === true && !!window.StV_Platformer
      );
    } catch (err) {
      return false;
    }
  }

  function platEnsure() {
    if (platCtl || !platformMode()) return platCtl;
    try {
      platCtl = window.StV_Platformer.create();
      if (window.StV_Wraith) {
        /* Subagent D: zone-1 patrol; platTick rehomes per zone. */
        platWraith = window.StV_Wraith.create({
          waypoints: ZONE_WPS[0]
        });
      }
      platCtl.onJump = function (jx, jy, kind) {
        try {
          if (Audio8 && Audio8.platJump) Audio8.platJump();
          if (vfx && vfx.dustPuff) vfx.dustPuff(jx, jy - 0.3, 0, kind === "double" ? 5 : 3);
        } catch (err) {
          /* x */
        }
      };
      platCtl.onLand = function (vy) {
        try {
          var hard = vy < -14;
          if (Audio8 && Audio8.platLand) Audio8.platLand(hard);
          if (vfx && vfx.dustPuff && camera) {
            var p = platCtl.pos();
            vfx.dustPuff(p.x, p.y - 0.3, 0, hard ? 7 : 4);
          }
          if (hard && vfx && vfx.addTrauma) vfx.addTrauma(0.18);
        } catch (err) {
          /* x */
        }
      };
      platCtl.onDash = function (dx, dy, ddx, ddy) {
        try {
          if (Audio8 && Audio8.dashWhoosh) Audio8.dashWhoosh();
          if (vfx && vfx.dashGhostBurst) {
            platGhostGold = !platGhostGold;
            vfx.dashGhostBurst(dx, dy, 0, ddx, ddy, platGhostGold);
          }
          if (vfx && vfx.addTrauma) vfx.addTrauma(0.12);
        } catch (err) {
          /* x */
        }
      };
      platCtl.onDashGhost = function (gx, gy) {
        try {
          if (vfx && vfx.dashGhost) {
            platGhostGold = !platGhostGold;
            vfx.dashGhost(gx, gy, 0, platGhostGold);
          }
        } catch (err) {
          /* x */
        }
      };
      platCtl.onWallSlide = function (sx, sy, dir) {
        platSparkT -= 1 / 60;
        if (platSparkT > 0) return;
        platSparkT = 0.09;
        try {
          if (vfx && vfx.wallSparks) vfx.wallSparks(sx, sy, 0, dir);
        } catch (err) {
          /* x */
        }
      };
      platCtl.onWallJump = function (wx, wy) {
        try {
          if (Audio8 && Audio8.platJump) Audio8.platJump();
          if (vfx && vfx.dustPuff) vfx.dustPuff(wx, wy, 0, 4);
        } catch (err) {
          /* x */
        }
      };
      /* Ori reset: 35ms hit-stop + shockwave ring + bell + refill. */
      platCtl.onReset = function (lx, ly) {
        try {
          triggerHitStop(35, 0.05);
          if (vfx && vfx.shockwave) {
            vfx.shockwave(lx, ly, 0, 0x9fe8ff);
            vfx.shockwave(lx, ly, 0, 0xffcf6e);
          }
          if (Audio8 && Audio8.lanternBell) Audio8.lanternBell();
          if (vfx && vfx.addTrauma) vfx.addTrauma(0.1);
          platHud();
        } catch (err) {
          /* x */
        }
      };
      platCtl.onOrb = function (ox, oy, idx) {
        try {
          if (Audio8 && Audio8.orbChime) Audio8.orbChime(idx);
          if (vfx && vfx.dustPuff) vfx.dustPuff(ox, oy, 0, 5);
          /* Subagent D: hide the collected shard sprite. */
          try {
            if (window.Levels && window.Levels.collectOrbAt) {
              window.Levels.collectOrbAt(ox, oy);
            }
          } catch (eShard) {
            /* x */
          }
          platHud();
          platMood();
        } catch (err) {
          /* x */
        }
      };
      /* Subagent D: hazards cost a heart and respawn at checkpoint. */
      platCtl.onHazard = function () {
        try {
          platDie("hazard");
        } catch (err) {
          /* x */
        }
      };
      platCtl.onStep = function () {
        try {
          if (Audio8 && Audio8.footstep) Audio8.footstep(false, false);
        } catch (err) {
          /* x */
        }
      };
      platHud();
      platMood();
      platFallbackVisuals();
      if (UI && UI.platformerTouch) {
        try {
          UI.platformerTouch();
        } catch (err) {
          /* x */
        }
      }
      /* Subagent D: hidden QA hooks (screenshots, playtest warps).
       * No UI, no gameplay effect unless called. */
      try {
        window.__stvPlatDebug = {
          state: function () {
            return platCtl ? platCtl.state() : null;
          },
          teleport: function (x, y) {
            if (!platCtl || !platCtl.teleport) return false;
            platCtl.teleport(x, y);
            try {
              if (world && world.rig) {
                world.rig.focus.x = x;
                world.rig.focus.y = y + 2;
                world.rig.lockedY = y + 2;
              }
            } catch (eRig) {
              /* x */
            }
            return true;
          },
          dash: function () {
            platDashQueued = true;
            return true;
          },
          jump: function () {
            platJumpQueued = true;
            return true;
          },
          zone: function () {
            return platZone;
          },
          won: function () {
            return !!platWon;
          }
        };
      } catch (err) {
        /* debug hook optional */
      }
    } catch (err) {
      platCtl = null;
    }
    return platCtl;
  }

  /* Subagent D: Hollow Light HUD — drive the native index.html chips
   * (shards / hearts / timer / dash cooldown) as the single HUD. The
   * StV-shell pip calls stay as no-op-safe fallbacks (their nodes are
   * never created here, so no duplicate readouts appear). */
  function platHud() {
    try {
      if (platCtl) {
        var st = platCtl.state();
        var total = 16;
        try {
          var D = window.StV_Platformer.levelData();
          if (D && D.orbs) total = D.orbs.length;
        } catch (eD) {
          /* 16 stands */
        }
        var sh = $("val-shards");
        if (sh) sh.textContent = st.orbs + " / " + total;
        var hh = $("val-hearts");
        if (hh) hh.textContent = String(platLives);
        var tt = $("val-timer");
        if (tt) tt.textContent = fmtPlatClock(timerMs);
        var di = $("dash-indicator");
        if (di) {
          if (st.dashReady) di.classList.remove("cooldown");
          else di.classList.add("cooldown");
        }
      }
      if (platCtl && UI) {
        var st2 = platCtl.state();
        if (UI.setDash) UI.setDash(st2.dashReady ? 1 : 0, 1);
        if (UI.setOrbs) UI.setOrbs(st2.orbs);
      }
    } catch (err) {
      /* x */
    }
  }

  function fmtPlatClock(ms) {
    var t = Math.max(0, ms / 1000);
    var mins = Math.floor(t / 60);
    var secs = Math.floor(t % 60);
    var tenth = Math.floor((t % 1) * 10);
    return (
      (mins < 10 ? "0" : "") +
      mins +
      ":" +
      (secs < 10 ? "0" : "") +
      secs +
      "." +
      tenth
    );
  }

  /* Subagent D: lose a heart, respawn at the last checkpoint (full
   * orb restore — forgiving by design); 0 hearts => game-over card. */
  function platDie(cause) {
    platLives = Math.max(0, platLives - 1);
    try {
      if (vfx) {
        if (cause === "hazard" && vfx.flashLightning) vfx.flashLightning();
        if (vfx.addTrauma) vfx.addTrauma(0.5);
      }
    } catch (err) {
      /* x */
    }
    if (platLives <= 0) {
      state = "gameover";
      try {
        exitLock();
      } catch (err) {
        /* x */
      }
      try {
        var orbs = platCtl ? platCtl.state().orbs : 0;
        var gs = $("gameover-stats");
        if (gs) {
          gs.textContent =
            "Shards " +
            orbs +
            " · Survived " +
            fmtPlatClock(timerMs) +
            (cause === "wraith"
              ? " · The wraith caught you… (phir se!)"
              : " · The dark stings… (dard hua!)");
        }
        var gt = $("gameover-title");
        if (gt) gt.textContent = "THE LIGHT FADES";
      } catch (err) {
        /* x */
      }
      show("gameover");
      try {
        if (Audio8 && Audio8.suspendAll) Audio8.suspendAll();
      } catch (err) {
        /* x */
      }
      platHud();
      return;
    }
    try {
      if (UI && UI.banner) {
        UI.banner(
          cause === "wraith"
            ? "The wraith caught you… (phir se!)"
            : "The dark stings… (dard hua!)",
          2500,
        );
      }
    } catch (err) {
      /* x */
    }
    try {
      if (window.Levels && window.Levels.resetOrbs) {
        window.Levels.resetOrbs();
      }
      if (platCtl) {
        if (platCheckpoint) {
          platCtl.reset(platCheckpoint.x, platCheckpoint.y + 1.2);
        } else {
          platCtl.reset();
        }
      }
      if (platWraith) platWraith.reset();
    } catch (err) {
      /* x */
    }
    platHud();
  }

  /* Subagent D: live solid under a foot point (movers/crumbles included). */
  function platSolidUnder(x, fy) {
    try {
      var list =
        (world && world.solids) ||
        (window.Levels && window.Levels.getSolids
          ? window.Levels.getSolids()
          : null);
      if (!list) return null;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || s.active === false) continue;
        if (x >= s.x0 && x <= s.x1 && Math.abs(s.y1 - fy) < 0.6) return s;
      }
    } catch (err) {
      /* x */
    }
    return null;
  }

  function makeGlowBillboard(color, size) {
    var tex = null;
    try {
      if (window.Levels && window.Levels.makeGlowSprite) {
        tex = window.Levels.makeGlowSprite(
          "rgba(255,255,255,1)",
          "rgba(255,255,255,0)",
        );
      }
    } catch (err) {
      tex = null;
    }
    var m = new THREE.SpriteMaterial({
      map: tex,
      color: color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    var s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  }

  /* Subagent D: wisp + wraith actors — real .glb (A's kit), radial glow
   * billboard until the model lands. Follows physics every step. */
  function platActorLoad(rig, url, fitSize, glowColor, glowSize) {
    var done = false;
    function place(root) {
      if (done) return;
      done = true;
      try {
        if (root) {
          if (window.Levels && window.Levels.fitGlb) {
            window.Levels.fitGlb(root, fitSize, null);
          }
          rig.group.add(root);
        } else {
          throw new Error("glb missing");
        }
      } catch (err) {
        try {
          rig.group.add(makeGlowBillboard(glowColor, glowSize));
        } catch (e2) {
          /* x */
        }
      }
    }
    try {
      if (window.Levels && window.Levels.loadGlb) {
        window.Levels.loadGlb(
          url,
          function (r) {
            place(r);
          },
          function () {
            place(null);
          },
        );
      } else if (window.THREE && window.THREE.GLTFLoader) {
        new window.THREE.GLTFLoader().load(
          url,
          function (g) {
            place((g && (g.scene || g)) || null);
          },
          undefined,
          function () {
            place(null);
          },
        );
      } else {
        place(null);
      }
    } catch (err) {
      place(null);
    }
  }

  function platActors() {
    if (!platformMode() || !platCtl || !scene || !window.THREE) return;
    try {
      if (!heroRig) {
        heroRig = { group: new THREE.Group() };
        scene.add(heroRig.group);
        var heroUrl = "./assets/spirit_hero.glb";
        try {
          if (window.Levels && window.Levels.ASSETS && window.Levels.ASSETS.hero) {
            heroUrl = window.Levels.ASSETS.hero;
          }
        } catch (eH) {
          /* default stands */
        }
        platActorLoad(heroRig, heroUrl, 1.15, 0x9fe8ff, 1.7);
      }
      if (!wraithRig) {
        wraithRig = { group: new THREE.Group() };
        scene.add(wraithRig.group);
        platActorLoad(
          wraithRig,
          "./assets/shadow_wraith.glb",
          1.35,
          0xff5a6e,
          1.9,
        );
      }
      var p = platCtl.pos();
      var st = platCtl.state();
      var bob = 0;
      try {
        bob =
          Math.sin(elapsed * 8) * 0.03 * Math.min(1, Math.abs(st.vx) / 7);
      } catch (eBob) {
        bob = 0;
      }
      heroRig.group.position.set(p.x, p.y - 0.1 + bob, 0.6);
      heroRig.group.scale.x = st.face >= 0 ? 1 : -1;
      try {
        if (platWraith && wraithRig) {
          var ws = platWraith.getState();
          wraithRig.group.visible = true;
          wraithRig.group.position.set(ws.x, ws.gy, 0.6);
          wraithRig.group.scale.x = ws.face >= 0 ? 1 : -1;
        } else if (wraithRig) {
          wraithRig.group.visible = false;
        }
      } catch (eW) {
        /* x */
      }
    } catch (err) {
      /* actors cosmetic */
    }
  }

  function platMood() {
    try {
      if (!Audio8 || !Audio8.setPlatformMood || !platCtl) return;
      var n = platCtl.state().orbs;
      Audio8.setPlatformMood(n >= 4 ? "ascent" : n >= 2 ? "clockwork" : "calm");
    } catch (err) {
      /* x */
    }
  }

  /* E in platform mode: ring the soul bell (swing + chord + caption). */
  function platRingBell() {
    try {
      if (window.Levels && window.Levels.ringBell) window.Levels.ringBell();
      if (Audio8 && Audio8.lanternBell) Audio8.lanternBell();
      if (UI && UI.lore) UI.lore("Ghanti baji… the lanterns listen. (E)", 2500);
    } catch (err) {
      /* x */
    }
  }

  /* Defensive fallback course visuals (PlaneGeometry PBR slabs +
   * THREE.Points orbs/lanterns; zero banned primitives). Only builds
   * when the platform level provides no visuals of its own. */
  function platFallbackVisuals() {
    if (platVis) return;
    /* Subagent D: the Levels world ships full visuals — fallback slabs
     * only exist for the standalone fallback course. */
    try {
      if (world && world.rig) {
        platVis = { group: null, skipped: true };
        return;
      }
    } catch (err) {
      /* x */
    }
    try {
      var T = window.THREE;
      var scene = window.__stvScene || (world && world.scene) || null;
      if (!T || !scene || !window.StV_Platformer) return;
      var D = window.StV_Platformer.levelData();
      var group = new T.Group();
      var rockMat = null;
      try {
        if (window.WorldRealism && window.WorldRealism.createProceduralPBRMaterial) {
          rockMat = window.WorldRealism.createProceduralPBRMaterial("rock", {});
        } else {
          rockMat = new T.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.9 });
        }
      } catch (err) {
        rockMat = new T.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.9 });
      }
      var k;
      for (k = 0; k < D.solids.length; k++) {
        var s = D.solids[k];
        var w = s.x1 - s.x0;
        var h = s.y1 - s.y0;
        if (!(w > 0) || !(h > 0)) continue;
        var top = new T.Mesh(new T.PlaneGeometry(w, 0.6), rockMat);
        top.rotation.x = -Math.PI / 2;
        top.position.set((s.x0 + s.x1) / 2, s.y1, 0);
        top.receiveShadow = true;
        group.add(top);
        var face = new T.Mesh(new T.PlaneGeometry(w, Math.min(1.2, h + 0.6)), rockMat);
        face.position.set((s.x0 + s.x1) / 2, s.y1 - Math.min(1.2, h + 0.6) / 2, 0.3);
        group.add(face);
      }
      scene.add(group);
      platVis = { group: group };
    } catch (err) {
      platVis = null;
    }
  }

  function platTick(dt) {
    var ctl = platEnsure();
    if (!ctl) return;
    var left = !!(keys.KeyA || keys.ArrowLeft);
    var right = !!(keys.KeyD || keys.ArrowRight);
    var up = !!(keys.KeyW || keys.ArrowUp || keys.Space);
    var down = !!(keys.KeyS || keys.ArrowDown);
    var jp = platJumpQueued;
    var dp = platDashQueued;
    platJumpQueued = false;
    platDashQueued = false;
    try {
      ctl.step(dt, {
        move: (right ? 1 : 0) - (left ? 1 : 0),
        jumpPressed: jp,
        jumpHeld: up,
        dashPressed: dp,
        dashX: (right ? 1 : 0) - (left ? 1 : 0),
        dashY: (up ? 1 : 0) - (down ? 1 : 0)
      });
    } catch (err) {
      /* x */
    }
    /* Subagent D: cache the live sample for the camera rig, then run
     * world dynamics (crumble triggers, mover carry, checkpoints,
     * zone handoff, goal bell). */
    try {
      var pst = ctl.state();
      platPosCache = {
        x: pst.x,
        y: pst.y,
        vx: pst.vx,
        vy: pst.vy,
        grounded: pst.grounded
      };
      var under = platSolidUnder(pst.x, pst.y - 0.4);
      if (under && under.type === "crumble" && window.Levels && window.Levels.stepOn) {
        try {
          window.Levels.stepOn(under.id);
        } catch (eStep) {
          /* x */
        }
      }
      if (under && under.type === "moving" && (under.dx || under.dy) && ctl.nudge) {
        try {
          ctl.nudge(under.dx, under.dy);
        } catch (eCarry) {
          /* x */
        }
      }
    } catch (err) {
      /* x */
    }
    /* Subagent D: zone handoff — the wraith rehomes to the wisp's zone. */
    try {
      if (window.Levels && window.Levels.zoneAt && platWraith && platCtl) {
        var zn = window.Levels.zoneAt(platCtl.state().x);
        if (zn !== platZone) {
          platZone = zn;
          if (platWraith.rehome) {
            platWraith.rehome(ZONE_WPS[zn] || ZONE_WPS[0]);
          }
          var zh =
            window.Levels.zones && window.Levels.zones[zn]
              ? window.Levels.zones[zn]
              : null;
          if (zh && UI && UI.banner) {
            UI.banner(zh.name + " — " + zh.hint, 4200);
          }
        }
      }
    } catch (err) {
      /* x */
    }
    /* Subagent D: checkpoints + summit goal. */
    try {
      if (platCtl && window.Levels) {
        var cst = platCtl.state();
        if (window.Levels.CHECKPOINTS) {
          var cps = window.Levels.CHECKPOINTS;
          for (var ci = 0; ci < cps.length; ci++) {
            var cp = cps[ci];
            if (
              (!platCheckpoint || cp.x > platCheckpoint.x) &&
              cst.x > cp.x - 1 &&
              Math.abs(cst.y - (cp.y + 1)) < 3
            ) {
              platCheckpoint = { x: cp.x, y: cp.y };
              if (UI && UI.banner) {
                UI.banner("Checkpoint — the light remembers.", 2200);
              }
            }
          }
        }
        if (!platWon && window.Levels.GOAL) {
          var G = window.Levels.GOAL;
          if (
            cst.x >= G.x0 &&
            cst.x <= G.x1 &&
            cst.y >= G.y0 &&
            cst.y <= G.y1
          ) {
            platWon = true;
            if (window.Levels.ringBell) window.Levels.ringBell();
            if (Audio8 && Audio8.lanternBell) Audio8.lanternBell();
            if (vfx && vfx.shockwave) {
              vfx.shockwave(cst.x, cst.y, 0, 0x9fe8ff);
              vfx.shockwave(cst.x, cst.y, 0, 0xffcf6e);
            }
            if (UI && UI.banner) {
              UI.banner(
                "The sanctuary bell rings — the Hollow Lantern is lit!",
                6000,
              );
            }
            if (UI && UI.lore) {
              UI.lore("Ghanti baj gayi… ujala laut aaya. (the light returns)", 6000);
            }
            if (Audio8 && Audio8.setPlatformMood) {
              Audio8.setPlatformMood("ascent");
            }
          }
        }
      }
    } catch (err) {
      /* x */
    }
    /* Shadow wraith hunt + catch check (0.7m). */
    try {
      if (platWraith) {
        var p = ctl.pos();
        platWraith.update(dt, p.x, p.y);
        var ws = platWraith.getState();
        if (ws.dist < 0.7) {
          /* Subagent D: a catch costs a heart (game over at zero). */
          platDie("wraith");
        }
      }
    } catch (err) {
      /* x */
    }
    /* Side-view follow camera (FPS rig retakes it when horror runs). */
    try {
      /* Subagent D: the Levels CameraRig owns the camera when the real
       * world is up (z=16, look-ahead, platform-lock, trauma); this
       * fallback only serves the standalone fallback course. */
      if (camera && !(world && world.rig)) {
        var cp2 = ctl.pos();
        var st2 = ctl.state();
        if (!platCamInit) {
          platCamX = cp2.x;
          platCamY = cp2.y + 1;
          platCamInit = true;
        }
        var kb = 1 - Math.exp(-6 * dt);
        platCamX += (cp2.x + st2.face * 1.2 - platCamX) * kb;
        platCamY += (cp2.y + 1.0 - platCamY) * kb;
        camera.position.set(platCamX, platCamY, 9.5);
        camera.lookAt(platCamX, platCamY - 0.2, 0);
      }
    } catch (err) {
      /* x */
    }
    /* Subagent D: wisp + wraith actors track physics every step. */
    try {
      platActors();
    } catch (err) {
      /* x */
    }
    /* Subagent D: HUD + timer at 4Hz (no per-frame DOM churn). */
    try {
      platHudT += dt;
      if (platHudT >= 0.25) {
        platHudT = 0;
        platHud();
      }
    } catch (err) {
      /* x */
    }
    if (vfx && camera) {
      try {
        vfx.update(dt, camera);
      } catch (err) {
        /* x */
      }
    }
  }

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
        /* Subagent D: feed the camera rig the live wisp sample (one
         * frame stale — platTick refreshes the cache right after). */
        if (platformMode() && platPosCache) {
          world.update(raw, elapsed, platPosCache);
        } else {
          world.update(raw, elapsed);
        }
      } catch (err) {
        /* x */
      }
    }

    if (state === "playing") {
      /* Subagent C additive: hit-stop dips accumulation in real time;
       * idle (hitStopT==0, hitSlow==1) is exactly the old `acc += raw`. */
      if (hitStopT > 0) {
        hitStopT -= raw;
        if (hitStopT <= 0) {
          hitStopT = 0;
          hitSlow = 1;
        }
      }
      acc += raw * hitSlow;
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
        /* Subagent C additive: platformer edge queue (A/D+arrows move,
         * W/Space jump, Shift/K dash). Horror keys map is untouched. */
        if (platformMode()) {
          if (c === "Space" || c === "KeyW" || c === "ArrowUp") {
            platJumpQueued = true;
          }
          if (c === "ShiftLeft" || c === "ShiftRight" || c === "KeyK") {
            platDashQueued = true;
          }
        }
        if (c === "Escape" || c === "KeyP") togglePause();
        else if (c === "KeyE") doInteract();
        else if (c === "KeyC") toggleCrouch();
        else if (c === "KeyT" || c === "KeyF") toggleTorch();
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
      "click",
      function () {
        if (state === "playing") requestLock();
      },
      false,
    );
  }

  function boot() {
    /* Subagent D: this shell now ships the Hollow Lantern platformer.
     * When the StV horror world is absent but Levels exists, opt the
     * platformer layer in BEFORE anything consults platformMode(). */
    try {
      if (!window.StV_Levels && window.Levels && window.Levels.buildWorld) {
        window.__stvPlatformMode = true;
      }
    } catch (err) {
      /* horror path stands */
    }
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
    /* Subagent D: the horror shell's dense fog (0.045) would drown the
     * side-view world (camera z=16, backdrop z=-28) in grey soup —
     * platform mode breathes cavern air instead. */
    try {
      if (platformMode()) scene.fog = new THREE.FogExp2(0x0a2022, 0.0045);
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
    /* Subagent D: Hollow Lantern world (B) + orb shard layer. The rig
     * owns the camera; game.js feeds it the live player sample. */
    if (!world && platformMode() && window.Levels && window.Levels.buildWorld) {
      try {
        world = window.Levels.buildWorld(scene, camera, renderer);
        try {
          if (window.Levels.buildOrbLayer) window.Levels.buildOrbLayer(scene);
        } catch (eOrb) {
          /* shards cosmetic */
        }
      } catch (err) {
        try {
          console.error("[hollow] buildWorld failed", err);
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

    /* Subagent D: no FPS torch rig or camera-child lantern in the
     * side-view platformer — the spirit wisp is the player. */
    if (window.StV_Player && !platformMode()) {
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
    /* Subagent D: Mother Agatha stays in St. Vermilion — the shadow
     * wraith (StV_Wraith, created per-zone in platEnsure) hunts here. */
    if (window.StV_Enemy && !platformMode()) {
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
          onJump: function () {
            platJumpQueued = true;
          },
          onDash: function () {
            platDashQueued = true;
          },
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

    /* Subagent D: Hollow Light ships its own menu title + story line
     * in index.html — the StV fallback must not overwrite them. */
    if (!platformMode()) {
      renderTitle();
      renderIntroCards();
    }
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
