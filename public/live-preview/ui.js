/* Ashes of St. Vermilion — screens, HUD, menus, touch (Stage 1).
 * window.StV_UI = {show, setObjective, toast, + additive: bind, setNoise,
 *   setKey, banner, setClearStats, syncSettings}
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

  var api = {
    show: function (name) {
      var menu = $('menu');
      var pause = $('pause');
      var clear = $('clear');
      var hud = $('hud');
      hide(menu); hide(pause); hide(clear);
      if (name === 'menu') unhide(menu);
      else if (name === 'paused') unhide(pause);
      else if (name === 'stageclear') unhide(clear);
      if (hud) {
        if (name === 'playing' || name === 'paused') unhide(hud);
        else hide(hud);
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

  window.StV_UI = api;
})();
