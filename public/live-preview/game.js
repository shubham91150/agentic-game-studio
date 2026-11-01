/* Horizon Sprint — game.js
 * Boot + fixed-timestep loop + state machine + chase camera + race control.
 * States: menu -> countdown -> racing <-> paused -> finished.
 * Skills applied: game-pipeline, game-logic, ui-taste, threejs, browser-game (Compact). */
(function () {
  "use strict";
  window.G = window.G || {};
  var G = window.G;

  var STEP = 1 / 60;
  var POS_STR = ["1ST", "2ND", "3RD", "4TH"];
  var CAMS = [
    { d: 8.5, h: 3.1 },
    { d: 12.5, h: 4.6 },
    { d: -0.4, h: 1.34 },
  ];

  var qs = new URLSearchParams(location.search);
  var TESTMODE = qs.get("testdrive") === "1";
  var SHOWFPS = qs.get("fps") === "1";
  var DEBUGMODE = qs.get("debug") === "1";
  var QOVERRIDE = qs.get("q");

  // ---------- boot ----------
  if (!window.THREE) {
    document.getElementById("fatal").textContent =
      "3D engine failed to load. Check connection and reload.";
    document.getElementById("fatal").classList.remove("hidden");
    return;
  }
  var container = document.getElementById("canvas-container") || document.body;
  container.style.touchAction = "none";

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (e) {
    G.UI.fatal("WebGL is not available in this browser.");
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(68, 1, 0.1, 3000);

  function boot() {
    var save = G.Save.load();
    var world = G.buildWorld(scene, renderer);
    world.scene = scene;
    G.VFX.init(scene);

    // ---------- cars ----------
    var player = G.createCar(world, {
      color: save.color,
      name: "YOU",
      isPlayer: true,
      num: 7,
    });
    var ais = G.AI_DEFS.map(function (def, i) {
      return G.createAI(world, def, i);
    });
    var cars = [player].concat(ais);
    if (TESTMODE) player.ai = { lane: 0.4, skill: 0.96, avoid: 0, wob: 0 };
    G.placeCarOnGrid(player, world, 3);
    player.sens = save.sens / 100;

    // ---------- state ----------
    var state = "menu",
      pausedPrev = "racing";
    var raceTime = 0,
      countT = 0,
      countStep = -1;
    var CAMQ = qs.get("cam");
    var camMode =
        CAMQ === "0" || CAMQ === "1" || CAMQ === "2" ? parseInt(CAMQ, 10) : 0,
      trauma = 0;
    // Stage 1: hit-stop (real-time restore, newest trigger owns restore) +
    // smoothed shake targets (two random targets refreshed ~30Hz, lerped —
    // never raw per-frame Math.random). Preallocated, no per-frame new.
    var timeScale = 1,
      hitStopEnd = 0,
      hitStopCool = 0;
    var shakeT = 0,
      shakeCur = [0, 0, 0, 0],
      shakeNxt = [0, 0, 0, 0];
    var scrapePrev = false;
    // Stage 2: 5-gear RPM state for audio (upshift thresholds + hysteresis).
    var audioGear = 1;
    var GEAR_UPS = [0.18, 0.36, 0.55, 0.75];
    var camPos = new THREE.Vector3(),
      camLook = new THREE.Vector3();
    var camInit = false;
    var menuAngle = 0,
      skidT = 0,
      dustT = 0;
    var sessionBest = save.best;
    var reducedMotion =
      window.matchMedia &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    var fpsAcc = 0,
      fpsN = 0,
      fpsAvg = 60,
      lowT = 0,
      fpsUiT = 0;

    function applyQuality(q) {
      save.quality = q;
      var dpr = window.devicePixelRatio || 1;
      // Hard pixel-ratio cap at 1.5 everywhere (even desktop HIGH). Fill-rate
      // is the #1 frame killer for this PBR-heavy scene (normal-mapped terrain
      // + water + grass over a large area), so 1.5 is plenty sharp and ~1.8x
      // less fragment work than the old desktop HIGH cap of 2. LOW stays 1.
      var cap = q === 0 ? 1 : 1.5;
      renderer.setPixelRatio(Math.min(dpr, cap));
      world.setQuality(q);
      G.VFX.setAmbient(q > 0);
      onResize();
    }

    // ---------- UI wiring ----------
    var UI = G.UI;
    UI.init({
      onStart: function () {
        startRace();
      },
      onClick: function () {
        G.AudioSys.click();
      },
      onResume: function () {
        resumeGame();
      },
      onRestart: function () {
        startRace();
      },
      onQuit: function () {
        quitToMenu();
      },
      onCam: function () {
        cycleCam();
      },
      onMute: function () {
        setMuted(!save.muted);
      },
      onMuteSet: function (m) {
        setMuted(m);
      },
      onPauseBtn: function () {
        togglePause();
      },
      onVolume: function (v) {
        save.volume = Math.round(v * 100);
        G.AudioSys.setVolume(v);
        G.Save.save();
      },
      onQuality: function (q) {
        applyQuality(q);
        G.Save.save();
      },
      onSens: function (s) {
        save.sens = Math.round(s * 100);
        player.sens = s;
        G.Save.save();
      },
      onColor: function (c) {
        save.color = c;
        G.Save.save();
        player.mesh.paint.color.set("rgb(" + c + ")");
        G.AudioSys.click();
      },
      onColorblind: function (on) {
        save.colorblind = !!on;
        G.Save.save();
        paintAIs();
        UI.toast(on ? "COLORBLIND-SAFE ON" : "COLORBLIND-SAFE OFF", 1200);
      },
      onSubs: function (on) {
        save.subs = !!on;
        G.Save.save();
      },
      onRemap: function (which, btn) {
        btn.textContent = "...";
        function once(e) {
          e.preventDefault();
          window.removeEventListener("keydown", once, true);
          if (e.code && e.code !== "Escape") {
            save.keys[which] = e.code;
            G.Save.save();
          }
          UI.syncPauseOptions(save);
        }
        window.addEventListener("keydown", once, true);
      },
    });
    UI.syncPauseOptions(save);
    UI.selectSwatch(save.color);
    paintAIs();
    UI.setMuteLabel(save.muted);
    UI.setCamLabel(camMode);
    UI.minimapInit(world.track);
    G.AudioSys.setVolume(save.volume / 100);
    G.AudioSys.setMuted(save.muted);
    applyQuality(save.quality);
    if (QOVERRIDE === "0" || QOVERRIDE === "1" || QOVERRIDE === "2")
      applyQuality(parseInt(QOVERRIDE, 10));
    if (SHOWFPS || DEBUGMODE)
      document.getElementById("fps").classList.remove("hidden");

    function setMuted(m) {
      save.muted = m;
      G.Save.save();
      G.AudioSys.setMuted(m);
      UI.setMuteLabel(m);
      UI.syncPauseOptions(save);
    }
    function cycleCam() {
      camMode = (camMode + 1) % 3;
      UI.setCamLabel(camMode);
    }

    // Accessibility: colorblind-safe rival palette (Okabe-Ito blue/orange/yellow).
    var CB_COLORS = ["0,114,178", "230,159,0", "240,228,66"];
    function paintAIs() {
      for (var i = 0; i < ais.length; i++) {
        var c = save.colorblind
          ? CB_COLORS[i % CB_COLORS.length]
          : G.AI_DEFS[i % G.AI_DEFS.length].color;
        ais[i].mesh.paint.color.set("rgb(" + c + ")");
      }
    }

    // ---------- input ----------
    var keys = {};
    var GAMEKEYS = {
      ArrowUp: 1,
      ArrowDown: 1,
      ArrowLeft: 1,
      ArrowRight: 1,
      Space: 1,
    };
    window.addEventListener("keydown", function (e) {
      if (GAMEKEYS[e.code]) e.preventDefault();
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === "Escape" || e.code === "KeyP") togglePause();
      if (e.code === "KeyC" && (state === "racing" || state === "countdown"))
        cycleCam();
      if (e.code === "KeyM") setMuted(!save.muted);
      if (e.code === "KeyR" && state === "racing") {
        G.resetCarToTrack(player, world);
        UI.toast("BACK ON TRACK", 900);
      }
      if (e.code === "Enter" && state === "menu") startRace();
    });
    window.addEventListener("keyup", function (e) {
      keys[e.code] = false;
    });
    window.addEventListener("blur", function () {
      keys = {};
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && (state === "racing" || state === "countdown"))
        togglePause(true);
    });

    function playerInput() {
      var t = UI.touch;
      var th = 0,
        st = 0;
      if (keys.KeyW || keys.ArrowUp || t.gas) th += 1;
      if (keys.KeyS || keys.ArrowDown || t.brake) th -= 1;
      if (keys[save.keys.left] || keys.KeyA || keys.ArrowLeft || t.left)
        st -= 1;
      if (keys[save.keys.right] || keys.KeyD || keys.ArrowRight || t.right)
        st += 1;
      return {
        throttle: th,
        steer: st,
        hand: !!(keys.Space || (t.brake && t.gas)),
        nitro: !!(keys.ShiftLeft || keys.ShiftRight || t.nitro),
      };
    }

    // ---------- race control ----------
    function resetGrid() {
      G.placeCarOnGrid(player, world, 3);
      for (var i = 0; i < ais.length; i++) G.placeCarOnGrid(ais[i], world, i);
      cars.forEach(function (c) {
        c.lapStart = 0;
        c.finishScore = 0;
        // Stage 1: reset juice state (drift edge, suspension spring).
        c._wasDrifting = false;
        c._susp = 0;
        c._suspV = 0;
        c._prevY = c.y || 0;
        c._prevVy = 0;
        c._prevSpd = 0;
      });
      G.VFX.reset();
      camInit = false;
      trauma = 0;
      timeScale = 1;
      hitStopEnd = 0;
      hitStopCool = 0;
      scrapePrev = false;
      audioGear = 1;
    }

    function startRace() {
      G.AudioSys.init();
      G.AudioSys.click();
      resetGrid();
      raceTime = 0;
      countT = 0;
      countStep = -1;
      sessionBest = save.best;
      state = "countdown";
      UI.showMenu(false);
      UI.showResults(false);
      UI.showPause(false);
      UI.showHud(true);
      UI.setWrongWay(false);
      UI.minimapDraw(cars);
    }

    function resumeGame() {
      if (state !== "paused") return;
      G.AudioSys.click();
      state = pausedPrev;
      UI.showPause(false);
    }

    function togglePause(force) {
      if (state === "paused" && !force) {
        resumeGame();
        return;
      }
      if (state !== "racing" && state !== "countdown") return;
      pausedPrev = state;
      state = "paused";
      UI.syncPauseOptions(save);
      UI.showPause(true);
      G.AudioSys.silence();
    }

    function quitToMenu() {
      G.AudioSys.click();
      state = "menu";
      resetGrid();
      UI.showPause(false);
      UI.showResults(false);
      UI.showHud(false);
      UI.showMenu(true);
      UI.setCountdown(null);
      UI.setWrongWay(false);
      G.AudioSys.silence();
    }

    function playerRank() {
      var order = cars.slice().sort(function (a, b) {
        return G.raceScore(b) - G.raceScore(a);
      });
      return order.indexOf(player);
    }

    function finishRace() {
      state = "finished";
      var order = cars.slice().sort(function (a, b) {
        return G.raceScore(b) - G.raceScore(a);
      });
      var pos = order.indexOf(player),
        won = pos === 0;
      var newBest = false;
      if (player.bestLap && (!save.best || player.bestLap < save.best)) {
        save.best = player.bestLap;
        newBest = true;
        G.Save.save();
      }
      var rows = order.map(function (c) {
        return {
          name: c.isPlayer ? "YOU" : c.name,
          best: c.bestLap,
          you: c.isPlayer,
        };
      });
      UI.results(won, POS_STR[pos], rows, G.fmtTime(player.bestLap), newBest);
      UI.showResults(true);
      UI.setWrongWay(false);
      if (won) {
        G.AudioSys.win();
        UI.toast("VICTORY!", 2500);
        G.AudioSys.speak("Victory! First place finish.");
      } else {
        G.AudioSys.lose();
        UI.toast(POS_STR[pos] + " PLACE", 2500);
      }
      G.AudioSys.silence();
    }

    // ---------- collisions ----------
    // Stage 1: hit-stop — impacts set global timeScale 0.05 for 60-100ms by
    // severity, restored on REAL time (newest trigger owns restore). Once per
    // impact (150ms cooldown). Skipped under reducedMotion. Input buffers
    // through because playerInput() reads live key state every fixed step.
    function triggerHitStop(sev) {
      if (reducedMotion) return;
      var now = performance.now();
      if (now < hitStopCool) return;
      hitStopCool = now + 150;
      hitStopEnd = now + 60 + 40 * Math.max(0, Math.min(1, sev));
      timeScale = 0.05;
    }

    function carCollisions() {
      for (var i = 0; i < cars.length; i++) {
        for (var j = i + 1; j < cars.length; j++) {
          var a = cars[i],
            b = cars[j];
          var dx = b.x - a.x,
            dz = b.z - a.z;
          var d2 = dx * dx + dz * dz;
          if (d2 > 8.4 || d2 < 1e-6) continue;
          var d = Math.sqrt(d2),
            nx = dx / d,
            nz = dz / d;
          var overlap = 2.9 - d;
          a.x -= nx * overlap * 0.5;
          a.z -= nz * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.z += nz * overlap * 0.5;
          var rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rel < 0) {
            var imp = -rel * 0.55;
            a.vx -= nx * imp;
            a.vz -= nz * imp;
            b.vx += nx * imp;
            b.vz += nz * imp;
            a.speed *= 0.97;
            b.speed *= 0.97;
            if ((a.isPlayer || b.isPlayer) && -rel > 6) {
              // Stage 1 tiers: car tap +0.35 → hard crash +0.65 by impact.
              var sev = Math.max(0, Math.min(1, (-rel - 6) / 14));
              trauma = Math.min(1, trauma + 0.35 + 0.3 * sev);
              triggerHitStop(sev);
              G.AudioSys.thud(sev);
            }
          }
        }
      }
    }

    // ---------- fixed update ----------
    var fx = { trauma: 0 };

    function fixedUpdate(dt) {
      if (state === "countdown") {
        countT += dt;
        var step = countT < 1 ? 3 : countT < 2 ? 2 : countT < 3 ? 1 : 0;
        if (step !== countStep) {
          countStep = step;
          if (step > 0) {
            UI.setCountdown(String(step));
            G.AudioSys.countTick();
          } else {
            UI.setCountdown("GO!");
            G.AudioSys.countGo();
            G.AudioSys.speak("Go!");
          }
        }
        var inp = TESTMODE
          ? { throttle: 1, steer: 0, hand: false, nitro: false }
          : playerInput();
        G.AudioSys.setEngine(
          0,
          Math.max(0, inp.throttle),
          false,
          false,
          false,
          true,
        );
        if (countT >= 3.7) {
          state = "racing";
          UI.setCountdown(null);
        }
        return;
      }
      if (state !== "racing") return;
      raceTime += dt;

      // player (or AI-driven in test mode)
      var ev;
      if (TESTMODE) {
        ev = G.updateAI(player, dt, world, raceTime, player, cars, fx);
      } else {
        player.input = playerInput();
        ev = G.updateCar(player, dt, world, raceTime, fx);
      }
      handleEv(player, ev);
      carAnim(player, dt);

      for (var i = 0; i < ais.length; i++) {
        var aev = G.updateAI(ais[i], dt, world, raceTime, player, cars, fx);
        handleEv(ais[i], aev);
        carAnim(ais[i], dt);
      }
      carCollisions();
      if (fx.trauma) {
        // Stage 1: barrier hits arrive here from physics; map into the tier
        // band (scrape +0.2 … hard crash +0.65) + severity hit-stop.
        var bsev = Math.max(0, Math.min(1, fx.trauma / 0.65));
        trauma = Math.min(1, trauma + Math.min(0.65, 0.2 + fx.trauma));
        triggerHitStop(bsev);
        G.AudioSys.thud(bsev);
        fx.trauma = 0;
      }
      // Stage 1: wall-scrape rising edge → +0.2 trauma.
      if (player.scraping && !scrapePrev) {
        trauma = Math.min(1, trauma + 0.2);
      }
      scrapePrev = !!player.scraping;

      // vfx emission
      emitVfx(dt);

      // audio + hud
      var spd01 = Math.min(1, Math.abs(player.speed) / 62);
      // Stage 2: slip from lateral velocity + 5-gear hysteresis for RPM.
      var paFx = Math.sin(player.angle),
        paFz = Math.cos(player.angle);
      var paLat = -player.vx * paFz + player.vz * paFx;
      var slip01 = Math.max(
        0,
        Math.min(1, Math.abs(paLat) / Math.max(Math.abs(player.speed), 1)),
      );
      if (audioGear < 5 && spd01 > GEAR_UPS[audioGear - 1]) audioGear++;
      else if (audioGear > 1 && spd01 < GEAR_UPS[audioGear - 2] - 0.02)
        audioGear--;
      G.AudioSys.setEngine(
        spd01,
        Math.max(0, player.input.throttle),
        player.drifting,
        player.offroad,
        player.nitroActive,
        true,
        slip01,
        audioGear,
      );
      UI.setWrongWay(player.wrongWay && !player.finished);
      UI.updateHud(player, POS_STR[playerRank()], raceTime, sessionBest, audioGear);
      UI.minimapDraw(cars);

      // sun + rim follow player
      world.sun.position.set(
        player.x + world.sunOffset.x,
        world.sunOffset.y,
        player.z + world.sunOffset.z,
      );
      world.sun.target.position.set(player.x, 0, player.z);
      world.rim.position.set(
        player.x + world.rimOffset.x,
        world.rimOffset.y,
        player.z + world.rimOffset.z,
      );
      world.rim.target.position.set(player.x, 0, player.z);
    }

    function handleEv(car, ev) {
      if (ev === 1) {
        car.nitro = Math.min(100, car.nitro + 30);
        if (car.isPlayer) G.AudioSys.checkpoint();
      } else if (ev === 2) {
        car.lapStart = raceTime;
        if (car.finished) {
          car.finishScore = raceTime;
          if (car.isPlayer && state === "racing") finishRace();
        } else if (car.isPlayer) {
          G.AudioSys.lap();
          if (!reducedMotion) UI.flash();
          UI.toast(
            car.lap === 3
              ? "FINAL LAP — " + G.fmtTime(car.lastLap)
              : "LAP " + car.lap + "/3 — " + G.fmtTime(car.lastLap),
            2000,
          );
        }
      }
    }

    // Stage 1: procedural car animation (subtle, realistic lane). Wheel spin
    // (v*dt/r, r=0.36), front-steer pivots, and base body roll already live in
    // updateCar; this hook runs after physics each fixed step to clamp body
    // roll to ±3° and add a suspension spring (dip on accel/landing) with
    // ≤2% scale ease. No cartoon deform.
    function carAnim(car, dt) {
      if (car._susp === undefined) {
        car._susp = 0;
        car._suspV = 0;
        car._prevY = car.y || 0;
        car._prevVy = 0;
        car._prevSpd = car.speed || 0;
      }
      var vy = dt > 0 ? (car.y - car._prevY) / dt : 0;
      car._prevY = car.y;
      var dvy = vy - car._prevVy;
      car._prevVy = vy;
      var acc = dt > 0 ? (car.speed - car._prevSpd) / dt : 0;
      car._prevSpd = car.speed;
      // Clamp body roll to ±3° (0.052 rad).
      var rz = car.group.rotation.z;
      if (rz > 0.052) car.group.rotation.z = 0.052;
      else if (rz < -0.052) car.group.rotation.z = -0.052;
      if (reducedMotion) {
        car._susp = 0;
        car._suspV = 0;
        car.group.scale.set(1, 1, 1);
        return;
      }
      // Suspension spring (stiff 140, damp 14): excited by vertical-velocity
      // jumps (landings) and longitudinal accel (squat under throttle).
      car._suspV += (-140 * car._susp - 14 * car._suspV) * dt;
      car._suspV += -dvy * 0.08 - acc * dt * 0.12;
      if (car._suspV > 1.5) car._suspV = 1.5;
      else if (car._suspV < -1.5) car._suspV = -1.5;
      car._susp += car._suspV * dt;
      if (car._susp > 0.12) car._susp = 0.12;
      else if (car._susp < -0.12) car._susp = -0.12;
      car.group.position.y += car._susp;
      var sq = 1 + Math.max(-0.02, Math.min(0.02, car._susp * 0.15));
      car.group.scale.set(1, sq, 1);
    }

    function emitVfx(dt) {
      skidT += dt;
      dustT += dt;
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i],
          spd = Math.abs(c.speed);
        var fx0 = Math.sin(c.angle),
          fz0 = Math.cos(c.angle);
        var cy = c.y || 0;
        // Stage 1: drift INITIATION burst — 6-8 near-white sprites on the
        // rising edge of c.drifting (per car).
        if (c.drifting && !c._wasDrifting && G.VFX.smokeBurst) {
          G.VFX.smokeBurst(
            c.x - fx0 * 2,
            cy + 0.4,
            c.z - fz0 * 2,
            6 + Math.floor(Math.random() * 3),
          );
        }
        c._wasDrifting = !!c.drifting;
        if (c.drifting && !c.offroad && skidT > 0.11) {
          for (var s = -1; s <= 1; s += 2) {
            var wx = c.x - fx0 * 1.45 - fz0 * s * 0.95;
            var wz = c.z - fz0 * 1.45 + fx0 * s * 0.95;
            G.VFX.dropSkid(wx, wz, c.angle);
          }
          G.VFX.puff(
            c.x - fx0 * 2,
            cy + 0.4,
            c.z - fz0 * 2,
            0xbbbbbb,
            1,
            2,
            1.5,
          );
          // Stage 1: denser smoke trail while drifting && speed01 > 0.25.
          if (Math.min(1, spd / 62) > 0.25 && G.VFX.smokeBurst) {
            G.VFX.smokeBurst(c.x - fx0 * 2, cy + 0.4, c.z - fz0 * 2, 2);
          }
        }
        if (c.offroad && spd > 10 && dustT > 0.07) {
          G.VFX.puff(
            c.x - fx0 * 2,
            cy + 0.5,
            c.z - fz0 * 2,
            0x9a8a5a,
            2,
            2.5,
            2,
          );
        }
        if (c.nitroActive && dustT > 0.09) {
          G.VFX.puff(
            c.x - fx0 * 2.6,
            cy + 0.4,
            c.z - fz0 * 2.6,
            0x66ccff,
            1,
            1,
            1,
          );
        }
      }
      if (skidT > 0.11) skidT = 0;
      if (dustT > 0.07) dustT = 0;
    }

    // ---------- camera (per render frame) ----------
    var _des = new THREE.Vector3(),
      _look = new THREE.Vector3();
    function updateCamera(dt) {
      if (state === "menu") {
        menuAngle += dt * 0.25;
        _des.set(
          player.x + Math.sin(menuAngle) * 9.5,
          (player.y || 0) + 3.2,
          player.z + Math.cos(menuAngle) * 9.5,
        );
        _look.set(player.x, (player.y || 0) + 1, player.z);
        var mk = 1 - Math.exp(-dt * 3);
        camPos.lerp(_des, camInit ? mk : 1);
        camLook.lerp(_look, camInit ? mk : 1);
        camInit = true;
        camera.position.copy(camPos);
        camera.lookAt(camLook);
        camera.fov += (60 - camera.fov) * Math.min(1, dt * 3);
        camera.updateProjectionMatrix();
        return;
      }
      var cfg = CAMS[camMode];
      var px = player.x,
        pz = player.z;
      var fx0 = Math.sin(player.angle),
        fz0 = Math.cos(player.angle);
      var spd01c = Math.min(1, Math.abs(player.speed) / 62);
      if (camMode === 2) {
        _des.set(px + fx0 * 0.4, (player.y || 0) + cfg.h, pz + fz0 * 0.4);
        _look.set(px + fx0 * 30, (player.y || 0) + 1.0, pz + fz0 * 30);
      } else {
        // Stage 1 lag: desired pos shifts slightly back with speed.
        var lagD = cfg.d + spd01c * 1.2;
        _des.set(px - fx0 * lagD, (player.y || 0) + cfg.h, pz - fz0 * lagD);
        _look.set(px + fx0 * 6, (player.y || 0) + 1.2, pz + fz0 * 6);
      }
      // Stage 1 lag: chase lerp rate 6.5 → 4.5 as speed rises.
      var lagRate = camMode === 2 ? 30 : 6.5 - 2.0 * spd01c;
      var k = 1 - Math.exp(-dt * lagRate);
      if (!camInit) {
        camPos.copy(_des);
        camLook.copy(_look);
        camInit = true;
      } else {
        camPos.lerp(_des, k);
        camLook.lerp(_look, k);
      }

      trauma = Math.max(0, trauma - dt * 1.6);
      // Stage 1: SMOOTHED trauma shake — two random targets refreshed ~30Hz
      // and lerped between (never raw per-frame Math.random). trauma 0..1,
      // offset = trauma² × max (pos 0.7 with y ×0.6, roll 0.06 rad).
      // Camera ONLY, never the car body.
      shakeT += dt;
      if (shakeT >= 1 / 30) {
        shakeT = 0;
        for (var shi = 0; shi < 4; shi++) {
          shakeCur[shi] = shakeNxt[shi];
          shakeNxt[shi] = Math.random() * 2 - 1;
        }
      }
      var shf = shakeT * 30;
      var shx = shakeCur[0] + (shakeNxt[0] - shakeCur[0]) * shf;
      var shy = shakeCur[1] + (shakeNxt[1] - shakeCur[1]) * shf;
      var shz = shakeCur[2] + (shakeNxt[2] - shakeCur[2]) * shf;
      var shr = shakeCur[3] + (shakeNxt[3] - shakeCur[3]) * shf;
      // Stage 1: hood cam gets a micro-rumble trauma floor at speed.
      var effT = trauma;
      if (camMode === 2) effT = Math.max(effT, 0.06 * spd01c);
      if (reducedMotion) effT = 0;
      var sh = effT * effT * 0.7;
      camera.position.set(
        camPos.x + shx * sh,
        camPos.y + shy * sh * 0.6,
        camPos.z + shz * sh,
      );
      camera.lookAt(camLook);
      // Stage 1 lean: roll = -latVel × k, clamped ±0.07 rad (~4°).
      // Right vector is (-cos a, +sin a) in (x, z), so right-positive
      // lateral velocity = -vx×cos a + vz×sin a.
      var latVel = -player.vx * fz0 + player.vz * fx0;
      var lean = Math.max(-0.07, Math.min(0.07, -latVel * 0.008));
      if (reducedMotion) lean = 0;
      camera.rotateZ(shr * effT * effT * 0.06 + lean);
      var spd01 = Math.min(1, Math.abs(player.speed) / 62);
      var wantFov = 66 + spd01 * 10 + (player.nitroActive ? 6 : 0);
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
      // Stage 1: speed lines fade in at spd01 > 0.7, full at nitro.
      if (G.VFX.setSpeedLines) {
        G.VFX.setSpeedLines(
          reducedMotion
            ? 0
            : player.nitroActive
              ? 1
              : Math.max(0, Math.min(1, (spd01 - 0.7) / 0.3)),
        );
      }
    }

    // ---------- main loop ----------
    var last = performance.now(),
      acc = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      var raw = (now - last) / 1000;
      last = now;
      if (raw > 0.25) raw = 0.25;

      // fps meter + auto quality
      fpsAcc += raw;
      fpsN++;
      if (fpsAcc >= 0.5) {
        fpsAvg = fpsN / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
        if (SHOWFPS || DEBUGMODE) {
          var ft = fpsAvg.toFixed(0) + " fps q" + save.quality;
          if (DEBUGMODE)
            ft +=
              " x:" +
              player.x.toFixed(1) +
              " y:" +
              (player.y || 0).toFixed(1) +
              " z:" +
              player.z.toFixed(1);
          document.getElementById("fps").textContent = ft;
        }
        if (state === "racing") {
          if (fpsAvg < 45 && save.quality > 0) {
            lowT += 0.5;
            if (lowT >= 3) {
              lowT = 0;
              applyQuality(save.quality - 1);
              G.Save.save();
              UI.syncPauseOptions(save);
              UI.toast(
                "QUALITY AUTO: " + ["LOW", "MED", "HIGH"][save.quality],
                2000,
              );
            }
          } else lowT = 0;
        }

      }

      // Stage 1: hit-stop restores on REAL time; rendering continues at full
      // rate while the fixed-update accumulator runs scaled by timeScale.
      if (timeScale !== 1 && performance.now() >= hitStopEnd) timeScale = 1;
      if (state !== "paused") {
        acc += raw * timeScale;
        var steps = 0;
        while (acc >= STEP && steps < 3) {
          fixedUpdate(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps === 3) acc = 0;
        world.update(raw, now / 1000, player.mesh.position);
        G.VFX.update(raw, now / 1000, player.x, player.z);
      } else if (world.water && typeof world.water.update === "function") {
        world.water.update(raw);
      }
      updateCamera(raw);
      renderer.render(scene, camera);
    }

    function onResize() {
      var w = container.clientWidth || window.innerWidth;
      var h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", onResize);
    onResize();

    // menu ambience: sun over grid
    world.sun.position.set(
      player.x + world.sunOffset.x,
      world.sunOffset.y,
      player.z + world.sunOffset.z,
    );
    world.sun.target.position.set(player.x, 0, player.z);
    world.rim.position.set(
      player.x + world.rimOffset.x,
      world.rimOffset.y,
      player.z + world.rimOffset.z,
    );
    world.rim.target.position.set(player.x, 0, player.z);

    requestAnimationFrame(frame);

    // Debug console (?debug=1): FPS + player XYZ overlay + window.game handle.
    window.game = {
      scene: scene,
      renderer: renderer,
      player: player,
      world: world,
      start: startRace,
      warp: function (x, z) {
        player.x = Number(x) || 0;
        player.z = Number(z) || 0;
      },
      win: function () {
        if (state === "racing" || state === "countdown") finishRace();
      },
      giveAll: function () {
        player.nitro = 100;
        UI.toast("NITRO FULL", 1200);
      },
      // Debug helper (?debug=1): live render-triangle / draw-call counts for
      // perf verification. renderer.info.render is reset + repopulated each
      // renderer.render(), so this reflects the most recent frame.
      stats: function () {
        var info = renderer.info && renderer.info.render;
        return {
          triangles: info ? info.triangles : 0,
          calls: info ? info.calls : 0,
          fps: fpsAvg,
          quality: save.quality,
        };
      },
    };

    if (TESTMODE) {
      setTimeout(function () {
        if (state === "menu") startRace();
      }, 600);
    }
  }

  G.VUP = { ready: true, asphalt: null, grass: null, carbon: null };
  boot();
})();
