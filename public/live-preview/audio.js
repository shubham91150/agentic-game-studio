/* Horizon Sprint — audio.js
 * WebAudio synthesizer: engine, skid, wind, UI/lap jingles. */
(function () {
  window.G = window.G || {};
  var G = window.G;

  G.AudioSys = {
    ctx: null,
    master: null,
    eng1: null,
    eng2: null,
    engFilter: null,
    engGain: null,
    skidGain: null,
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
      var skidBp = ctx.createBiquadFilter();
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

      this.started = true;
      this.resume();
    },

    resume: function () {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },

    // Called every frame while driving. All args 0..1-ish, racing bool.
    setEngine: function (speed01, throttle, drifting, offroad, nitro, racing) {
      if (!this.started) return;
      var t = this.ctx.currentTime;
      var rev = throttle * 0.25;
      var f = 62 + speed01 * 215 + rev * 60 + (nitro ? 55 : 0);
      this.eng1.frequency.setTargetAtTime(f, t, 0.06);
      this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      this.engFilter.frequency.setTargetAtTime(
        500 + speed01 * 2600 + (nitro ? 1200 : 0),
        t,
        0.08,
      );
      this.engGain.gain.setTargetAtTime(
        racing ? 0.1 + throttle * 0.06 + speed01 * 0.05 : 0,
        t,
        0.09,
      );
      var skid =
        (drifting && speed01 > 0.25 ? 0.2 : 0) +
        (offroad && speed01 > 0.3 ? 0.1 : 0);
      this.skidGain.gain.setTargetAtTime(racing ? skid : 0, t, 0.05);
      this.windGain.gain.setTargetAtTime(
        racing ? speed01 * speed01 * 0.16 : 0,
        t,
        0.15,
      );
    },

    silence: function () {
      if (!this.started) return;
      var t = this.ctx.currentTime;
      this.engGain.gain.setTargetAtTime(0, t, 0.05);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      this.windGain.gain.setTargetAtTime(0, t, 0.05);
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
