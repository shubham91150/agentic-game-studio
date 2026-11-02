/* Ashes of St. Vermilion — boot, fixed-step loop, states (Stage 1).
 * States: menu -> playing <-> paused -> stageclear. ESC/P pause toggle.
 * Restart resets run state (pos, torch, crouch, key, timer, HUD, trauma)
 * and never reloads the page. E / INTERACT near the key (<=1.6m) clears
 * the stage; E at the chapel door shows a teaser toast (Stage 2).
 * Renderer: ACES tone mapping + sRGB + PCFSoft shadows.
 * Quality: Low (shadows off, pixelRatio<=1) / Med (<=1.5) / High (<=2),
 * with auto step-down when fps<45 for 3s. ?debug=1 overlay + window.game.
 * r128 global THREE. No module syntax. No per-frame allocations.
 */
(function () {
  'use strict';

  var FIXED = 1 / 60;
  var MAX_STEPS = 3;
  var CLAMP_DT = 0.05;
  var KEY_RADIUS = 1.6;
  var DOOR_RADIUS = 2.2;
  var AUTO_FPS = 45;
  var AUTO_SECS = 3;

  var DEBUG = false;
  try {
    DEBUG = /[?&]debug=1\b/.test(window.location.search);
  } catch (err) { DEBUG = false; }

  var Story = window.StV_Story || { TITLE: 'ASHES OF ST. VERMILION', INTRO: [], OBJECTIVES: [''] };
  var Save = window.StV_Save || null;
  var settings = { volume: 0.8, quality: 'High', sensitivity: 1.0, mute: false, bestMs: null };
  if (Save) {
    try { settings = Save.load(); } catch (err) { /* defaults stand */ }
  }

  function persist() {
    if (!Save) return;
    try { settings = Save.save(settings); } catch (err) { /* session-only */ }
  }

  var state = 'menu';
  var renderer = null;
  var scene = null;
  var camera = null;
  var world = null;
  var player = null;
  var vfx = null;
  var UI = window.StV_UI || null;
  var Audio8 = window.StV_Audio || null;

  var colliders = [];
  var bounds = { x0: -12, z0: -9, x1: 12, z1: 9 };
  var spawn = { x: 0, z: 8.5, ry: 0 };
  var keyFound = false;
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
    try { return document.getElementById(id); }
    catch (err) { return null; }
  }

  function toast(txt) {
    if (UI && UI.toast) { try { UI.toast(txt); } catch (err) { /* x */ } }
  }

  function normQuality(q) {
    var s = String(q || '').toLowerCase();
    if (s === 'low') return 'Low';
    if (s === 'med' || s === 'medium') return 'Med';
    return 'High';
  }

  function applyQuality(q) {
    settings.quality = normQuality(q);
    if (!renderer) return;
    var dpr = 1;
    try { dpr = window.devicePixelRatio || 1; } catch (err) { dpr = 1; }
    var cap = settings.quality === 'Low' ? 1 : (settings.quality === 'Med' ? 1.5 : 2);
    try { renderer.setPixelRatio(Math.min(dpr, cap)); } catch (err) { /* x */ }
    var wantShadow = settings.quality !== 'Low';
    try {
      if (renderer.shadowMap.enabled !== wantShadow) {
        renderer.shadowMap.enabled = wantShadow;
        scene.traverse(function (o) {
          if (o && o.material) {
            if (o.material.needsUpdate !== undefined) o.material.needsUpdate = true;
          }
          if (o && o.isSpotLight) o.castShadow = wantShadow;
        });
      }
    } catch (err) { /* x */ }
    onResize();
  }

  function stepQualityDown() {
    if (settings.quality === 'High') return 'Med';
    if (settings.quality === 'Med') return 'Low';
    return 'Low';
  }

  function onResize() {
    if (!renderer || !camera || !container) return;
    var w = 1;
    var hgt = 1;
    try {
      w = container.clientWidth || window.innerWidth || 1;
      hgt = container.clientHeight || window.innerHeight || 1;
    } catch (err) { /* keep 1x1 */ }
    try {
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      renderer.setSize(w, hgt);
    } catch (err) { /* x */ }
  }

  function requestLock() {
    if (!lockEl) return;
    try {
      if (document.pointerLockElement === lockEl) return;
      var p = lockEl.requestPointerLock && lockEl.requestPointerLock();
      if (p && p.catch) p.catch(function () { /* drag-look fallback */ });
    } catch (err) { /* drag-look fallback keeps game playable */ }
  }

  function exitLock() {
    try {
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch (err) { /* x */ }
  }

  function setAudioDim(d) {
    if (Audio8 && Audio8.setDimmed) {
      try { Audio8.setDimmed(d); } catch (err) { /* x */ }
    }
  }

  function show(name) {
    if (UI && UI.show) { try { UI.show(name); } catch (err) { /* x */ } }
  }

  function resetRun() {
    timerMs = 0;
    keyFound = false;
    lowTime = 0;
    keys = {};
    if (player) {
      player.reset(spawn.x, spawn.z, spawn.ry || 0);
      player.setTorch(true);
      player.setCrouch(false);
    }
    if (vfx && vfx.reset) { try { vfx.reset(); } catch (err) { /* x */ } }
    if (world && world.keyMesh) {
      try { world.keyMesh.visible = true; } catch (err) { /* x */ }
    }
    if (UI) {
      try {
        if (UI.setKey) UI.setKey(false);
        if (UI.setObjective) UI.setObjective(Story.OBJECTIVES[0] || '');
        if (UI.setNoise) UI.setNoise(0);
        if (UI.banner) UI.banner(null);
      } catch (err) { /* x */ }
    }
  }

  function startGame() {
    if (state !== 'menu') return;
    if (Audio8) {
      try { Audio8.init(); } catch (err) { /* x */ }
      try { Audio8.ambientStart(); } catch (err) { /* x */ }
    }
    setAudioDim(false);
    resetRun();
    state = 'playing';
    if (player) player.setEnabled(true);
    show('playing');
    requestLock();
    if (UI && UI.banner) {
      try { UI.banner(Story.OBJECTIVES[0] || '', 5000); } catch (err) { /* x */ }
    }
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    setAudioDim(true);
    if (player) player.setEnabled(false);
    show('paused');
    exitLock();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    setAudioDim(false);
    if (player) player.setEnabled(true);
    show('playing');
    requestLock();
  }

  function restartGame() {
    if (state !== 'paused' && state !== 'stageclear') return;
    if (Audio8) { try { Audio8.init(); } catch (err) { /* x */ } }
    setAudioDim(false);
    resetRun();
    state = 'playing';
    if (player) player.setEnabled(true);
    show('playing');
    requestLock();
  }

  function syncTouchBtn() {
    try {
      var tb = $('btn-torch');
      if (tb && player && player.isTorchOn) {
        if (player.isTorchOn()) tb.classList.add('on');
        else tb.classList.remove('on');
      }
      var cb = $('btn-crouch');
      if (cb && player && player.isCrouch) {
        if (player.isCrouch()) cb.classList.add('on');
        else cb.classList.remove('on');
      }
    } catch (err) { /* x */ }
  }

  var lastPrompt = null;
  function updatePrompt() {
    var txt = null;
    if (state === 'playing' && player && tmpV) {
      var pp = player.pos();
      var kp = keyPos(tmpV);
      if (!keyFound && kp && distXZ(pp.x, pp.z, kp.x, kp.z) <= KEY_RADIUS) {
        txt = 'E \u2014 Chapel Key';
      } else {
        var dp = doorPos(tmpV);
        if (dp && distXZ(pp.x, pp.z, dp.x, dp.z) <= DOOR_RADIUS) {
          txt = 'E \u2014 Chapel Door';
        }
      }
    }
    if (txt !== lastPrompt) {
      lastPrompt = txt;
      if (UI && UI.setPrompt) { try { UI.setPrompt(txt); } catch (err) { /* x */ } }
    }
  }

  function quitToMenu() {
    if (state !== 'paused' && state !== 'stageclear') return;
    state = 'menu';
    setAudioDim(true);
    if (player) {
      player.setEnabled(false);
      player.reset(spawn.x, spawn.z, spawn.ry || 0);
    }
    show('menu');
    exitLock();
  }

  function fmtTime(ms) {
    var t = Math.max(0, Math.round(ms / 100));
    var tenths = t % 10;
    var s = Math.floor(t / 10);
    var secs = s % 60;
    var mins = Math.floor(s / 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs + '.' + tenths;
  }

  function clearStage() {
    if (state !== 'playing') return;
    state = 'stageclear';
    if (player) player.setEnabled(false);
    exitLock();
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
            'TIME  ' + fmtTime(timerMs),
            'BEST  ' + fmtTime(settings.bestMs),
            isBest
          );
        }
      } catch (err) { /* x */ }
    }
    show('stageclear');
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
    } catch (err) { return null; }
  }

  function doorPos(out) {
    if (!world || !world.chapelDoor) return null;
    try {
      world.chapelDoor.getWorldPosition(out);
      return out;
    } catch (err) { return null; }
  }

  function doInteract() {
    if (state !== 'playing' || !player || !tmpV) return;
    var pp = player.pos();
    var kp = keyPos(tmpV);
    if (!keyFound && kp && distXZ(pp.x, pp.z, kp.x, kp.z) <= KEY_RADIUS) {
      keyFound = true;
      try { world.keyMesh.visible = false; } catch (err) { /* x */ }
      if (UI && UI.setKey) { try { UI.setKey(true); } catch (err) { /* x */ } }
      if (Audio8 && Audio8.pickup) { try { Audio8.pickup(); } catch (err) { /* x */ } }
      if (vfx) { try { vfx.addTrauma(0.25); } catch (err) { /* x */ } }
      clearStage();
      return;
    }
    var dp = doorPos(tmpV);
    if (dp && distXZ(pp.x, pp.z, dp.x, dp.z) <= DOOR_RADIUS) {
      toast('Chapel ka darwaza band hai... Jaldi... (Stage 2)');
    }
  }

  function togglePause() {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }

  function toggleTorch() {
    if (state !== 'playing' || !player) return;
    var now = true;
    try {
      now = player.isTorchOn ? !player.isTorchOn() : true;
      player.setTorch(now);
    } catch (err) { /* x */ }
    syncTouchBtn();
    toast(now ? 'Torch ON' : 'Torch OFF');
  }

  function toggleCrouch() {
    if (state !== 'playing' || !player) return;
    try {
      var now = player.isCrouch ? !player.isCrouch() : true;
      player.setCrouch(now);
    } catch (err) { /* x */ }
    syncTouchBtn();
  }

  function toggleMute() {
    settings.mute = !settings.mute;
    if (Audio8 && Audio8.setMuted) {
      try { Audio8.setMuted(settings.mute); } catch (err) { /* x */ }
    }
    persist();
    if (UI && UI.syncSettings) { try { UI.syncSettings(settings); } catch (e) { /* x */ } }
    toast(settings.mute ? 'Muted' : 'Sound ON');
  }

  function buildInput() {
    return {
      f: !!(keys.KeyW || keys.ArrowUp),
      b: !!(keys.KeyS || keys.ArrowDown),
      l: !!(keys.KeyA || keys.ArrowLeft),
      r: !!(keys.KeyD || keys.ArrowRight),
      run: !!(keys.ShiftLeft || keys.ShiftRight)
    };
  }

  function step(dt) {
    var input = buildInput();
    timerMs += dt * 1000;
    if (player) { try { player.update(dt, input); } catch (err) { /* x */ } }
    if (vfx && camera) { try { vfx.update(dt, camera); } catch (err) { /* x */ } }
  }

  var acc = 0;
  var lastT = 0;

  function frame(now) {
    if (!started || !renderer) return;
    var raw = (now - lastT) / 1000;
    lastT = now;
    if (!(raw > 0)) raw = 0;
    if (raw > CLAMP_DT) raw = CLAMP_DT;
    elapsed += raw;

    /* World ambience runs in every state except paused. */
    if (state !== 'paused' && world && world.update) {
      try { world.update(raw, elapsed); } catch (err) { /* x */ }
    }

    if (state === 'playing') {
      acc += raw;
      var n = 0;
      while (acc >= FIXED && n < MAX_STEPS) {
        step(FIXED);
        acc -= FIXED;
        n++;
      }
      if (n === MAX_STEPS) acc = 0;
      if (UI && UI.setNoise && player) {
        try { UI.setNoise(player.noiseLevel()); } catch (err) { /* x */ }
      }
      updatePrompt();
    } else if (state === 'menu' && camera) {
      /* Slow menu drift over the spawn vista (frozen when reduced motion). */
      var sway = 0;
      var rm = false;
      try {
        rm = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (err) { rm = false; }
      if (!rm) sway = Math.sin(elapsed * 0.25) * 0.12;
      camera.position.set(spawn.x, 1.6, spawn.z);
      camera.rotation.set(-0.03, (spawn.ry || 0) + sway, 0);
    }

    try { renderer.render(scene, camera); }
    catch (err) { /* surface lost; next frame retries */ }

    /* FPS meter + auto quality step-down + debug overlay. */
    frames++;
    fpsWindow += raw;
    if (fpsWindow >= 0.5) {
      fpsShown = Math.round(frames / fpsWindow);
      frames = 0;
      fpsWindow = 0;
      if (state === 'playing') {
        if (fpsShown < AUTO_FPS) lowTime += 0.5;
        else lowTime = 0;
        if (lowTime >= AUTO_SECS && settings.quality !== 'Low') {
          var next = stepQualityDown();
          applyQuality(next);
          persist();
          if (UI && UI.syncSettings) {
            try { UI.syncSettings(settings); } catch (err) { /* x */ }
          }
          toast('Quality: ' + next + ' (auto)');
          lowTime = 0;
        }
      }
      if (DEBUG && dbgEl && player) {
        try {
          var p = player.pos();
          dbgEl.textContent = 'FPS ' + fpsShown +
            '  XYZ ' + p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1);
        } catch (err) { /* x */ }
      }
    }
  }

  function renderIntroCards() {
    var menu = $('menu');
    if (!menu || !Story.INTRO || !Story.INTRO.length) return;
    var box = $('intro-cards') || $('story-cards') || $('menu-cards');
    if (!box) {
      try {
        box = document.createElement('div');
        box.id = 'intro-cards';
        var anchor = $('menu-start') || $('btn-start');
        if (anchor && anchor.parentNode === menu) menu.insertBefore(box, anchor);
        else menu.appendChild(box);
      } catch (err) { return; }
    }
    try {
      box.textContent = '';
      /* Compact inline styling (own nodes only): keep menu above the fold. */
      var bs = box.style;
      bs.display = 'flex';
      bs.flexDirection = 'column';
      bs.gap = '8px';
      bs.maxWidth = '560px';
      bs.margin = '2px 0';
    } catch (err) { /* x */ }
    var i;
    for (i = 0; i < Story.INTRO.length; i++) {
      (function (card) {
        var d = document.createElement('div');
        d.className = 'intro-card';
        var h = document.createElement('h3');
        h.textContent = card.title || '';
        var hs = h.style;
        hs.margin = '0';
        hs.fontSize = '15px';
        hs.fontWeight = 'normal';
        hs.letterSpacing = '0.12em';
        hs.color = '#ffb14e';
        var p = document.createElement('p');
        p.textContent = card.body || card.text || '';
        var ps = p.style;
        ps.margin = '2px 0 0';
        ps.fontSize = '14px';
        ps.lineHeight = '1.45';
        ps.color = '#cbbf9f';
        d.appendChild(h);
        d.appendChild(p);
        box.appendChild(d);
      })(Story.INTRO[i]);
    }
  }

  function renderTitle() {
    try { document.title = Story.TITLE || document.title; } catch (err) { /* x */ }
    var t = $('menu-title') || $('game-title');
    if (!t) {
      try { t = document.querySelector('#menu h1'); } catch (err) { t = null; }
    }
    if (t) t.textContent = Story.TITLE || '';
  }

  function wireKeys() {
    document.addEventListener('keydown', function (ev) {
      var c = ev.code || '';
      if (c === 'Space' || c === 'ArrowUp' || c === 'ArrowDown' ||
          c === 'ArrowLeft' || c === 'ArrowRight' || c === 'Tab') {
        try { ev.preventDefault(); } catch (err) { /* x */ }
      }
      keys[c] = true;
      if (ev.repeat) return;
      if (c === 'Escape' || c === 'KeyP') togglePause();
      else if (c === 'KeyE') doInteract();
      else if (c === 'KeyC') toggleCrouch();
      else if (c === 'KeyT' || c === 'KeyF') toggleTorch();
      else if (c === 'KeyM') toggleMute();
      else if (c === 'Enter' && state === 'menu') startGame();
    }, false);
    document.addEventListener('keyup', function (ev) {
      keys[ev.code || ''] = false;
    }, false);
    /* Edge-triggered auto-pause: only a true held->lost transition pauses.
     * Stale duplicate unlock events (rapid pause/resume, late delivery)
     * arrive with haveLock already false and must not steal gameplay. */
    var haveLock = false;
    document.addEventListener('pointerlockchange', function () {
      var locked = false;
      try { locked = !!document.pointerLockElement; } catch (err) { locked = false; }
      if (locked) {
        haveLock = true;
        return;
      }
      var was = haveLock;
      haveLock = false;
      if (was && state === 'playing') pauseGame();
    }, false);
    document.addEventListener('pointerlockerror', function () {
      /* Keep playing with drag-look fallback. */
    }, false);
  }

  function wireCanvasClick() {
    if (!container) return;
    container.addEventListener('click', function () {
      if (state === 'playing') requestLock();
    }, false);
  }

  function boot() {
    if (!window.THREE) {
      var msg = 'THREE failed to load — check vendor script tags.';
      try { console.error('[stv] ' + msg); } catch (err) { /* x */ }
      var c0 = $('canvas-container');
      if (c0) c0.textContent = msg;
      return;
    }

    container = $('canvas-container') || document.body;
    lockEl = container;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      container.textContent = 'WebGL unavailable in this browser.';
      return;
    }
    try {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
    } catch (err) { /* use defaults */ }

    scene = new THREE.Scene();
    try {
      scene.fog = new THREE.FogExp2(0x060a0e, 0.045);
      scene.userData.renderer = renderer;
    } catch (err) { /* x */ }

    camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    try { scene.add(camera); } catch (err) { /* x */ }

    /* Small screens start one notch down; desktops start at saved/High. */
    try {
      var small = window.matchMedia && window.matchMedia('(pointer: coarse)').matches &&
        Math.min(window.screen.width || 9999, window.screen.height || 9999) < 800;
      if (small && settings.quality === 'High') settings.quality = 'Med';
    } catch (err) { /* x */ }
    applyQuality(settings.quality);
    onResize();
    window.addEventListener('resize', onResize, false);

    if (window.StV_Levels && window.StV_Levels.buildWorld) {
      try {
        world = window.StV_Levels.buildWorld(scene);
      } catch (err) {
        try { console.error('[stv] buildWorld failed', err); } catch (e) { /* x */ }
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
        update: function () { /* empty preview until Task 2 lands */ }
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
            try { Audio8.footstep(run); } catch (err) { /* x */ }
          }
        };
      } catch (err) {
        try { console.error('[stv] player failed', err); } catch (e) { /* x */ }
        player = null;
      }
    }

    if (window.StV_VFX) {
      try {
        vfx = window.StV_VFX.create(scene, renderer);
        window.StV_VFXHook = vfx;
      } catch (err) { vfx = null; }
    }

    if (Audio8) {
      try { Audio8.setVolume(settings.volume); } catch (err) { /* x */ }
      try { Audio8.setMuted(settings.mute); } catch (err) { /* x */ }
    }

    if (UI && UI.bind) {
      try {
        UI.bind({
          settings: settings,
          getPlayer: function () { return player; },
          isPlaying: function () { return state === 'playing'; },
          getMuted: function () { return !!settings.mute; },
          onStart: startGame,
          onResume: resumeGame,
          onRestart: restartGame,
          onQuit: quitToMenu,
          onTorch: toggleTorch,
          onCrouch: toggleCrouch,
          onAct: doInteract,
          onVolume: function (v) {
            if (typeof v === 'number' && isFinite(v)) {
              settings.volume = Math.min(1, Math.max(0, v));
              if (Audio8 && Audio8.setVolume) {
                try { Audio8.setVolume(settings.volume); } catch (err) { /* x */ }
              }
              persist();
            }
          },
          onQuality: function (q) {
            applyQuality(q);
            persist();
            if (UI && UI.syncSettings) {
              try { UI.syncSettings(settings); } catch (err) { /* x */ }
            }
          },
          onSensitivity: function (v) {
            if (typeof v === 'number' && isFinite(v)) {
              settings.sensitivity = Math.min(2, Math.max(0.5, v));
              if (player) {
                try { player.setSensitivity(settings.sensitivity); } catch (err) { /* x */ }
              }
              persist();
            }
          },
          onMute: function (m) {
            settings.mute = !!m;
            if (Audio8 && Audio8.setMuted) {
              try { Audio8.setMuted(settings.mute); } catch (err) { /* x */ }
            }
            persist();
            if (UI && UI.syncSettings) {
              try { UI.syncSettings(settings); } catch (err) { /* x */ }
            }
          }
        });
      } catch (err) {
        try { console.error('[stv] ui bind failed', err); } catch (e) { /* x */ }
      }
    }

    renderTitle();
    renderIntroCards();
    resetRun();
    if (player) player.setEnabled(false);
    syncTouchBtn();
    show('menu');

    tmpV = new THREE.Vector3();

    if (DEBUG) {
      try {
        dbgEl = $('debug');
        if (dbgEl) {
          dbgEl.classList.remove('hidden');
        } else {
          dbgEl = document.createElement('div');
          dbgEl.setAttribute('style', 'position:absolute;top:8px;right:8px;z-index:60;' +
            'padding:4px 8px;font:12px monospace;color:#7fd4ff;' +
            'background:rgba(0,0,0,0.55);border-radius:4px;pointer-events:none;');
          document.body.appendChild(dbgEl);
        }
        dbgEl.textContent = 'FPS --';
      } catch (err) { dbgEl = null; }
    }

    window.game = {
      scene: scene,
      player: player,
      warp: function (x, z) {
        if (!player) return;
        var cx = Math.min(bounds.x1 - 0.5, Math.max(bounds.x0 + 0.5, +x || 0));
        var cz = Math.min(bounds.z1 - 0.5, Math.max(bounds.z0 + 0.5, +z || 0));
        player.reset(cx, cz);
      },
      win: function () {
        if (state !== 'playing') return;
        keyFound = true;
        if (world && world.keyMesh) {
          try { world.keyMesh.visible = false; } catch (err) { /* x */ }
        }
        if (UI && UI.setKey) { try { UI.setKey(true); } catch (err) { /* x */ } }
        clearStage();
      },
      giveAll: function () {
        if (state === 'playing' && window.game && window.game.win) window.game.win();
      }
    };

    wireKeys();
    wireCanvasClick();
    started = true;
    lastT = performance.now();
    renderer.setAnimationLoop(frame);
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, false);
    } else {
      boot();
    }
  } catch (err) {
    try { console.error('[stv] boot failed', err); } catch (e) { /* x */ }
  }
})();
