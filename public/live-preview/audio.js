/* Ashes of St. Vermilion — synthesized audio (Stage 1 + Stage 2 ext).
 * window.StV_Audio = {init, ambientStart, thunder, footstep,
 *                     setVolume, setMuted, + additive: setDimmed, pickup,
 *                     setAlert01, queueWhisper, agathaStep}
 * Everything is synthesized at runtime from one shared noise buffer —
 * no audio files are fetched. One AudioContext, one master gain.
 * thunder() is called by the level lightning rig through
 * window.StV_AudioHook (same object, guarded lookups on both sides).
 * Mute silences ALL output, present and future. No-op without AudioContext.
 */
(function () {
  "use strict";

  var ctx = null;
  var master = null;
  var rainG = null;
  var washG = null;
  var droneG = null;
  var noiseBuf = null;
  var ambientOn = false;
  var volume = 0.8;
  var muted = false;
  var dimmed = false;
  var suspended = false;

  /* ---- Stage 2 additive: Agatha stalker stems + whisper scheduler ----
   * Stems: ./assets/audio/agatha_drone.wav + agatha_heart.wav, looped and
   * faded by setAlert01. Whispers: ./assets/whispers.json lines spoken via
   * speechSynthesis with a WebAudio breath-synth bed (no per-line wavs
   * ship, so the synth is the voice when speech is unavailable).
   * Everything here is guarded: failure means silence, never a crash. */
  var alert01 = 0;
  var stalkerInit = false;
  var droneSrc = null;
  var droneG = null;
  var heartSrc = null;
  var heartG = null;
  var whisperLines = null;
  var whisperIdx = { distant: 0, near: 0, chase: 0 };
  var whisperTimer = 0;
  var FALLBACK_LINES = [
    { id: 'distant-0', text: 'Kahan chhupa hai...', mood: 'distant', dur: 3 },
    { id: 'near-0', text: 'Kaun hai wahan...', mood: 'near', dur: 3 },
    { id: 'chase-0', text: 'Ruk jaa beta...', mood: 'chase', dur: 2.5 }
  ];

  function clamp01(x) {
    x = +x || 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function applyStalker() {
    if (!ctx) return;
    try {
      var t = ctx.currentTime || 0;
      if (droneG && droneG.gain) {
        var dg = alert01 < 0.05 ? 0 : alert01 * 0.9;
        droneG.gain.setTargetAtTime(dg, t, 0.4);
      }
      if (heartG && heartG.gain) {
        heartG.gain.setTargetAtTime(alert01 * 0.8, t, 0.4);
      }
      if (heartSrc && heartSrc.playbackRate) {
        heartSrc.playbackRate.setTargetAtTime(1.0 + alert01 * 1.8, t, 0.4);
      }
    } catch (err) {
      /* fades are best-effort */
    }
  }

  function startLoop(buf, gainNode) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gainNode);
    gainNode.connect(master);
    src.start();
    return src;
  }

  function loadStalkerStem(url, isHeart) {
    try {
      if (typeof fetch !== 'function') return;
      fetch(url)
        .then(function (r) {
          if (!r || !r.ok) throw new Error('http ' + (r && r.status));
          return r.arrayBuffer();
        })
        .then(function (ab) {
          if (!ctx) return;
          try {
            ctx.decodeAudioData(
              ab,
              function (buf) {
                if (!buf || suspended) return;
                try {
                  if (isHeart) {
                    if (heartSrc) return;
                    heartG = ctx.createGain();
                    heartG.gain.value = 0;
                    heartSrc = startLoop(buf, heartG);
                  } else {
                    if (droneSrc) return;
                    droneG = ctx.createGain();
                    droneG.gain.value = 0;
                    droneSrc = startLoop(buf, droneG);
                  }
                  applyStalker();
                } catch (err) {
                  /* one silent stem */
                }
              },
              function () {
                /* undecodable: stay silent */
              }
            );
          } catch (err) {
            /* decode threw: stay silent */
          }
        })
        .catch(function () {
          /* fetch failed: stay silent */
        });
    } catch (err) {
      /* no fetch: stay silent */
    }
  }

  function fetchWhispers() {
    try {
      if (typeof fetch !== 'function' || whisperLines) return;
      fetch('./assets/whispers.json')
        .then(function (r) {
          if (!r || !r.ok) throw new Error('http ' + (r && r.status));
          return r.json();
        })
        .then(function (j) {
          if (j && j.lines && j.lines.length) whisperLines = j.lines;
        })
        .catch(function () {
          /* fallback lines stand in */
        });
    } catch (err) {
      /* fallback lines stand in */
    }
  }

  function pickWhisper(mood) {
    var pool = whisperLines || FALLBACK_LINES;
    var i;
    var matches = [];
    for (i = 0; i < pool.length; i++) {
      if (!mood || pool[i].mood === mood) matches.push(pool[i]);
    }
    if (!matches.length) matches = FALLBACK_LINES;
    var k = whisperIdx[mood] || 0;
    whisperIdx[mood] = k + 1;
    return matches[k % matches.length];
  }

  function captionWhisper(text) {
    try {
      var UI = window.StV_UI;
      if (UI && UI.toast) UI.toast(text);
    } catch (err) {
      /* captions are best-effort */
    }
  }

  function speakLine(line, mood) {
    try {
      var synth = window.speechSynthesis;
      if (!synth || typeof synth.speak !== 'function') return false;
      if (typeof synth.cancel === 'function') synth.cancel();
      var u = new window.SpeechSynthesisUtterance(line.text);
      u.volume = volume;
      if (mood === 'chase') {
        u.rate = 1.05;
        u.pitch = 0.8;
      } else if (mood === 'near') {
        u.rate = 0.9;
        u.pitch = 0.6;
      } else {
        u.rate = 0.8;
        u.pitch = 0.5;
      }
      try {
        var vs = synth.getVoices ? synth.getVoices() : [];
        var pick = null;
        var fb = null;
        for (var i = 0; i < vs.length; i++) {
          var lg = String((vs[i] && vs[i].lang) || '');
          if (!fb) fb = vs[i];
          if (/^en[-_]/i.test(lg)) {
            pick = vs[i];
            if (/^en[-_]US/i.test(lg)) break;
          }
        }
        u.voice = pick || fb || null;
      } catch (err) {
        /* default voice stands */
      }
      synth.speak(u);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* Formant breath-synth: shaped noise bed under (or instead of) speech. */
  function synthWhisper(dur) {
    if (!ctx || !noiseBuf || muted || suspended) return;
    try {
      var t = ctx.currentTime;
      var d = Math.min(8, Math.max(1.5, +dur || 3));
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.7;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(1600, t + d * 0.4);
      bp.frequency.linearRampToValueAtTime(700, t + d);
      var bp2 = ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = 2600;
      bp2.Q.value = 4;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.16, t + d * 0.25);
      g.gain.linearRampToValueAtTime(0.001, t + d);
      var g2 = ctx.createGain();
      g2.gain.value = 0.35;
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.connect(bp2);
      bp2.connect(g2);
      g2.connect(g);
      src.start(t);
      src.stop(t + d + 0.05);
    } catch (err) {
      /* silence on failure */
    }
  }

  function autoMood() {
    if (alert01 >= 0.75) return 'chase';
    if (alert01 >= 0.4) return 'near';
    return 'distant';
  }

  function fireWhisper(mood) {
    var m = mood === 'near' || mood === 'chase' ? mood : 'distant';
    if (!ctx || muted || suspended) return;
    var line = pickWhisper(m);
    if (!line) return;
    captionWhisper(line.text);
    speakLine(line, m);
    synthWhisper(line.dur);
  }

  function schedNextWhisper() {
    if (whisperTimer) {
      try {
        clearTimeout(whisperTimer);
      } catch (err) {
        /* x */
      }
      whisperTimer = 0;
    }
    try {
      var k = clamp01((alert01 - 0.15) / 0.85);
      var base = 21.5 - k * (21.5 - 5);
      var delay = base * (0.85 + Math.random() * 0.3);
      whisperTimer = setTimeout(function () {
        whisperTimer = 0;
        fireWhisper(autoMood());
        schedNextWhisper();
      }, Math.max(2500, delay * 1000));
    } catch (err) {
      /* timers unavailable: whispers stay quiet */
    }
  }

  function ensureStalker() {
    if (!ctx || stalkerInit) {
      if (ctx && stalkerInit) applyStalker();
      return;
    }
    stalkerInit = true;
    loadStalkerStem('./assets/audio/agatha_drone.wav', false);
    loadStalkerStem('./assets/audio/agatha_heart.wav', true);
    fetchWhispers();
    schedNextWhisper();
  }

  function applyGain() {
    if (!ctx || !master) return;
    if (suspended) {
      try {
        master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.015);
      } catch (err) {
        /* older backends */
      }
      return;
    }
    var g = muted ? 0 : volume * (dimmed ? 0.25 : 1);
    try {
      master.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    } catch (err) {
      /* older backends */
    }
  }

  function makeNoise(seconds) {
    var rate = ctx.sampleRate || 44100;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  var api = {
    ctx: null,
    master: null,
    init: function () {
      if (ctx) {
        api.ctx = ctx;
        api.master = master;
        try {
          if (!suspended && ctx.state === "suspended") ctx.resume();
        } catch (err) {
          /* ignore */
        }
        return true;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
        api.ctx = ctx;
        api.master = master;
        noiseBuf = makeNoise(2);
        applyGain();
        if (!suspended && ctx.state === "suspended") ctx.resume();
      } catch (err) {
        ctx = null;
        master = null;
        api.ctx = null;
        api.master = null;
        return false;
      }
      return true;
    },

    ambientStart: function () {
      if (!ctx || ambientOn) return;
      ambientOn = true;
      try {
        /* Rain: looped noise through airy band + low wash. */
        var rain = ctx.createBufferSource();
        rain.buffer = noiseBuf;
        rain.loop = true;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1700;
        bp.Q.value = 0.55;
        rainG = ctx.createGain();
        rainG.gain.value = 0.09;
        rain.connect(bp);
        bp.connect(rainG);
        rainG.connect(master);
        rain.start();

        var wash = ctx.createBufferSource();
        wash.buffer = noiseBuf;
        wash.loop = true;
        wash.playbackRate.value = 0.4;
        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 420;
        washG = ctx.createGain();
        washG.gain.value = 0.07;
        wash.connect(lp);
        lp.connect(washG);
        washG.connect(master);
        wash.start();

        /* Drone: two detuned sines near 55 Hz. */
        droneG = ctx.createGain();
        droneG.gain.value = 0.05;
        var droneLP = ctx.createBiquadFilter();
        droneLP.type = "lowpass";
        droneLP.frequency.value = 130;
        droneG.connect(droneLP);
        droneLP.connect(master);
        var o1 = ctx.createOscillator();
        o1.type = "sine";
        o1.frequency.value = 55;
        var o2 = ctx.createOscillator();
        o2.type = "sine";
        o2.frequency.value = 55.8;
        o1.connect(droneG);
        o2.connect(droneG);
        o1.start();
        o2.start();
      } catch (err) {
        /* keep game silent, never crash */
      }
    },

    thunder: function () {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      try {
        var t = ctx.currentTime;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = 0.5;
        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(520, t);
        lp.frequency.exponentialRampToValueAtTime(48, t + 1.9);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.85, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
        src.connect(lp);
        lp.connect(g);
        g.connect(master);
        src.start(t, Math.random() * 0.8);
        src.stop(t + 2.4);

        var sub = ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(58, t);
        sub.frequency.exponentialRampToValueAtTime(27, t + 1.4);
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(0.001, t);
        sg.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        sub.connect(sg);
        sg.connect(master);
        sub.start(t);
        sub.stop(t + 1.7);
      } catch (err) {
        /* ignore */
      }
      /* No VFX call here by design: thunder arrives 300-1200ms after the
       * strike starts, while VFX polls scene.userData.stvFlash every frame
       * for exact envelope sync (Task 2 concern #2). */
    },

    footstep: function (run) {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      try {
        var t = ctx.currentTime;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.1;
        if (run) {
          bp.frequency.value = 210 + Math.random() * 160;
        } else {
          bp.frequency.value = 340 + Math.random() * 320;
        }
        var g = ctx.createGain();
        var peak = run ? 0.5 : 0.26;
        var dur = run ? 0.13 : 0.09;
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp);
        bp.connect(g);
        g.connect(master);
        src.start(t, Math.random() * 1.4);
        src.stop(t + dur + 0.05);
      } catch (err) {
        /* ignore */
      }
    },

    pickup: function () {
      if (!ctx) return;
      try {
        var t = ctx.currentTime;
        var notes = [523.25, 784.0];
        var i;
        for (i = 0; i < notes.length; i++) {
          var o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = notes[i];
          var g = ctx.createGain();
          var at = t + i * 0.11;
          g.gain.setValueAtTime(0.001, at);
          g.gain.exponentialRampToValueAtTime(0.32, at + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
          o.connect(g);
          g.connect(master);
          o.start(at);
          o.stop(at + 0.55);
        }
      } catch (err) {
        /* ignore */
      }
    },

    setVolume: function (v) {
      if (typeof v === "number" && isFinite(v)) {
        volume = Math.min(1, Math.max(0, v));
      }
      applyGain();
    },

    setMuted: function (m) {
      muted = !!m;
      applyGain();
    },

    setDimmed: function (d) {
      dimmed = !!d;
      applyGain();
    },

    suspendAll: function () {
      suspended = true;
      dimmed = true;
      if (ctx && master) {
        try {
          var t = ctx.currentTime || 0;
          if (master.gain.cancelScheduledValues) {
            master.gain.cancelScheduledValues(t);
          }
          master.gain.setTargetAtTime(0.0001, t, 0.015);
          master.gain.value = 0.0001;
          if (rainG && rainG.gain) rainG.gain.setTargetAtTime(0.0001, t, 0.015);
          if (washG && washG.gain) washG.gain.setTargetAtTime(0.0001, t, 0.015);
          if (droneG && droneG.gain)
            droneG.gain.setTargetAtTime(0.0001, t, 0.015);
        } catch (err) {
          /* ignore */
        }
      }
      if (ctx && ctx.state === "running" && typeof ctx.suspend === "function") {
        try {
          ctx.suspend();
        } catch (err) {
          /* ignore */
        }
      }
      try {
        var audios = document.querySelectorAll("audio");
        for (var i = 0; i < audios.length; i++) {
          if (audios[i] && typeof audios[i].pause === "function") {
            audios[i].pause();
          }
        }
      } catch (err) {
        /* ignore */
      }
      try {
        if (
          window.speechSynthesis &&
          typeof window.speechSynthesis.cancel === "function"
        ) {
          window.speechSynthesis.cancel();
        }
      } catch (err) {
        /* ignore */
      }
    },

    resumeAll: function () {
      suspended = false;
      dimmed = false;
      if (muted) return;
      if (
        ctx &&
        ctx.state === "suspended" &&
        typeof ctx.resume === "function"
      ) {
        try {
          ctx.resume();
        } catch (err) {
          /* ignore */
        }
      }
      if (ctx) {
        try {
          var t = ctx.currentTime || 0;
          if (rainG && rainG.gain) rainG.gain.setTargetAtTime(0.09, t, 0.04);
          if (washG && washG.gain) washG.gain.setTargetAtTime(0.07, t, 0.04);
          if (droneG && droneG.gain) droneG.gain.setTargetAtTime(0.05, t, 0.04);
        } catch (err) {
          /* ignore */
        }
      }
      applyGain();
    },

    isSuspended: function () {
      return suspended;
    },

    isMuted: function () {
      return muted;
    },

    /* ---- Stage 2 additive API (existing methods above unchanged) ---- */

    setAlert01: function (x) {
      alert01 = clamp01(x);
      ensureStalker();
      return alert01;
    },

    queueWhisper: function (mood) {
      var m = mood === 'near' || mood === 'chase' ? mood : 'distant';
      ensureStalker();
      fireWhisper(m);
      schedNextWhisper();
    },

    agathaStep: function (chase) {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      try {
        var t = ctx.currentTime;
        var heavy = !!chase;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = heavy ? 0.55 : 0.4;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = heavy ? 300 : 220;
        var g = ctx.createGain();
        var peak = heavy ? 0.5 : 0.22;
        var dur = heavy ? 0.16 : 0.2;
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(lp);
        lp.connect(g);
        g.connect(master);
        src.start(t, Math.random() * 1.2);
        src.stop(t + dur + 0.05);
        /* Habit swish riding the thud. */
        var sw = ctx.createBufferSource();
        sw.buffer = noiseBuf;
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2400;
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(0.001, t);
        sg.gain.exponentialRampToValueAtTime(heavy ? 0.1 : 0.05, t + 0.03);
        sg.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.1);
        sw.connect(hp);
        hp.connect(sg);
        sg.connect(master);
        sw.start(t, Math.random() * 1.2);
        sw.stop(t + dur + 0.15);
      } catch (err) {
        /* ignore */
      }
    },
  };

  window.StV_Audio = api;
  /* Level lightning rig calls thunder() through this hook. */
  window.StV_AudioHook = api;
  window.G = window.G || {};
  window.G.AudioSys = api;
})();
