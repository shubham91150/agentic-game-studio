/* Ashes of St. Vermilion — screens, HUD, menus, touch (Stage 1+2 ext).
 * window.StV_UI = {show, setObjective, toast, + additive: bind, setNoise,
 *   setKey, banner, setClearStats, syncSettings, setEnemy, setGameOverStats}
 * show() gains 'gameover'; new DOM: #gameover, #hud-enemy, #opt-difficulty.
 * Dark horror look is owned by index.html CSS; this file only toggles
 * visibility, text, and widths, and wires every control defensively:
 * each button is found by candidate id list, then by container query,
 * and silently skipped when absent (Task 2 owns index.html).
 * Touch: left-zone joystick (#joy, deadzone 0.15) + right-half look drag
 * + TORCH / CROUCH / INTERACT buttons, shown on coarse pointers only.
 */
(function () {
  'use strict';

  var TOAST_MS = 4000;
  var JOY_DEAD = 0.15;
  var JOY_RADIUS = 52;

  var H = {};
  var toastTimer = 0;
  var bannerTimer = 0;
  var joyId = null;
  var lookId = null;
  var lookLX = 0;
  var lookLY = 0;
  var joyCX = 0;
  var joyCY = 0;
  var touchSeen = false;

  function $(id) {
    try { return document.getElementById(id); }
    catch (err) { return null; }
  }

  function first(ids) {
    var i;
    for (i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) return el;
    }
    return null;
  }

  function query(sel, root) {
    try { return (root || document).querySelector(sel); }
    catch (err) { return null; }
  }

  function on(el, ev, fn, opts) {
    if (el) {
      try { el.addEventListener(ev, fn, opts || false); }
      catch (err) { /* ignore */ }
    }
  }

  function player() {
    try { return (typeof H.getPlayer === 'function') ? H.getPlayer() : null; }
    catch (err) { return null; }
  }

  function playing() {
    try { return (typeof H.isPlaying === 'function') ? !!H.isPlaying() : true; }
    catch (err) { return true; }
  }

  function hide(el) { if (el) el.classList.add('hidden'); }
  function unhide(el) { if (el) el.classList.remove('hidden'); }

  /* Last-resort toast node when the shell has no #toast/#caption. */
  function ensureToast() {
    try {
      var el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      var s = el.style;
      s.position = 'fixed';
      s.left = '50%';
      s.bottom = '12%';
      s.transform = 'translateX(-50%)';
      s.zIndex = '30';
      s.padding = '8px 18px';
      s.font = '15px Georgia,serif';
      s.letterSpacing = '0.06em';
      s.color = '#e8dcc4';
      s.background = 'rgba(3,5,7,0.92)';
      s.border = '1px solid #8a5a24';
      s.borderRadius = '6px';
      s.pointerEvents = 'none';
      document.body.appendChild(el);
      return el;
    } catch (err) { return null; }
  }

  /* Shell sliders may be 0..1 or percent (0..100 / 20..200): normalize. */
  function readScaled(el) {
    var v = parseFloat(el.value);
    if (!isFinite(v)) return NaN;
    var max = parseFloat(el.getAttribute('max'));
    if (isFinite(max) && max > 1) v = v / 100;
    return v;
  }

  function writeScaled(el, v) {
    try {
      var max = parseFloat(el.getAttribute('max'));
      el.value = (isFinite(max) && max > 1) ? v * 100 : v;
    } catch (err) { /* x */ }
  }

  function writeQuality(sel, q) {
    var lower = q === 'Low' ? 'low' : (q === 'Med' ? 'medium' : 'high');
    try {
      sel.value = q;
      if (sel.selectedIndex < 0) sel.value = lower;
    } catch (err) { /* x */ }
  }

  /* Stage 2 additive: delayed arming handle for the gameover buttons. */
  var goArmTimer = 0;

  function setGoButtonsDisabled(disabled) {
    var ids = ['btn-go-retry', 'btn-go-menu'];
    var i;
    for (i = 0; i < ids.length; i++) {
      var b = $(ids[i]);
      if (b) {
        try { b.disabled = !!disabled; } catch (err) { /* x */ }
      }
    }
  }

  /* LIVE room readout (prop-polish): a small second line under #hud-obj
   * (e.g. '◉ Classroom A') so the static objective is never misread as
   * the current room. Polls window.game.player.pos() every 500ms, fully
   * guarded: missing DOM/player/menu/pause states all pass silently.
   * Rects mirror the levels.js SEGS layout (x/z, meters). */
  var ROOM_TICK_MS = 500;
  var roomTimer = 0;
  var roomLast = '';
  function resolveRoom(x, z) {
    if (!isFinite(x) || !isFinite(z)) return '';
    if (x >= -3 && x <= 3 && z >= -9 && z <= -6) return 'Chapel Approach';
    if (z >= -9 && z <= -6) return 'North Corridor';
    if (x >= -9 && x <= -1 && z >= -6 && z <= 2) return 'Classroom A';
    if (x >= 1 && x <= 9 && z >= -6 && z <= 2) return 'Classroom B';
    if (z >= 2 && z <= 5) return 'South Corridor';
    if (z >= 5 && z <= 9) {
      if (x >= -4 && x <= 4) return 'Entrance Hall';
      if (x < -4) return 'West Store';
      if (x > 4) return 'East Store';
    }
    /* W/E side passages (x +-9..12, z -6..2): north/south half. */
    if ((x < -9 || x > 9) && z > -6 && z < 2) {
      return (z < -2) ? 'North Corridor' : 'South Corridor';
    }
    return '';
  }
  function roomEl() {
    var el = $('hud-room');
    if (el) return el;
    var obj = $('hud-obj');
    if (!obj || !obj.parentNode) return null;
    try {
      el = document.createElement('div');
      el.id = 'hud-room';
      el.style.display = 'block';
      el.style.fontSize = '12px';
      el.style.opacity = '0.85';
      if (obj.nextSibling) obj.parentNode.insertBefore(el, obj.nextSibling);
      else obj.parentNode.appendChild(el);
      return el;
    } catch (err) { return null; }
  }
  function roomTick() {
    var pos = null;
    try {
      var g = (typeof window !== 'undefined') ? window.game : null;
      var p = g && g.player;
      if (p && typeof p.pos === 'function') pos = p.pos();
    } catch (err) { pos = null; }
    if (!pos) return;
    var room = resolveRoom(+pos.x, +pos.z);
    if (!room || room === roomLast) return;
    roomLast = room;
    var el = roomEl();
    if (el) {
      try { el.textContent = '\u25C9 ' + room; } catch (err) { /* x */ }
    }
  }
  function startRoomPoll() {
    if (roomTimer) return;
    try { roomTimer = setInterval(roomTick, ROOM_TICK_MS); }
    catch (err) { roomTimer = 0; }
  }

  var api = {
    show: function (name) {
      var menu = $('menu');
      var pause = $('pause');
      var clear = $('clear');
      var gameover = $('gameover');
      var hud = $('hud');
      hide(menu); hide(pause); hide(clear); hide(gameover);
      if (name === 'menu') unhide(menu);
      else if (name === 'paused') unhide(pause);
      else if (name === 'stageclear') unhide(clear);
      else if (name === 'gameover') {
        unhide(gameover);
        /* Input arms 2.0s after the jumpscare beat lands. */
        setGoButtonsDisabled(true);
        if (goArmTimer) { try { clearTimeout(goArmTimer); } catch (e) { /* x */ } }
        goArmTimer = setTimeout(function () {
          goArmTimer = 0;
          setGoButtonsDisabled(false);
        }, 2000);
      } else if (goArmTimer) {
        try { clearTimeout(goArmTimer); } catch (e) { /* x */ }
        goArmTimer = 0;
        setGoButtonsDisabled(false);
      }
      if (hud) {
        if (name === 'playing' || name === 'paused') unhide(hud);
        else hide(hud);
      }
      /* Butcher Boss indicator lives only inside live play. */
      var he = $('hud-enemy');
      if (he) {
        if (name === 'playing') unhide(he);
        else hide(he);
      }
      /* HUD bits may live outside #hud in Task 2 shell: keep them synced. */
      var vis = (name === 'playing' || name === 'paused');
      var bits = ['hud-obj', 'hud-key', 'noise-meter'];
      var i;
      for (i = 0; i < bits.length; i++) {
        var el = $(bits[i]);
        if (el && !hud) {
          if (vis) unhide(el); else hide(el);
        }
      }
      if (name !== 'playing') api.banner(null);
      var cross = $('crosshair');
      if (cross) {
        if (name === 'playing') unhide(cross); else hide(cross);
      }
      api.setPrompt(null);
    },

    setPrompt: function (txt) {
      var el = $('prompt');
      if (!el) return;
      if (!txt) { hide(el); return; }
      if (el.textContent !== txt) el.textContent = txt;
      unhide(el);
    },

    setObjective: function (txt) {
      var el = $('hud-obj');
      if (el) el.textContent = txt || '';
    },

    toast: function (txt) {
      if (!txt) return;
      var el = $('toast') || $('caption') || ensureToast();
      if (!el) return;
      el.textContent = txt;
      unhide(el);
      var cap = $('caption');
      if (cap && cap !== el) {
        cap.textContent = txt;
        unhide(cap);
      }
      if (toastTimer) { try { clearTimeout(toastTimer); } catch (e) { /* x */ } }
      toastTimer = setTimeout(function () {
        hide(el);
        if (cap && cap !== el) hide(cap);
        toastTimer = 0;
      }, TOAST_MS);
    },

    setNoise: function (v01) {
      var el = $('noise-fill') || $('noise-meter');
      if (!el) return;
      var v = +v01 || 0;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      el.style.width = Math.round(v * 100) + '%';
    },

    setKey: function (found) {
      var el = $('hud-key');
      if (!el) return;
      el.textContent = found ? '\u25C6 Chapel Key' : '\u25C7 Key: \u2014';
      if (found) el.classList.add('has-key');
      else el.classList.remove('has-key');
    },

    /* AI DIRECTOR pill (live Meta AI): subtle line under the room readout
     * showing the latest tactic + environment event, e.g.
     * 'AI DIRECTOR · ambush_room · lantern_blackout'. Created lazily,
     * updated only on new orders. */
    aiPill: function (tactic, envEvent) {
      try {
        var el = $('hud-ai');
        if (!el) {
          var anchor = $('hud-room') || $('hud-obj');
          if (!anchor || !anchor.parentNode) return;
          el = document.createElement('div');
          el.id = 'hud-ai';
          el.style.display = 'block';
          el.style.fontSize = '11px';
          el.style.opacity = '0.75';
          el.style.letterSpacing = '0.08em';
          if (anchor.nextSibling) anchor.parentNode.insertBefore(el, anchor.nextSibling);
          else anchor.parentNode.appendChild(el);
        }
        el.textContent = 'AI DIRECTOR · ' + tactic + ' · ' + envEvent;
      } catch (err) { /* HUD cosmetic */ }
    },
    /* Cabinet door-crack overlay (HN2 hide): fullscreen pointer-dead
     * layer — near-black door slabs left/right with a clear vertical
     * slit + warm wood edge lines, so hiding reads as peeking through
     * the door gap. Idempotent; survives missing DOM. */
    showHideCrack: function (on) {
      try {
        var el = $('hide-crack');
        if (on) {
          if (!el) {
            el = document.createElement('div');
            el.id = 'hide-crack';
            el.style.position = 'fixed';
            el.style.left = '0';
            el.style.top = '0';
            el.style.width = '100%';
            el.style.height = '100%';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '5';
            el.style.background =
              'linear-gradient(90deg,' +
              'rgba(8,5,3,0.94) 0%,rgba(8,5,3,0.94) 30%,' +
              'rgba(58,36,18,0.9) 36%,rgba(0,0,0,0.12) 44%,' +
              'rgba(0,0,0,0.12) 56%,rgba(58,36,18,0.9) 64%,' +
              'rgba(8,5,3,0.94) 70%,rgba(8,5,3,0.94) 100%)';
            document.body.appendChild(el);
          }
          el.style.display = 'block';
        } else if (el) {
          el.style.display = 'none';
        }
      } catch (err) { /* HUD cosmetic */ }
    },
    banner: function (txt, ms) {
      var el = $('banner');
      if (!el) return;
      if (bannerTimer) { try { clearTimeout(bannerTimer); } catch (e) { /* x */ } bannerTimer = 0; }
      if (!txt) { hide(el); return; }
      el.textContent = txt;
      unhide(el);
      bannerTimer = setTimeout(function () {
        hide(el);
        bannerTimer = 0;
      }, ms || 5000);
    },

    setClearStats: function (timeStr, bestStr, isBest) {
      var t = first(['clear-time', 'clear-stats', 'clear-time-val']);
      if (t) t.textContent = timeStr || '';
      var b = first(['clear-best', 'clear-best-val']);
      if (b) b.textContent = bestStr || '';
      var n = first(['clear-newbest', 'clear-record']);
      if (n) {
        if (isBest) unhide(n); else hide(n);
      }
    },

    /* Stage 2 additive: Butcher Boss alert indicator (state + distance). */
    setEnemy: function (state, distM) {
      var el = $('hud-enemy');
      if (!el) return;
      var s = String(state || 'PATROL').toLowerCase();
      if (s !== 'patrol' && s !== 'suspicious' && s !== 'chase' &&
          s !== 'search' && s !== 'caught') {
        s = 'patrol';
      }
      try { el.setAttribute('data-state', s); } catch (err) { /* x */ }
      var lbl = query('.lbl', el);
      if (lbl) {
        var names = {
          patrol: 'BUTCHER BOSS · CALM', suspicious: 'BUTCHER BOSS · SUSPICIOUS',
          chase: 'BUTCHER BOSS · CHASE', search: 'BUTCHER BOSS · SEARCHING',
          caught: 'PAKDA GAYA'
        };
        lbl.textContent = names[s] || names.patrol;
      }
      var dist = query('.dist', el);
      if (dist) {
        var d = +distM;
        dist.textContent = (isFinite(d) && d < 99) ?
          Math.round(d) + 'm' : '--m';
      }
    },

    /* Stage 2 additive: gameover survival line + flavor line. */
    setGameOverStats: function (sub, line) {
      var s = first(['go-sub', 'gameover-sub']);
      if (s) s.textContent = sub || '';
      var l = first(['go-line', 'gameover-line']);
      if (l) l.textContent = line || '';
    },

    syncSettings: function (s) {
      if (!s) return;
      var vol = first(['volume', 'opt-volume', 'volume-slider']);
      if (vol && typeof s.volume === 'number') writeScaled(vol, s.volume);
      var sen = first(['sensitivity', 'opt-sensitivity', 'sensitivity-slider']);
      if (sen && typeof s.sensitivity === 'number') writeScaled(sen, s.sensitivity);
      var q = first(['quality', 'opt-quality']);
      if (q && s.quality && q.tagName === 'SELECT') writeQuality(q, s.quality);
      var m = first(['mute', 'opt-mute', 'mute-toggle', 'btn-mute']);
      if (m) {
        try {
          if (m.type === 'checkbox') m.checked = !!s.mute;
          else if (m.id === 'btn-mute') m.textContent = s.mute ? 'MUTE: ON' : 'MUTE: OFF';
          else m.textContent = s.mute ? 'UNMUTE' : 'MUTE';
        } catch (err) { /* x */ }
      }
      /* Stage 2 additive: difficulty selector sync. */
      var df = first(['opt-difficulty', 'difficulty', 'difficulty-select']);
      if (df && s.difficulty) {
        try {
          df.value = s.difficulty;
          if (df.selectedIndex < 0) df.value = 'Normal';
        } catch (err) { /* x */ }
      }
    },

    bind: function (h) {
      H = h || {};
      wireButtons();
      wireTouch();
      updateTouchVisibility();
      api.syncSettings(H.settings);
    }
  };

  function wireButtons() {
    var menu = $('menu');
    var pause = $('pause');
    var clear = $('clear');

    var start = first(['menu-start', 'btn-start', 'start-btn']) ||
      (menu ? query('button', menu) : null);
    on(start, 'click', function () { if (H.onStart) H.onStart(); });

    var resume = first(['btn-resume', 'pause-resume', 'resume-btn']) ||
      (pause ? query('[data-act="resume"]', pause) : null);
    on(resume, 'click', function () { if (H.onResume) H.onResume(); });

    var restartP = first(['btn-restart', 'pause-restart', 'restart-btn']) ||
      (pause ? query('[data-act="restart"]', pause) : null);
    on(restartP, 'click', function () { if (H.onRestart) H.onRestart(); });

    var quit = first(['btn-quit', 'pause-quit', 'quit-btn', 'btn-menu']) ||
      (pause ? query('[data-act="quit"]', pause) : null);
    on(quit, 'click', function () { if (H.onQuit) H.onQuit(); });

    var restartC = first(['clear-restart', 'btn-clear-restart', 'btn-restart-clear', 'clear-restart-btn']) ||
      (clear ? query('button', clear) : null);
    on(restartC, 'click', function () { if (H.onRestart) H.onRestart(); });

    var menuC = first(['btn-menu-clear', 'clear-menu', 'clear-quit']);
    on(menuC, 'click', function () { if (H.onQuit) H.onQuit(); });

    /* Stage 2 additive: gameover retry/menu + difficulty selector. */
    var gameover = $('gameover');
    var retryG = first(['btn-go-retry', 'gameover-retry', 'go-restart']) ||
      (gameover ? query('[data-act="retry"]', gameover) : null);
    on(retryG, 'click', function () { if (H.onRestart) H.onRestart(); });

    var menuG = first(['btn-go-menu', 'gameover-menu', 'go-quit']) ||
      (gameover ? query('[data-act="quit"]', gameover) : null);
    on(menuG, 'click', function () { if (H.onQuit) H.onQuit(); });

    var diff = first(['opt-difficulty', 'difficulty', 'difficulty-select']);
    if (diff) {
      on(diff, 'change', function () {
        if (H.onDifficulty) H.onDifficulty(diff.value);
      });
    }

    /* Concept-art portrait hides itself when the file is missing
     * (listener, never an inline handler). */
    var face = query('#gameover .go-face img') || $('go-face-img');
    on(face, 'error', function () {
      try { face.style.display = 'none'; } catch (err) { /* x */ }
    });

    var vol = first(['volume', 'opt-volume', 'volume-slider']);
    on(vol, 'input', function () {
      if (H.onVolume) H.onVolume(readScaled(vol));
    });

    var sen = first(['sensitivity', 'opt-sensitivity', 'sensitivity-slider']);
    on(sen, 'input', function () {
      if (H.onSensitivity) H.onSensitivity(readScaled(sen));
    });

    var q = first(['quality', 'opt-quality']);
    if (q) {
      if (q.tagName === 'SELECT' || q.tagName === 'INPUT') {
        on(q, 'change', function () { if (H.onQuality) H.onQuality(q.value); });
      } else {
        var btns = null;
        try { btns = q.querySelectorAll('[data-q]'); } catch (err) { btns = null; }
        if (btns) {
          var i;
          for (i = 0; i < btns.length; i++) {
            (function (b) {
              on(b, 'click', function () {
                if (H.onQuality) H.onQuality(b.getAttribute('data-q'));
              });
            })(btns[i]);
          }
        }
      }
    }

    var m = first(['mute', 'opt-mute', 'mute-toggle', 'btn-mute']);
    if (m) {
      if (m.type === 'checkbox') {
        on(m, 'change', function () { if (H.onMute) H.onMute(!!m.checked); });
      } else {
        on(m, 'click', function () {
          var cur = (typeof H.getMuted === 'function') ? !!H.getMuted() : false;
          if (H.onMute) H.onMute(!cur);
        });
      }
    }

    var torch = $('btn-torch');
    on(torch, 'click', function () { if (H.onTorch) H.onTorch(); });
    var crouch = $('btn-crouch');
    on(crouch, 'click', function () { if (H.onCrouch) H.onCrouch(); });
    var act = $('btn-act');
    on(act, 'click', function () { if (H.onAct) H.onAct(); });
  }

  function joyKnob() {
    var joy = $('joy');
    if (!joy) return null;
    return query('.joy-knob', joy) || joy.firstElementChild || joy;
  }

  function setKnob(dx, dy) {
    var knob = joyKnob();
    if (!knob) return;
    try {
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    } catch (err) { /* x */ }
  }

  function joyCenter() {
    var joy = $('joy');
    if (!joy) return null;
    try {
      var r = joy.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    } catch (err) { return null; }
  }

  function handleJoy(t, end) {
    var p = player();
    if (end) {
      joyId = null;
      setKnob(0, 0);
      if (p) p.setMoveVec(0, 0);
      return;
    }
    var dx = (t.clientX - joyCX) / JOY_RADIUS;
    var dy = (t.clientY - joyCY) / JOY_RADIUS;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; len = 1; }
    if (len < JOY_DEAD) { dx = 0; dy = 0; }
    setKnob(dx * JOY_RADIUS * 0.6, dy * JOY_RADIUS * 0.6);
    if (p) p.setMoveVec(dx, -dy);
  }

  function onTouchStart(ev) {
    touchSeen = true;
    updateTouchVisibility();
    if (!playing()) return;
    var p = player();
    var i, t;
    for (i = 0; i < ev.changedTouches.length; i++) {
      t = ev.changedTouches[i];
      var tag = (t.target && t.target.tagName) || '';
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') continue;
      var w = window.innerWidth || 800;
      if (t.clientX < w * 0.45 && joyId === null) {
        var c = joyCenter();
        if (!c) continue;
        /* Only anchor touches starting near the stick base. */
        var near = Math.abs(t.clientX - c.x) < c.w &&
          Math.abs(t.clientY - c.y) < c.w * 1.4;
        if (!near) continue;
        joyId = t.identifier;
        joyCX = c.x;
        joyCY = c.y;
        handleJoy(t, false);
        try { ev.preventDefault(); } catch (err) { /* x */ }
      } else if (t.clientX >= w * 0.45 && lookId === null) {
        lookId = t.identifier;
        lookLX = t.clientX;
        lookLY = t.clientY;
        try { ev.preventDefault(); } catch (err) { /* x */ }
      }
    }
    if (p) { /* keep linter calm: p used below via player() */ }
  }

  function onTouchMove(ev) {
    if (!playing()) return;
    var i, t;
    for (i = 0; i < ev.changedTouches.length; i++) {
      t = ev.changedTouches[i];
      if (t.identifier === joyId) {
        handleJoy(t, false);
        try { ev.preventDefault(); } catch (err) { /* x */ }
      } else if (t.identifier === lookId) {
        var dx = t.clientX - lookLX;
        var dy = t.clientY - lookLY;
        lookLX = t.clientX;
        lookLY = t.clientY;
        var p = player();
        if (p) p.setLookDelta(dx, dy);
        try { ev.preventDefault(); } catch (err) { /* x */ }
      }
    }
  }

  function onTouchEnd(ev) {
    var i, t;
    for (i = 0; i < ev.changedTouches.length; i++) {
      t = ev.changedTouches[i];
      if (t.identifier === joyId) handleJoy(t, true);
      if (t.identifier === lookId) lookId = null;
    }
  }

  function wireTouch() {
    var zone = $('canvas-container') || document.body;
    var joy = $('joy');
    on(zone, 'touchstart', onTouchStart, { passive: false });
    on(zone, 'touchmove', onTouchMove, { passive: false });
    on(zone, 'touchend', onTouchEnd, false);
    on(zone, 'touchcancel', onTouchEnd, false);
    if (joy && joy !== zone) {
      on(joy, 'touchstart', onTouchStart, { passive: false });
      on(joy, 'touchmove', onTouchMove, { passive: false });
      on(joy, 'touchend', onTouchEnd, false);
      on(joy, 'touchcancel', onTouchEnd, false);
    }
    on(document, 'touchstart', function once() {
      touchSeen = true;
      updateTouchVisibility();
      try { document.removeEventListener('touchstart', once); }
      catch (err) { /* x */ }
    }, { passive: true });
  }

  function updateTouchVisibility() {
    var coarse = false;
    try {
      coarse = window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches;
    } catch (err) { coarse = false; }
    var show = coarse || touchSeen;
    var ids = ['joy', 'btn-torch', 'btn-crouch', 'btn-act', 'touch-ui'];
    var i;
    for (i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el) continue;
      try {
        el.style.display = show ? '' : 'none';
      } catch (err) { /* x */ }
    }
  }

  startRoomPoll();

  window.StV_UI = api;
})();
