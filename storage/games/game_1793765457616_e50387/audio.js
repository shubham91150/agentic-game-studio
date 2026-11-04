/* Ashes of St. Vermilion — master sound design (Stage 4 overhaul).
 * window.StV_Audio = {init, ambientStart, thunder, footstep(run, crouch),
 *                     pickup, doorCreak, lanternTick, setListener, setAgatha,
 *                     setEnemyState, setVolume, setMuted, setDimmed,
 *                     suspendAll, resumeAll, isSuspended, isMuted,
 *                     setAlert01, queueWhisper, agathaStep(chase, ax, az)}
 * window.StV_AudioDebug = {state()} -> {ctxState, buses, alert01, bpm,
 *                                        lastPan, lastCutoff}
 *
 * Architecture (per .agents/memory/game-sound-design-and-audio-architecture.md):
 *   [BGM bus] ----+
 *   [Ambient bus]-+--> dry ---------------+
 *   [SFX bus] ----+--> 20-35% wet sends -->+--> [ConvolverNode cathedral IR
 *   [Voice bus] --+                        |     1.6s, pow(1-i/len,2.6)]
 *                                          +--> [DynamicsCompressor]
 *                                               --> [Master] --> destination
 * Adaptive BGM: drone.wav loop (PATROL calm) + dark harmonic A-stack oscs
 * (SUSPICIOUS/SEARCH tense) + heart.wav loop + 55Hz lub-dub synth
 * (CHASE pulse), crossfaded with linearRampToValueAtTime, 0.4s.
 * Heartbeat BPM 65 -> 145 by Agatha distance < 14m.
 * 3D spatial: StereoPanner pan = clamp(sin(relAngle)) + lowpass
 * 4200 -> 450Hz + 1/(1+d*0.22) gain by distance. Whispers duck BGM+ambient
 * 40%. Every SFX is 3-part (transient + body + tail) — zero bare sine beeps.
 * suspendAll()/resumeAll() semantics preserved exactly: suspend silences
 * 100% (master -> 0.0001, ctx.suspend, <audio> pause, speech cancel);
 * resume restores loop/crossfade levels and the beat clock.
 */
