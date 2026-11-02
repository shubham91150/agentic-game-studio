/* Ashes of St. Vermilion — synthesized audio (Stage 1).
 * window.StV_Audio = {init, ambientStart, thunder, footstep,
 *                     setVolume, setMuted, + additive: setDimmed, pickup}
 * Everything is synthesized at runtime from one shared noise buffer —
 * no audio files are fetched. One AudioContext, one master gain.
 * thunder() is called by the level lightning rig through
 * window.StV_AudioHook (same object, guarded lookups on both sides).
 * Mute silences ALL output, present and future. No-op without AudioContext.
 */
(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var ambientOn = false;
  var volume = 0.8;
  var muted = false;
  var dimmed = false;

  function applyGain() {
    if (!ctx || !master) return;
    var g = muted ? 0 : volume * (dimmed ? 0.25 : 1);
    try {
      master.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    } catch (err) { /* older backends */ }
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
    init: function () {
      if (ctx) {
        try {
          if (ctx.state === 'suspended') ctx.resume();
        } catch (err) { /* ignore */ }
        return true;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noiseBuf = makeNoise(2);
        applyGain();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (err) {
        ctx = null;
        master = null;
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
        bp.type = 'bandpass';
        bp.frequency.value = 1700;
        bp.Q.value = 0.55;
        var rainG = ctx.createGain();
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
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        var washG = ctx.createGain();
        washG.gain.value = 0.07;
        wash.connect(lp);
        lp.connect(washG);
        washG.connect(master);
        wash.start();

        /* Drone: two detuned sines near 55 Hz. */
        var droneG = ctx.createGain();
        droneG.gain.value = 0.05;
        var droneLP = ctx.createBiquadFilter();
        droneLP.type = 'lowpass';
        droneLP.frequency.value = 130;
        droneG.connect(droneLP);
        droneLP.connect(master);
        var o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 55;
        var o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 55.8;
        o1.connect(droneG);
        o2.connect(droneG);
        o1.start();
        o2.start();
      } catch (err) { /* keep game silent, never crash */ }
    },

    thunder: function () {
      if (!ctx || !noiseBuf) return;
      try {
        var t = ctx.currentTime;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = 0.5;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
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
        sub.type = 'sine';
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
      } catch (err) { /* ignore */ }
      /* No VFX call here by design: thunder arrives 300-1200ms after the
       * strike starts, while VFX polls scene.userData.stvFlash every frame
       * for exact envelope sync (Task 2 concern #2). */
    },

    footstep: function (run) {
      if (!ctx || !noiseBuf) return;
      try {
        var t = ctx.currentTime;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
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
      } catch (err) { /* ignore */ }
    },

    pickup: function () {
      if (!ctx) return;
      try {
        var t = ctx.currentTime;
        var notes = [523.25, 784.0];
        var i;
        for (i = 0; i < notes.length; i++) {
          var o = ctx.createOscillator();
          o.type = 'sine';
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
      } catch (err) { /* ignore */ }
    },

    setVolume: function (v) {
      if (typeof v === 'number' && isFinite(v)) {
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

    isMuted: function () { return muted; }
  };

  window.StV_Audio = api;
  /* Level lightning rig calls thunder() through this hook. */
  window.StV_AudioHook = api;
})();
