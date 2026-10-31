/* Horizon Sprint — game.js
 * Boot + fixed-timestep loop + state machine + chase camera + race control.
 * States: menu -> countdown -> racing <-> paused -> finished.
 * Skills applied: game-pipeline, game-logic, ui-taste, threejs, browser-game (Compact).
 * Asset credit: all cars/track/textures/audio procedural, zero downloads. */
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
    var camMode = 0,
      trauma = 0;
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
      renderer.setPixelRatio(
        q === 0
          ? Math.min(dpr, 1)
          : q === 1
            ? Math.min(dpr, 1.5)
            : Math.min(dpr, 2),
      );
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
    UI.setCamLabel(0);
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
      });
      G.VFX.reset();
      camInit = false;
      trauma = 0;
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
              trauma = Math.min(1, trauma + 0.4);
              G.AudioSys.beep(140, 0.15, "sawtooth", 0.2);
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

      for (var i = 0; i < ais.length; i++) {
        var aev = G.updateAI(ais[i], dt, world, raceTime, player, cars, fx);
        handleEv(ais[i], aev);
      }
      carCollisions();
      if (fx.trauma) {
        trauma = Math.min(1, trauma + fx.trauma);
        fx.trauma = 0;
      }

      // vfx emission
      emitVfx(dt);

      // audio + hud
      var spd01 = Math.min(1, Math.abs(player.speed) / 62);
      G.AudioSys.setEngine(
        spd01,
        Math.max(0, player.input.throttle),
        player.drifting,
        player.offroad,
        player.nitroActive,
        true,
      );
      UI.setWrongWay(player.wrongWay && !player.finished);
      UI.updateHud(player, POS_STR[playerRank()], raceTime, sessionBest);
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

    function emitVfx(dt) {
      skidT += dt;
      dustT += dt;
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i],
          spd = Math.abs(c.speed);
        var fx0 = Math.sin(c.angle),
          fz0 = Math.cos(c.angle);
        if (c.drifting && !c.offroad && skidT > 0.11) {
          for (var s = -1; s <= 1; s += 2) {
            var wx = c.x - fx0 * 1.45 - fz0 * s * 0.95;
            var wz = c.z - fz0 * 1.45 + fx0 * s * 0.95;
            G.VFX.dropSkid(wx, wz, c.angle);
          }
          G.VFX.puff(c.x - fx0 * 2, 0.4, c.z - fz0 * 2, 0xbbbbbb, 1, 2, 1.5);
        }
        if (c.offroad && spd > 10 && dustT > 0.07) {
          G.VFX.puff(c.x - fx0 * 2, 0.5, c.z - fz0 * 2, 0x9a8a5a, 2, 2.5, 2);
        }
        if (c.nitroActive && dustT > 0.09) {
          G.VFX.puff(c.x - fx0 * 2.6, 0.4, c.z - fz0 * 2.6, 0x66ccff, 1, 1, 1);
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
          3.2,
          player.z + Math.cos(menuAngle) * 9.5,
        );
        _look.set(player.x, 1, player.z);
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
      if (camMode === 2) {
        _des.set(px + fx0 * 0.4, cfg.h, pz + fz0 * 0.4);
        _look.set(px + fx0 * 30, 1.0, pz + fz0 * 30);
      } else {
        _des.set(px - fx0 * cfg.d, cfg.h, pz - fz0 * cfg.d);
        _look.set(px + fx0 * 6, 1.2, pz + fz0 * 6);
      }
      var k = 1 - Math.exp(-dt * (camMode === 2 ? 30 : 6.5));
      if (!camInit) {
        camPos.copy(_des);
        camLook.copy(_look);
        camInit = true;
      } else {
        camPos.lerp(_des, k);
        camLook.lerp(_look, k);
      }

      trauma = Math.max(0, trauma - dt * 1.6);
      var sh = reducedMotion ? 0 : trauma * trauma * 0.7;
      camera.position.set(
        camPos.x + (Math.random() - 0.5) * sh,
        camPos.y + (Math.random() - 0.5) * sh * 0.6,
        camPos.z + (Math.random() - 0.5) * sh,
      );
      camera.lookAt(camLook);
      var spd01 = Math.min(1, Math.abs(player.speed) / 62);
      var wantFov = 66 + spd01 * 10 + (player.nitroActive ? 6 : 0);
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
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

      if (state !== "paused") {
        acc += raw;
        var steps = 0;
        while (acc >= STEP && steps < 3) {
          fixedUpdate(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps === 3) acc = 0;
        world.update(raw, now / 1000);
        G.VFX.update(raw, now / 1000, player.x, player.z);
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
      player: player,
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
    };

    if (TESTMODE) {
      setTimeout(function () {
        if (state === "menu") startRace();
      }, 600);
    }
  }

  // VISUAL UPGRADE Step 3: PBR photo-textures, procedural fallback on failure.
  G.VUP = { ready: false, asphalt: null, grass: null, carbon: null };
  function preloadVUP() {
    function one(url) {
      return new Promise(function (res) {
        new THREE.TextureLoader().load(
          url,
          function (t) {
            res(t);
          },
          undefined,
          function () {
            res(null);
          },
        );
      });
    }
    function setup(t) {
      if (!t) return null;
      t.encoding = THREE.sRGBEncoding;
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      t.anisotropy = 4;
      return t;
    }
    var all = Promise.all([
      one("/studio/uploads/vup_asphalt.webp"),
      one("/studio/uploads/vup_grass.webp"),
      one("/studio/uploads/vup_carbon.webp"),
    ]);
    var timeout = new Promise(function (res) {
      setTimeout(function () {
        res([null, null, null]);
      }, 9000);
    });
    Promise.race([all, timeout]).then(function (ts) {
      G.VUP.asphalt = setup(ts[0]);
      G.VUP.grass = setup(ts[1]);
      G.VUP.carbon = setup(ts[2]);
      G.VUP.ready = !!(ts[0] || ts[1] || ts[2]);
      boot();
    });
  }
  preloadVUP();
})();