(function () {
  "use strict";

  var ctx = null;
  var master = null;
  var compNode = null;
  var verb = null;
  var verbGain = null;
  var busBgm = null;
  var busAmb = null;
  var busSfx = null;
  var busVox = null;
  var sendBgm = null;
  var sendAmb = null;
  var sendSfx = null;
  var sendVox = null;
  var noiseBuf = null;
  var orbStep = 0; /* Subagent C: pentatonic orb-chime combo counter. */
  var rainG = null;
  var washG = null;
  var ambientOn = false;
  var volume = 0.8;
  var muted = false;
  var dimmed = false;
  var suspended = false;

  /* ---- Adaptive BGM: stalker stems + dark drone + heartbeat ---- */
  var alert01 = 0;
  var threatState = "PATROL";
  var threatDist = 99;
  var bpm = 65;
  var stalkerInit = false;
  var droneSrc = null;
  var calmG = null;
  var heartSrc = null;
  var chasePulseG = null;
  var tenseG = null;
  var beatG = null;
  var darkOscs = null;
  var beatTimer = 0;
  var nextBeatT = 0;
  var duckSeq = 0;

  /* ---- 3D spatial listener/Agatha poses ---- */
  var listener = { x: 0, z: 8.5, yaw: 0, ok: false };
  var agatha = { x: 0, z: -7.5, ok: false };
  var lastPan = null;
  var lastCutoff = null;
  var lastDist = null;
  var lastCrackleT = 0;

  /* ---- Whispers (./assets/whispers.json via speech + breath synth) ---- */
  var whisperLines = null;
  var whisperIdx = { distant: 0, near: 0, chase: 0 };
  var whisperTimer = 0;
  var FALLBACK_LINES = [
    { id: "distant-0", text: "Kahan chhupa hai...", mood: "distant", dur: 3 },
    { id: "near-0", text: "Kaun hai wahan...", mood: "near", dur: 3 },
    { id: "chase-0", text: "Ruk jaa beta...", mood: "chase", dur: 2.5 }
  ];

  function clamp01(x) {
    x = +x || 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function jitter12() {
    return 1 + (Math.random() * 2 - 1) * 0.12;
  }

  function normAng(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function rampGain(g, v, t, dur) {
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(v, t + dur);
    } catch (err) {
      try {
        g.gain.value = v;
      } catch (err2) {
        /* older backends */
      }
    }
  }

  /* ---- Cathedral impulse response: 1.6s stereo decaying noise ---- */
  function makeCathedralIR() {
    var rate = ctx.sampleRate || 44100;
    var len = Math.floor(rate * 1.6);
    var ir = ctx.createBuffer(2, len, rate);
    var taps = [
      [0.013, 0.5],
      [0.027, 0.34],
      [0.041, 0.22]
    ];
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      var i;
      for (i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      /* Early reflections: discrete taps at 13/27/41ms. */
      for (var k = 0; k < taps.length; k++) {
        var at = Math.floor(taps[k][0] * rate);
        if (at < len) d[at] += taps[k][1] * (c === 0 ? 1 : -1);
      }
    }
    return ir;
  }

  function buildMixer() {
    master = ctx.createGain();
    master.gain.value = 0.8;
    compNode = ctx.createDynamicsCompressor();
    try {
      compNode.threshold.value = -18;
      compNode.ratio.value = 4;
      compNode.attack.value = 0.004;
      compNode.release.value = 0.24;
    } catch (err) {
      /* defaults stand */
    }
    compNode.connect(master);
    master.connect(ctx.destination);

    /* Cathedral wet return shared by all four buses. */
    verb = ctx.createConvolver();
    verb.buffer = makeCathedralIR();
    verbGain = ctx.createGain();
    verbGain.gain.value = 1.0;
    verb.connect(verbGain);
    verbGain.connect(compNode);

    /* Four buses: dry -> comp, plus 20-35% wet sends -> convolver. */
    busBgm = ctx.createGain();
    busAmb = ctx.createGain();
    busSfx = ctx.createGain();
    busVox = ctx.createGain();
    busBgm.connect(compNode);
    busAmb.connect(compNode);
    busSfx.connect(compNode);
    busVox.connect(compNode);
    sendBgm = ctx.createGain();
    sendAmb = ctx.createGain();
    sendSfx = ctx.createGain();
    sendVox = ctx.createGain();
    sendBgm.gain.value = 0.2;
    sendAmb.gain.value = 0.25;
    sendSfx.gain.value = 0.3;
    sendVox.gain.value = 0.35;
    busBgm.connect(sendBgm);
    sendBgm.connect(verb);
    busAmb.connect(sendAmb);
    sendAmb.connect(verb);
    busSfx.connect(sendSfx);
    sendSfx.connect(verb);
    busVox.connect(sendVox);
    sendVox.connect(verb);
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

  /* ---- Adaptive threat: state x alert01 -> calm/tense/chase tier ----
   * Tier is the max of the enemy-state tier and the alert01 tier so the
   * director's proximity floors (crouch 0.85 etc.) still raise tension
   * even before setEnemyState arrives. */
  function stateTierNum() {
    if (threatState === "CHASE" || threatState === "CAUGHT") return 2;
    if (threatState === "SUSPICIOUS" || threatState === "SEARCH") return 1;
    return 0;
  }

  function threatTier() {
    var aTier = alert01 >= 0.75 ? 2 : alert01 >= 0.4 ? 1 : 0;
    var t = Math.max(stateTierNum(), aTier);
    return t === 2 ? "chase" : t === 1 ? "tense" : "calm";
  }

  function updateBpm() {
    bpm = 65 + 80 * clamp01(1 - threatDist / 14);
  }

  /* Crossfade the three BGM layers + heartbeat level per tier. */
  function applyThreat() {
    if (!ctx) return;
    updateBpm();
    try {
      var t = ctx.currentTime || 0;
      var tier = threatTier();
      var calmV = tier === "calm" ? 0.35 : tier === "tense" ? 0.18 : 0.07;
      var tenseV = tier === "calm" ? 0.0 : tier === "tense" ? 0.5 : 0.3;
      var chaseV = tier === "calm" ? 0.0 : tier === "tense" ? 0.15 : 0.75;
      var prox = 0.35 + 0.65 * clamp01(1 - threatDist / 16);
      var beatV = tier === "calm" ? 0.0 : tier === "tense" ? 0.22 * prox : 0.5 * prox;
      if (calmG) rampGain(calmG, calmV, t, 0.4);
      if (tenseG) rampGain(tenseG, tenseV, t, 0.4);
      if (chasePulseG) rampGain(chasePulseG, chaseV, t, 0.4);
      if (beatG) rampGain(beatG, beatV, t, 0.4);
      if (heartSrc && heartSrc.playbackRate) {
        heartSrc.playbackRate.setTargetAtTime(bpm / 65, t, 0.4);
      }
    } catch (err) {
      /* fades are best-effort */
    }
  }

  function startLoop(buf, gainNode, bus) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gainNode);
    gainNode.connect(bus);
    src.start();
    return src;
  }

  function loadStalkerStem(url, isHeart) {
    try {
      if (typeof fetch !== "function") return;
      fetch(url)
        .then(function (r) {
          if (!r || !r.ok) throw new Error("http " + (r && r.status));
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
                    chasePulseG = ctx.createGain();
                    chasePulseG.gain.value = 0;
                    heartSrc = startLoop(buf, chasePulseG, busBgm);
                  } else {
                    if (droneSrc) return;
                    calmG = ctx.createGain();
                    calmG.gain.value = 0;
                    droneSrc = startLoop(buf, calmG, busBgm);
                  }
                  applyThreat();
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

  /* Dark harmonic drone: detuned A1 + E2/A2/E3 power stack. The 55/55.8Hz
   * pair beats at 0.8Hz so the bed breathes without any LFO node. */
  function startDarkDrone() {
    if (!ctx || darkOscs) {
      if (ctx && tenseG) applyThreat();
      return;
    }
    try {
      tenseG = ctx.createGain();
      tenseG.gain.value = 0;
      tenseG.connect(busBgm);
      beatG = ctx.createGain();
      beatG.gain.value = 0;
      beatG.connect(busBgm);
      var stack = [
        [55, "sine", 0.5],
        [55.8, "sine", 0.5],
        [82.41, "sine", 0.3],
        [110.2, "triangle", 0.2],
        [164.81, "triangle", 0.09]
      ];
      darkOscs = [];
      for (var i = 0; i < stack.length; i++) {
        var o = ctx.createOscillator();
        o.type = stack[i][1];
        o.frequency.value = stack[i][0];
        var trim = ctx.createGain();
        trim.gain.value = stack[i][2];
        o.connect(trim);
        trim.connect(tenseG);
        o.start();
        darkOscs.push(o);
      }
      applyThreat();
    } catch (err) {
      darkOscs = null;
      /* drone is best-effort */
    }
  }

  /* One 55Hz-class thump: pitch-dropping body + click transient. */
  function beatThump(t, peak) {
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.1);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g);
    g.connect(beatG);
    o.start(t);
    o.stop(t + 0.16);
    var n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(Math.max(0.001, peak * 0.35), t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(beatG);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.04);
  }

  /* Lub-dub scheduler: 120ms lookahead, silent in PATROL calm. */
  function beatTick() {
    if (!ctx || !noiseBuf || !beatG || muted || suspended) {
      nextBeatT = 0;
      return;
    }
    try {
      if (ctx.state !== "running") {
        nextBeatT = 0;
        return;
      }
    } catch (err) {
      return;
    }
    if (threatTier() === "calm" || threatDist > 16) {
      nextBeatT = 0;
      return;
    }
    try {
      var now = ctx.currentTime;
      if (!nextBeatT || nextBeatT < now - 0.5) nextBeatT = now + 0.05;
      var rate = Math.max(40, bpm);
      var interval = 60 / rate;
      var gap = Math.min(0.32, 15 / rate);
      var guard = 0;
      while (nextBeatT < now + 0.35 && guard < 4) {
        beatThump(nextBeatT, 0.5);
        beatThump(nextBeatT + gap, 0.38);
        nextBeatT += interval;
        guard++;
      }
    } catch (err) {
      /* scheduler is best-effort */
    }
  }

  /* Duck BGM + ambient buses 40% for a whisper, then restore. */
  function duckDuring(dur) {
    if (!ctx || !busBgm || !busAmb) return;
    try {
      var t = ctx.currentTime;
      var my = ++duckSeq;
      rampGain(busBgm, 0.6, t, 0.15);
      rampGain(busAmb, 0.6, t, 0.15);
      setTimeout(function () {
        if (my !== duckSeq || !ctx) return;
        try {
          var t2 = ctx.currentTime;
          rampGain(busBgm, 1.0, t2, 0.5);
          rampGain(busAmb, 1.0, t2, 0.5);
        } catch (err) {
          /* x */
        }
      }, Math.max(500, dur * 1000));
    } catch (err) {
      /* x */
    }
  }

  /* ---- 3D spatial: pan + lowpass + falloff for world sounds ----
   * Listener forward on XZ is (-sin yaw, -cos yaw) (player.js look/move
   * model). rel = forwardAngle - sourceAngle, so sin(rel) is +1 when
   * Agatha stands to the player's right, -1 on the left, 0 ahead. */
  function neutralSpatial() {
    return { pan: 0, cutoff: 4200, gain: 1, dist: 99 };
  }

  function spatialFor(sx, sz) {
    if (!listener.ok) return neutralSpatial();
    var dx = sx - listener.x;
    var dz = sz - listener.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var phi = Math.atan2(-Math.sin(listener.yaw), -Math.cos(listener.yaw));
    var theta = Math.atan2(dx, dz);
    var pan = Math.sin(normAng(phi - theta));
    if (pan > 0.95) pan = 0.95;
    if (pan < -0.95) pan = -0.95;
    var cutoff = 4200 - dist * 220;
    if (cutoff < 450) cutoff = 450;
    var gain = 1 / (1 + dist * 0.22);
    lastPan = Math.round(pan * 1000) / 1000;
    lastCutoff = Math.round(cutoff);
    lastDist = Math.round(dist * 10) / 10;
    return { pan: pan, cutoff: cutoff, gain: gain, dist: dist };
  }

  /* Build gain -> [panner] -> lowpass -> bus; sources connect into the
   * returned head with relative 0..1 envelopes under the base level. */
  function spatialTail(bus, s, base) {
    var g = ctx.createGain();
    g.gain.value = Math.max(0.0001, base * s.gain);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = s.cutoff;
    if (typeof ctx.createStereoPanner === "function") {
      var p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      g.connect(p);
      p.connect(lp);
      lp.connect(bus);
    } else {
      g.connect(lp);
      lp.connect(bus);
    }
    return g;
  }

  function agathaSpatial() {
    if (agatha.ok) return spatialFor(agatha.x, agatha.z);
    return neutralSpatial();
  }

  /* ---- Whispers: whispers.json lines via speech + breath synth ---- */
  function fetchWhispers() {
    try {
      if (typeof fetch !== "function" || whisperLines) return;
      fetch("./assets/whispers.json")
        .then(function (r) {
          if (!r || !r.ok) throw new Error("http " + (r && r.status));
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
      if (!synth || typeof synth.speak !== "function") return false;
      if (typeof synth.cancel === "function") synth.cancel();
      var u = new window.SpeechSynthesisUtterance(line.text);
      u.volume = volume;
      if (mood === "chase") {
        u.rate = 1.05;
        u.pitch = 0.8;
      } else if (mood === "near") {
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
          var lg = String((vs[i] && vs[i].lang) || "");
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

  /* Formant breath-synth bed: transient sibilance + formant body + soft
   * tail, spatialized at Agatha's pose into the voice bus. */
  function synthWhisper(dur, mood) {
    if (!ctx || !noiseBuf || muted || suspended) return;
    try {
      var t = ctx.currentTime;
      var d = Math.min(8, Math.max(1.5, +dur || 3));
      var s = agathaSpatial();
      var moodK = mood === "chase" ? 1.25 : mood === "near" ? 1.0 : 0.75;
      var tail = spatialTail(busVox, s, 0.16 * moodK);
      /* (1) Transient: airy sibilance tick under the first syllable. */
      var tick = ctx.createBufferSource();
      tick.buffer = noiseBuf;
      tick.playbackRate.value = 1.3;
      var hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5200;
      var tg = ctx.createGain();
      tg.gain.setValueAtTime(0.5, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      tick.connect(hp);
      hp.connect(tg);
      tg.connect(tail);
      tick.start(t, Math.random() * 1.5);
      tick.stop(t + 0.12);
      /* (2) Body: wandering formant bed. */
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.7;
      var bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(1600, t + d * 0.4);
      bp.frequency.linearRampToValueAtTime(700, t + d);
      var bp2 = ctx.createBiquadFilter();
      bp2.type = "bandpass";
      bp2.frequency.value = 2600;
      bp2.Q.value = 4;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(1.0, t + d * 0.25);
      g.gain.linearRampToValueAtTime(0.001, t + d);
      var g2 = ctx.createGain();
      g2.gain.value = 0.35;
      src.connect(bp);
      bp.connect(g);
      g.connect(tail);
      src.connect(bp2);
      bp2.connect(g2);
      g2.connect(g);
      src.start(t);
      src.stop(t + d + 0.05);
      duckDuring(d);
    } catch (err) {
      /* silence on failure */
    }
  }

  function autoMood() {
    if (alert01 >= 0.75) return "chase";
    if (alert01 >= 0.4) return "near";
    return "distant";
  }

  function fireWhisper(mood) {
    var m = mood === "near" || mood === "chase" ? mood : "distant";
    if (!ctx || muted || suspended) return;
    var line = pickWhisper(m);
    if (!line) return;
    captionWhisper(line.text);
    speakLine(line, m);
    synthWhisper(line.dur, m);
  }

  function schedNextWhisper() {
    /* Subagent D: Agatha's auto-whispers (voice + toast captions) belong
     * to the convent — the Hollow Lantern platformer stays silent. */
    try {
      if (window.__stvPlatformMode === true) return;
    } catch (err) {
      /* horror path stands */
    }
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

  function ensureBgm() {
    if (!ctx) return;
    startDarkDrone();
    if (stalkerInit) {
      applyThreat();
      return;
    }
    stalkerInit = true;
    loadStalkerStem("./assets/audio/agatha_drone.wav", false);
    loadStalkerStem("./assets/audio/agatha_heart.wav", true);
    fetchWhispers();
    schedNextWhisper();
    if (!beatTimer) {
      try {
        beatTimer = setInterval(beatTick, 120);
      } catch (err) {
        beatTimer = 0;
      }
    }
  }

  function r3(x) {
    x = +x || 0;
    return Math.round(x * 1000) / 1000;
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
        buildMixer();
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
      ensureBgm();
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
        rainG.connect(busAmb);
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
        washG.connect(busAmb);
        wash.start();
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
        g.connect(busSfx);
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
        sg.connect(busSfx);
        sub.start(t);
        sub.stop(t + 1.7);
      } catch (err) {
        /* ignore */
      }
      /* No VFX call here by design: thunder arrives 300-1200ms after the
       * strike starts, while VFX polls scene.userData.stvFlash every frame
       * for exact envelope sync (Task 2 concern #2). */
    },

    /* 3-part footstep: heel scuff (35ms transient) + 105->42Hz floor
     * thud (body) + soft wash (tail), +/-12% jitter, stance variants. */
    footstep: function (run, crouch) {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      try {
        var t = ctx.currentTime;
        var scuffF;
        var scuffPeak;
        var thudPeak;
        if (crouch) {
          scuffF = 450;
          scuffPeak = 0.1;
          thudPeak = 0.12;
        } else if (run) {
          scuffF = 1800;
          scuffPeak = 0.34;
          thudPeak = 0.42;
        } else {
          scuffF = 1100;
          scuffPeak = 0.22;
          thudPeak = 0.25;
        }
        scuffF *= jitter12();
        scuffPeak *= jitter12();
        thudPeak *= jitter12();
        /* (1) Transient: heel/sole scuff. */
        var sc = ctx.createBufferSource();
        sc.buffer = noiseBuf;
        var sbp = ctx.createBiquadFilter();
        sbp.type = "bandpass";
        sbp.frequency.value = scuffF;
        sbp.Q.value = 1.1;
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(scuffPeak, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
        sc.connect(sbp);
        sbp.connect(sg);
        sg.connect(busSfx);
        sc.start(t, Math.random() * 1.4);
        sc.stop(t + 0.06);
        /* (2) Body: floor resonance thud, 105 -> 42Hz pitch drop. */
        var th = ctx.createOscillator();
        th.type = "sine";
        th.frequency.setValueAtTime(105 * jitter12(), t);
        th.frequency.exponentialRampToValueAtTime(42, t + 0.07);
        var tg = ctx.createGain();
        tg.gain.setValueAtTime(0.001, t);
        tg.gain.exponentialRampToValueAtTime(thudPeak, t + 0.008);
        tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        th.connect(tg);
        tg.connect(busSfx);
        th.start(t);
        th.stop(t + 0.12);
        /* (3) Tail: soft lowpassed wash. */
        var w = ctx.createBufferSource();
        w.buffer = noiseBuf;
        w.playbackRate.value = 0.6;
        var wlp = ctx.createBiquadFilter();
        wlp.type = "lowpass";
        wlp.frequency.value = 500;
        var wg = ctx.createGain();
        wg.gain.setValueAtTime(Math.max(0.001, scuffPeak * 0.25), t + 0.01);
        wg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        w.connect(wlp);
        wlp.connect(wg);
        wg.connect(busSfx);
        w.start(t, Math.random() * 1.4);
        w.stop(t + 0.14);
      } catch (err) {
        /* ignore */
      }
    },

    /* Chapel-key chime: mallet strike + 4 inharmonic bell partials with
     * staggered 0/18/35/52ms micro-attacks and 0.6s shimmer decay. */
    pickup: function () {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var tick = ctx.createBufferSource();
        tick.buffer = noiseBuf;
        var thp = ctx.createBiquadFilter();
        thp.type = "highpass";
        thp.frequency.value = 5000;
        var tkg = ctx.createGain();
        tkg.gain.setValueAtTime(0.12, t);
        tkg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        tick.connect(thp);
        thp.connect(tkg);
        tkg.connect(busSfx);
        tick.start(t, Math.random() * 1.5);
        tick.stop(t + 0.04);
        var partials = [1980, 2740, 3610, 4820];
        var amps = [0.22, 0.15, 0.11, 0.07];
        var ats = [0, 0.018, 0.035, 0.052];
        for (var i = 0; i < partials.length; i++) {
          var o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = partials[i] * (1 + (Math.random() * 2 - 1) * 0.0015);
          var g = ctx.createGain();
          var at = t + ats[i];
          g.gain.setValueAtTime(0.001, at);
          g.gain.exponentialRampToValueAtTime(amps[i], at + 0.005);
          g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
          o.connect(g);
          g.connect(busSfx);
          o.start(at);
          o.stop(at + 0.65);
        }
      } catch (err) {
        /* ignore */
      }
    },

    /* Chapel door: FM creak (saw 85->62Hz through resonant bandpass)
     * + metallic latch clunk (320Hz knock + 1400Hz burst) on release. */
    doorCreak: function () {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var car = ctx.createOscillator();
        car.type = "sawtooth";
        car.frequency.setValueAtTime(85, t);
        car.frequency.linearRampToValueAtTime(62, t + 0.7);
        var mod = ctx.createOscillator();
        mod.type = "sine";
        mod.frequency.setValueAtTime(7, t);
        mod.frequency.linearRampToValueAtTime(3, t + 0.7);
        var mg = ctx.createGain();
        mg.gain.value = 18;
        mod.connect(mg);
        mg.connect(car.frequency);
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 300;
        bp.Q.value = 6;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.15);
        g.gain.linearRampToValueAtTime(0.18, t + 0.4);
        g.gain.linearRampToValueAtTime(0.001, t + 0.75);
        car.connect(bp);
        bp.connect(g);
        g.connect(busSfx);
        car.start(t);
        mod.start(t);
        car.stop(t + 0.8);
        mod.stop(t + 0.8);
        var tc = t + 0.7;
        var knock = ctx.createOscillator();
        knock.type = "triangle";
        knock.frequency.setValueAtTime(320, tc);
        knock.frequency.exponentialRampToValueAtTime(180, tc + 0.09);
        var kg = ctx.createGain();
        kg.gain.setValueAtTime(0.4, tc);
        kg.gain.exponentialRampToValueAtTime(0.001, tc + 0.1);
        knock.connect(kg);
        kg.connect(busSfx);
        knock.start(tc);
        knock.stop(tc + 0.12);
        var latch = ctx.createBufferSource();
        latch.buffer = noiseBuf;
        var lbp = ctx.createBiquadFilter();
        lbp.type = "bandpass";
        lbp.frequency.value = 1400;
        lbp.Q.value = 3;
        var lg = ctx.createGain();
        lg.gain.setValueAtTime(0.25, tc);
        lg.gain.exponentialRampToValueAtTime(0.001, tc + 0.06);
        latch.connect(lbp);
        lbp.connect(lg);
        lg.connect(busSfx);
        latch.start(tc, Math.random() * 1.5);
        latch.stop(tc + 0.09);
      } catch (err) {
        /* ignore */
      }
    },

    /* Agatha's lantern flame: probability-gated crackle pops + faint
     * flame breath, spatialized at her pose. Called at 4Hz; internally
     * throttled to one pop per 300ms and silent beyond 14m. */
    lanternTick: function () {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      if (!listener.ok || !agatha.ok) return;
      try {
        var s = spatialFor(agatha.x, agatha.z);
        if (s.dist > 14) return;
        var now =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
        if (now - lastCrackleT < 300) return;
        var prox = 1 - s.dist / 14;
        if (Math.random() > 0.25 + prox * 0.6) return;
        lastCrackleT = now;
        var t = ctx.currentTime;
        var tail = spatialTail(busSfx, s, 0.06 + prox * 0.08);
        var n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2500 + Math.random() * 1500;
        bp.Q.value = 2;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        n.connect(bp);
        bp.connect(g);
        g.connect(tail);
        n.start(t, Math.random() * 1.5);
        n.stop(t + 0.05);
        var h = ctx.createBufferSource();
        h.buffer = noiseBuf;
        h.loop = true;
        h.playbackRate.value = 0.35;
        var hlp = ctx.createBiquadFilter();
        hlp.type = "lowpass";
        hlp.frequency.value = 600;
        var hg = ctx.createGain();
        hg.gain.setValueAtTime(0.001, t);
        hg.gain.linearRampToValueAtTime(0.3, t + 0.05);
        hg.gain.linearRampToValueAtTime(0.001, t + 0.15);
        h.connect(hlp);
        hlp.connect(hg);
        hg.connect(tail);
        h.start(t);
        h.stop(t + 0.18);
      } catch (err) {
        /* ignore */
      }
    },

    setListener: function (px, pz, yaw) {
      if (typeof px === "number" && typeof pz === "number") {
        listener.x = px;
        listener.z = pz;
        if (typeof yaw === "number") listener.yaw = yaw;
        listener.ok = true;
      }
    },

    setAgatha: function (ax, az) {
      if (typeof ax === "number" && typeof az === "number") {
        agatha.x = ax;
        agatha.z = az;
        agatha.ok = true;
      }
    },

    setEnemyState: function (state, dist) {
      if (typeof state === "string") threatState = state;
      if (typeof dist === "number" && isFinite(dist)) {
        threatDist = Math.max(0, dist);
      }
      ensureBgm();
      applyThreat();
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
          if (calmG && calmG.gain) calmG.gain.setTargetAtTime(0.0001, t, 0.015);
          if (tenseG && tenseG.gain)
            tenseG.gain.setTargetAtTime(0.0001, t, 0.015);
          if (chasePulseG && chasePulseG.gain)
            chasePulseG.gain.setTargetAtTime(0.0001, t, 0.015);
          if (beatG && beatG.gain) beatG.gain.setTargetAtTime(0.0001, t, 0.015);
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
        } catch (err) {
          /* ignore */
        }
        nextBeatT = 0;
        applyThreat();
      }
      applyGain();
    },

    isSuspended: function () {
      return suspended;
    },

    isMuted: function () {
      return muted;
    },

    setAlert01: function (x) {
      alert01 = clamp01(x);
      ensureBgm();
      applyThreat();
      return alert01;
    },

    queueWhisper: function (mood) {
      var m = mood === "near" || mood === "chase" ? mood : "distant";
      ensureBgm();
      fireWhisper(m);
      schedNextWhisper();
    },

    /* 3-part nun footfall: heel transient + 95->40Hz thud body + habit
     * swish tail, spatialized at (ax, az). Heavy in CHASE. */
    agathaStep: function (chase, ax, az) {
      if (!ctx || !noiseBuf || muted || dimmed || suspended) return;
      if (typeof ax === "number" && typeof az === "number") {
        agatha.x = ax;
        agatha.z = az;
        agatha.ok = true;
      }
      try {
        var s = agathaSpatial();
        var t = ctx.currentTime;
        var heavy = !!chase;
        var tail = spatialTail(busSfx, s, heavy ? 0.5 : 0.24);
        /* (1) Transient: heel scuff. */
        var sc = ctx.createBufferSource();
        sc.buffer = noiseBuf;
        sc.playbackRate.value = heavy ? 0.55 : 0.4;
        var sbp = ctx.createBiquadFilter();
        sbp.type = "bandpass";
        sbp.frequency.value = (heavy ? 700 : 900) * jitter12();
        sbp.Q.value = 1.2;
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(heavy ? 0.8 : 0.6, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        sc.connect(sbp);
        sbp.connect(sg);
        sg.connect(tail);
        sc.start(t, Math.random() * 1.2);
        sc.stop(t + 0.07);
        /* (2) Body: low thud, 95 -> 40Hz pitch drop. */
        var th = ctx.createOscillator();
        th.type = "sine";
        th.frequency.setValueAtTime(95 * jitter12(), t);
        th.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        var tg = ctx.createGain();
        tg.gain.setValueAtTime(0.001, t);
        tg.gain.exponentialRampToValueAtTime(heavy ? 0.9 : 0.6, t + 0.01);
        tg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        th.connect(tg);
        tg.connect(tail);
        th.start(t);
        th.stop(t + 0.17);
        /* (3) Tail: habit swish riding the thud. */
        var sw = ctx.createBufferSource();
        sw.buffer = noiseBuf;
        var hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 2400;
        var wg = ctx.createGain();
        wg.gain.setValueAtTime(0.001, t);
        wg.gain.exponentialRampToValueAtTime(heavy ? 0.25 : 0.12, t + 0.03);
        wg.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        sw.connect(hp);
        hp.connect(wg);
        wg.connect(tail);
        sw.start(t, Math.random() * 1.2);
        sw.stop(t + 0.3);
      } catch (err) {
        /* ignore */
      }
    },

    /* Subagent C additive: platformer mood crossfade reusing the
     * adaptive 3-tier BGM (Calm -> Clockwork Tension -> Ascent Climax).
     * Calm 0.06 / clockwork 0.55 / ascent 0.95 threat mapping. */
    setPlatformMood: function (mood) {
      var m = String(mood || "calm").toLowerCase();
      var v = 0.06;
      if (m === "clockwork" || m === "tension") v = 0.55;
      else if (m === "ascent" || m === "climax" || m === "chase") v = 0.95;
      alert01 = clamp01(v);
      ensureBgm();
      applyThreat();
      return alert01;
    },

    /* Orb pickup: pentatonic chime C5 D5 E5 G5 A5 C6. 3-part voice:
     * noise tick transient + sine fundamental + octave shimmer. The
     * step arg climbs the scale; omitted => internal combo counter. */
    orbChime: function (step) {
      if (!ctx || !noiseBuf || muted || suspended) return;
      var scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
      var s = typeof step === "number" && isFinite(step) ? step : orbStep;
      if (typeof step !== "number") orbStep++;
      var f = scale[((s % 6) + 6) % 6];
      try {
        var t = ctx.currentTime;
        var tick = ctx.createBufferSource();
        tick.buffer = noiseBuf;
        var hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 6000;
        var tg = ctx.createGain();
        tg.gain.setValueAtTime(0.1, t);
        tg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        tick.connect(hp);
        hp.connect(tg);
        tg.connect(busSfx);
        tick.start(t, Math.random() * 1.5);
        tick.stop(t + 0.04);
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.connect(g);
        g.connect(busSfx);
        o.start(t);
        o.stop(t + 0.55);
        var sh = ctx.createOscillator();
        sh.type = "sine";
        sh.frequency.value = f * 2;
        var sg2 = ctx.createGain();
        sg2.gain.setValueAtTime(0.001, t);
        sg2.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
        sg2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        sh.connect(sg2);
        sg2.connect(busSfx);
        sh.start(t);
        sh.stop(t + 0.35);
      } catch (err) {
        /* ignore */
      }
    },

    /* Soul-lantern reset: warm C-major bell chord + shimmer partial,
     * staggered 0/12/24/36ms micro-attacks, 0.9s decay. */
    lanternBell: function () {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var parts = [523.25, 659.25, 783.99, 2114.0];
        var amps = [0.26, 0.2, 0.16, 0.05];
        var ats = [0, 0.012, 0.024, 0.036];
        for (var i = 0; i < parts.length; i++) {
          var o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = parts[i];
          var g = ctx.createGain();
          var at = t + ats[i];
          g.gain.setValueAtTime(0.001, at);
          g.gain.exponentialRampToValueAtTime(amps[i], at + 0.006);
          g.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
          o.connect(g);
          g.connect(busSfx);
          o.start(at);
          o.stop(at + 0.95);
        }
      } catch (err) {
        /* ignore */
      }
    },

    /* Air-dash whoosh: bandpass noise sweep 500 -> 2600Hz, 0.16s. */
    dashWhoosh: function () {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        n.playbackRate.value = 1.4;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.1;
        bp.frequency.setValueAtTime(500, t);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.13);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        n.connect(bp);
        bp.connect(g);
        g.connect(busSfx);
        n.start(t, Math.random() * 1.5);
        n.stop(t + 0.22);
      } catch (err) {
        /* ignore */
      }
    },

    /* Platformer jump blip: 300 -> 620Hz sine sweep + airy puff. */
    platJump: function () {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(300, t);
        o.frequency.exponentialRampToValueAtTime(620, t + 0.1);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        o.connect(g);
        g.connect(busSfx);
        o.start(t);
        o.stop(t + 0.16);
      } catch (err) {
        /* ignore */
      }
    },

    /* Platformer landing: 140 -> 55Hz thud + filtered scuff. */
    platLand: function (hard) {
      if (!ctx || !noiseBuf || muted || suspended) return;
      try {
        var t = ctx.currentTime;
        var amp = hard ? 0.5 : 0.28;
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(140 * jitter12(), t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
        var g = ctx.createGain();
        g.gain.setValueAtTime(amp, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        o.connect(g);
        g.connect(busSfx);
        o.start(t);
        o.stop(t + 0.13);
        var n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        var ng = ctx.createGain();
        ng.gain.setValueAtTime(amp * 0.5, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        n.connect(lp);
        lp.connect(ng);
        ng.connect(busSfx);
        n.start(t, Math.random() * 1.5);
        n.stop(t + 0.09);
      } catch (err) {
        /* ignore */
      }
    }
  };

  window.StV_Audio = api;
  /* Level lightning rig calls thunder() through this hook. */
  window.StV_AudioHook = api;
  window.G = window.G || {};
  window.G.AudioSys = api;

  /* Headless probe: buses/threat/spatial snapshot for playtest critics. */
  window.StV_AudioDebug = {
    state: function () {
      var buses = { bgm: 0, ambient: 0, sfx: 0, voice: 0 };
      try {
        if (busBgm) buses.bgm = r3(busBgm.gain.value);
        if (busAmb) buses.ambient = r3(busAmb.gain.value);
        if (busSfx) buses.sfx = r3(busSfx.gain.value);
        if (busVox) buses.voice = r3(busVox.gain.value);
      } catch (err) {
        /* x */
      }
      var cs = "none";
      try {
        cs = ctx ? ctx.state : "none";
      } catch (err) {
        /* x */
      }
      return {
        ctxState: cs,
        buses: buses,
        alert01: alert01,
        bpm: Math.round(bpm * 10) / 10,
        lastPan: lastPan,
        lastCutoff: lastCutoff
      };
    }
  };
})();
