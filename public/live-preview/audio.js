/* Horizon Sprint — audio.js
 * WebAudio synthesizer: engine, skid, wind, UI/lap jingles. */
(function () {
  window.G = window.G || {};
  var G = window.G;

  // Stage 2: 5-gear RPM ladder. In-gear ramp 60Hz; each upshift drops the
  // target ~25%: base[g+1] = 0.75 * (base[g] + 60), base[1] = 62.
  var GEAR_LO = [0, 0.18, 0.36, 0.55, 0.75];
  var GEAR_HI = [0.18, 0.36, 0.55, 0.75, 1.0];
  var GEAR_BASE = (function () {
    var b = [62];
    for (var g = 1; g < 5; g++) b.push(0.75 * (b[g - 1] + 60));
    return b;
  })();
  function gearFromSpeed(s) {
    if (s > 0.75) return 5;
    if (s > 0.55) return 4;
    if (s > 0.36) return 3;
    if (s > 0.18) return 2;
    return 1;
  }

  G.AudioSys = {
    ctx: null,
    master: null,
    eng1: null,
    eng2: null,
    engFilter: null,
    engGain: null,
    skidGain: null,
    skidBp: null,
    rumGain: null,
    whooshGain: null,
    vibLfo: null,
    vibDepth: null,
    thudOsc: null,
    thudGain: null,
    thudNoiseGain: null,
    windGain: null,
    started: false,
    muted: false,
    volume: 0.7,

    init: function () {
      if (this.started) {
        this.resume();
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = (this.ctx = new AC());
      var master = (this.master = ctx.createGain());
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);

      // Engine: detuned saws -> lowpass -> gain
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = "lowpass";
      this.engFilter.frequency.value = 700;
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engFilter.connect(this.engGain);
      this.engGain.connect(master);
      this.eng1 = ctx.createOscillator();
      this.eng1.type = "sawtooth";
      this.eng1.frequency.value = 70;
      this.eng2 = ctx.createOscillator();
      this.eng2.type = "square";
      this.eng2.frequency.value = 35;
      var g2 = ctx.createGain();
      g2.gain.value = 0.4;
      this.eng1.connect(this.engFilter);
      this.eng2.connect(g2);
      g2.connect(this.engFilter);
      this.eng1.start();
      this.eng2.start();

      // Shared noise buffer for skid + wind
      var len = ctx.sampleRate;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var mkNoise = function () {
        var s = ctx.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        return s;
      };
      var skidBp = (this.skidBp = ctx.createBiquadFilter());
      skidBp.type = "bandpass";
      skidBp.frequency.value = 1500;
      skidBp.Q.value = 0.8;
      this.skidGain = ctx.createGain();
      this.skidGain.gain.value = 0;
      var ns = mkNoise();
      ns.connect(skidBp);
      skidBp.connect(this.skidGain);
      this.skidGain.connect(master);
      ns.start();
      var windLp = ctx.createBiquadFilter();
      windLp.type = "lowpass";
      windLp.frequency.value = 420;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      var nw = mkNoise();
      nw.connect(windLp);
      windLp.connect(this.windGain);
      this.windGain.connect(master);
      nw.start();

      // Stage 2: offroad rumble — second lowpass tap off shared noise.
      var rumLp = ctx.createBiquadFilter();
      rumLp.type = "lowpass";
      rumLp.frequency.value = 160;
      this.rumGain = ctx.createGain();
      this.rumGain.gain.value = 0;
      var nr = mkNoise();
      nr.connect(rumLp);
      rumLp.connect(this.rumGain);
      this.rumGain.connect(master);
      nr.start();

      // Stage 2: nitro whoosh — sine overtone, gain-gated in setEngine.
      var whoosh = ctx.createOscillator();
      whoosh.type = "sine";
      whoosh.frequency.value = 2400;
      this.whooshGain = ctx.createGain();
      this.whooshGain.gain.value = 0;
      whoosh.connect(this.whooshGain);
      this.whooshGain.connect(master);
      whoosh.start();

      // Stage 2: engine vibrato — one shared LFO → depth gain → both
      // engine osc freq params. Depth retargeted per frame (±3% of f).
      this.vibLfo = ctx.createOscillator();
      this.vibLfo.type = "sine";
      this.vibLfo.frequency.value = 5.5;
      this.vibDepth = ctx.createGain();
      this.vibDepth.gain.value = 0;
      this.vibLfo.connect(this.vibDepth);
      this.vibDepth.connect(this.eng1.frequency);
      this.vibDepth.connect(this.eng2.frequency);
      this.vibLfo.start();

      // Stage 2: impact thud — pre-built osc + noise-burst taps, fired by
      // param envelopes only (zero node creation in thud()).
      this.thudOsc = ctx.createOscillator();
      this.thudOsc.type = "sine";
      this.thudOsc.frequency.value = 90;
      this.thudGain = ctx.createGain();
      this.thudGain.gain.value = 0.0001;
      this.thudOsc.connect(this.thudGain);
      this.thudGain.connect(master);
      this.thudOsc.start();
      var thudLp = ctx.createBiquadFilter();
      thudLp.type = "lowpass";
      thudLp.frequency.value = 700;
      this.thudNoiseGain = ctx.createGain();
      this.thudNoiseGain.gain.value = 0.0001;
      var nt = mkNoise();
      nt.connect(thudLp);
      thudLp.connect(this.thudNoiseGain);
      this.thudNoiseGain.connect(master);
      nt.start();

      this.started = true;
      this.resume();
    },

    resume: function () {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },

    // Called every frame while driving. All args 0..1-ish, racing bool.
    // Stage 2: slip01 + gear are optional trailing args (backward-compat).
    setEngine: function (
      speed01,
      throttle,
      drifting,
      offroad,
      nitro,
      racing,
      slip01,
      gear,
    ) {
      if (!this.started) return;
      var t = this.ctx.currentTime;
      if (typeof slip01 !== "number") slip01 = drifting ? 0.7 : 0;
      slip01 = +slip01 || 0; // Stage 5: NaN guard (mirrors thud(); NaN is typeof number)
      slip01 = Math.max(0, Math.min(1, slip01));
      gear = gear >= 1 && gear <= 5 ? gear | 0 : gearFromSpeed(speed01);
      // Gear-stepped RPM: ramp with in-gear progress; upshift drops ~25%.
      var glo = GEAR_LO[gear - 1],
        ghi = GEAR_HI[gear - 1];
      var prog = (speed01 - glo) / (ghi - glo);
      prog = Math.max(0, Math.min(1, prog));
      var rev = throttle * 0.25;
      var f =
        GEAR_BASE[gear - 1] + prog * 60 + rev * 60 + (nitro ? 55 : 0);
      this.eng1.frequency.setTargetAtTime(f, t, 0.06);
      this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      this.vibDepth.gain.setTargetAtTime(f * 0.03, t, 0.1);
      this.engFilter.frequency.setTargetAtTime(
        500 + speed01 * 2600 + (nitro ? 1200 : 0),
        t,
        0.08,
      );
      // Load growl: filter Q 0.7→2.5 with throttle (subtle).
      this.engFilter.Q.setTargetAtTime(0.7 + throttle * 1.8, t, 0.08);
      this.engGain.gain.setTargetAtTime(
        racing ? 0.1 + throttle * 0.06 + speed01 * 0.05 : 0,
        t,
        0.09,
      );
      // Slip-pitched screech, gated on drift + speed; offroad never here.
      var screechOn = drifting && speed01 > 0.2;
      this.skidBp.frequency.setTargetAtTime(900 + slip01 * 1800, t, 0.05);
      this.skidGain.gain.setTargetAtTime(
        racing && screechOn ? slip01 * 0.25 : 0,
        t,
        0.05,
      );
      // Offroad rumble (own tap) + wind + nitro whoosh.
      this.rumGain.gain.setTargetAtTime(
        racing && offroad && speed01 > 0.15
          ? Math.min(0.12, 0.04 + speed01 * 0.1)
          : 0,
        t,
        0.08,
      );
      this.windGain.gain.setTargetAtTime(
        racing ? speed01 * speed01 * 0.16 : 0,
        t,
        0.15,
      );
      this.whooshGain.gain.setTargetAtTime(racing && nitro ? 0.05 : 0, t, 0.1);
    },

    silence: function () {
      if (!this.started) return;
      var t = this.ctx.currentTime;
      this.engGain.gain.setTargetAtTime(0, t, 0.05);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      this.windGain.gain.setTargetAtTime(0, t, 0.05);
      this.rumGain.gain.setTargetAtTime(0, t, 0.05);
      this.whooshGain.gain.setTargetAtTime(0, t, 0.05);
      this.thudGain.gain.cancelScheduledValues(t);
      this.thudGain.gain.setTargetAtTime(0.0001, t, 0.03);
      this.thudNoiseGain.gain.cancelScheduledValues(t);
      this.thudNoiseGain.gain.setTargetAtTime(0.0001, t, 0.03);
    },

    // Stage 2: impact thud — low osc + filtered noise burst, params-only.
    thud: function (sev01) {
      if (!this.started || this.muted) return;
      var sev = Math.max(0, Math.min(1, +sev01 || 0));
      var t = this.ctx.currentTime;
      var heavy = sev >= 0.5;
      this.thudOsc.frequency.setValueAtTime(heavy ? 140 : 90, t);
      this.thudGain.gain.cancelScheduledValues(t);
      this.thudGain.gain.setValueAtTime(0.18 + sev * 0.2, t);
      this.thudGain.gain.exponentialRampToValueAtTime(
        0.0001,
        t + (heavy ? 0.25 : 0.16),
      );
      this.thudNoiseGain.gain.cancelScheduledValues(t);
      this.thudNoiseGain.gain.setValueAtTime(0.1 + sev * 0.12, t);
      this.thudNoiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    },

    beep: function (freq, dur, type, vol, delay) {
      if (!this.started || this.muted) return;
      var ctx = this.ctx;
      var t0 = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      o.type = type || "square";
      o.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.22, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    click: function () {
      this.beep(520, 0.07, "square", 0.12);
    },
    countTick: function () {
      this.beep(440, 0.14, "square", 0.22);
    },
    countGo: function () {
      this.beep(880, 0.42, "square", 0.26);
    },
    checkpoint: function () {
      this.beep(660, 0.1, "square", 0.16);
    },
    lap: function () {
      this.beep(660, 0.12, "square", 0.2);
      this.beep(990, 0.18, "square", 0.2, 0.11);
    },
    win: function () {
      var n = [523, 659, 784, 1046, 784, 1046];
      for (var i = 0; i < n.length; i++)
        this.beep(n[i], 0.16, "triangle", 0.24, i * 0.13);
    },
    lose: function () {
      var n2 = [392, 330, 262];
      for (var j = 0; j < n2.length; j++)
        this.beep(n2[j], 0.2, "triangle", 0.2, j * 0.16);
    },

    setVolume: function (v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    },
    setMuted: function (m) {
      this.muted = !!m;
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    },

    // NPC speech (free, built-in): caption bar + speechSynthesis voice.
    // Mute-gated (voice is audio); no-op where the API is missing.
    speak: function (line, opts) {
      var text = String(line || "");
      if (!text) return;
      try {
        if (G.UI && G.Save && G.Save.data.subs !== false) G.UI.caption(text);
      } catch (e) {}
      if (this.muted) return;
      try {
        if (!("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = (opts && opts.rate) || 1.0;
        u.pitch = (opts && opts.pitch) || 1.0;
        window.speechSynthesis.speak(u);
      } catch (e2) {}
    },
  };
})();
