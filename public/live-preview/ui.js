/* Horizon Sprint — ui.js
 * Menu / HUD / pause / results / minimap / touch. No game logic here. */
(function () {
  window.G = window.G || {};
  var G = window.G;

  function $(id) {
    return document.getElementById(id);
  }

  function fmt(t) {
    if (t === null || t === undefined || !isFinite(t)) return "--:--.-";
    var m = Math.floor(t / 60),
      s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }
  G.fmtTime = fmt;

  function shortKey(code) {
    var c = String(code || "");
    if (!c) return "?";
    return c
      .replace(/^Key/, "")
      .replace(/^Digit/, "")
      .replace(/^Arrow/, "")
      .slice(0, 6);
  }

  G.UI = {
    touch: {
      left: false,
      right: false,
      gas: false,
      brake: false,
      nitro: false,
    },
    _els: {},
    _last: {},
    _toastT: 0,
    _capT: 0,
    _mm: null,
    _mmStatic: null,
    _mmMap: null,
    // Stage 3: needle spring state, gear/best edge state, reduced-motion flag.
    _ang: -120,
    _angV: 0,
    _wroteAng: -999,
    _needleT: 0,
    _lastGear: null,
    _lastBest: null,
    _edgeLap: 0,
    _bestT: 0,
    _rm: false,

    init: function (cb) {
      var E = this._els,
        self = this;
      [
        "hud",
        "hud-pos",
        "hud-lap",
        "hud-time-cur",
        "hud-time-last",
        "hud-time-best",
        "dial-needle",
        "dial-digital",
        "dial-gear",
        "nitro-fill",
        "minimap",
        "countdown",
        "toast",
        "wrongway",
        "menu",
        "menu-start",
        "menu-howto",
        "howto",
        "pause",
        "btn-resume",
        "btn-restart-p",
        "btn-quit",
        "opt-volume",
        "opt-quality",
        "opt-sens",
        "opt-mute",
        "results",
        "results-kicker",
        "results-title",
        "results-best",
        "results-rows",
        "btn-restart-r",
        "btn-menu-r",
        "btn-cam",
        "btn-mute",
        "btn-pause",
        "touch",
        "t-left",
        "t-right",
        "t-gas",
        "t-brake",
        "t-nitro",
        "flash",
        "fatal",
        "fps",
        "caption",
        "opt-colorblind",
        "opt-subs",
        "key-left",
        "key-right",
      ].forEach(function (id) {
        E[id] = $(id);
      });

      E["menu-start"].addEventListener("click", function () {
        cb.onStart();
      });
      E["menu-howto"].addEventListener("click", function () {
        E.howto.classList.toggle("hidden");
        cb.onClick();
      });
      E["btn-resume"].addEventListener("click", function () {
        cb.onResume();
      });
      E["btn-restart-p"].addEventListener("click", function () {
        cb.onRestart();
      });
      E["btn-quit"].addEventListener("click", function () {
        cb.onQuit();
      });
      E["btn-restart-r"].addEventListener("click", function () {
        cb.onRestart();
      });
      E["btn-menu-r"].addEventListener("click", function () {
        cb.onQuit();
      });
      E["btn-cam"].addEventListener("click", function () {
        cb.onCam();
      });
      E["btn-mute"].addEventListener("click", function () {
        cb.onMute();
      });
      E["btn-pause"].addEventListener("click", function () {
        cb.onPauseBtn();
      });
      E["opt-volume"].addEventListener("input", function () {
        cb.onVolume(E["opt-volume"].value / 100);
      });
      E["opt-quality"].addEventListener("change", function () {
        cb.onQuality(parseInt(E["opt-quality"].value, 10));
      });
      E["opt-sens"].addEventListener("input", function () {
        cb.onSens(E["opt-sens"].value / 100);
      });
      E["opt-mute"].addEventListener("change", function () {
        cb.onMuteSet(E["opt-mute"].checked);
      });
      E["opt-colorblind"].addEventListener("change", function () {
        cb.onColorblind(E["opt-colorblind"].checked);
      });
      E["opt-subs"].addEventListener("change", function () {
        cb.onSubs(E["opt-subs"].checked);
      });
      E["key-left"].addEventListener("click", function () {
        cb.onRemap("left", E["key-left"]);
      });
      E["key-right"].addEventListener("click", function () {
        cb.onRemap("right", E["key-right"]);
      });

      var sws = document.querySelectorAll("#swatches .sw");
      for (var i = 0; i < sws.length; i++) {
        sws[i].addEventListener("click", function () {
          for (var j = 0; j < sws.length; j++) sws[j].classList.remove("sel");
          this.classList.add("sel");
          cb.onColor(this.getAttribute("data-color"));
        });
      }

      // touch buttons
      var map = [
        ["t-left", "left"],
        ["t-right", "right"],
        ["t-gas", "gas"],
        ["t-brake", "brake"],
        ["t-nitro", "nitro"],
      ];
      map.forEach(function (m) {
        var b = E[m[0]],
          k = m[1];
        function on(e) {
          e.preventDefault();
          self.touch[k] = true;
          b.classList.add("on");
        }
        function off(e) {
          e.preventDefault();
          self.touch[k] = false;
          b.classList.remove("on");
        }
        b.addEventListener("touchstart", on, { passive: false });
        b.addEventListener("touchend", off, { passive: false });
        b.addEventListener("touchcancel", off, { passive: false });
        b.addEventListener("mousedown", on);
        b.addEventListener("mouseup", off);
        b.addEventListener("mouseleave", function () {
          self.touch[k] = false;
          b.classList.remove("on");
        });
      });
      if (
        "ontouchstart" in window ||
        (window.matchMedia && matchMedia("(pointer:coarse)").matches)
      ) {
        E.touch.classList.remove("hidden");
      }
      this._mm = E.minimap.getContext("2d");
      // Stage 3: NEW-BEST flash is decorative — kill it under reduced motion.
      // (Needle stays: it is functional, like the old digital number.)
      this._rm = !!(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    },

    set: function (id, txt) {
      if (this._last[id] === txt) return;
      this._last[id] = txt;
      this._els[id].textContent = txt;
    },

    showMenu: function (v) {
      this._els.menu.classList.toggle("hidden", !v);
    },
    showHud: function (v) {
      this._els.hud.classList.toggle("hidden", !v);
    },
    showPause: function (v) {
      this._els.pause.classList.toggle("hidden", !v);
    },
    showResults: function (v) {
      this._els.results.classList.toggle("hidden", !v);
    },

    syncPauseOptions: function (save) {
      this._els["opt-volume"].value = save.volume;
      this._els["opt-quality"].value = String(save.quality);
      this._els["opt-sens"].value = save.sens;
      this._els["opt-mute"].checked = !!save.muted;
      this._els["opt-colorblind"].checked = !!save.colorblind;
      this._els["opt-subs"].checked = save.subs !== false;
      this._els["key-left"].textContent = shortKey(save.keys && save.keys.left);
      this._els["key-right"].textContent = shortKey(
        save.keys && save.keys.right,
      );
    },

    caption: function (txt) {
      var el = this._els.caption;
      if (!el) return;
      el.textContent = txt;
      el.classList.remove("hidden");
      clearTimeout(this._capT);
      var self = this;
      this._capT = setTimeout(function () {
        el.classList.add("hidden");
      }, 4000);
    },

    selectSwatch: function (color) {
      var sws = document.querySelectorAll("#swatches .sw");
      for (var i = 0; i < sws.length; i++) {
        sws[i].classList.toggle(
          "sel",
          sws[i].getAttribute("data-color") === color,
        );
      }
    },

    setCountdown: function (txt) {
      var el = this._els.countdown;
      if (!txt) {
        el.classList.add("hidden");
        return;
      }
      el.classList.remove("hidden");
      if (el.textContent !== txt) el.textContent = txt;
    },

    toast: function (txt, dur) {
      var el = this._els.toast;
      el.textContent = txt;
      el.classList.remove("hidden");
      clearTimeout(this._toastT);
      var self = this;
      this._toastT = setTimeout(function () {
        el.classList.add("hidden");
      }, dur || 1800);
    },

    setWrongWay: function (v) {
      this._els.wrongway.classList.toggle("hidden", !v);
    },

    flash: function () {
      var el = this._els.flash;
      el.style.opacity = 0.28;
      setTimeout(function () {
        el.style.opacity = 0;
      }, 140);
    },

    setMuteLabel: function (m) {
      this.set("btn-mute", m ? "OFF" : "SND");
    },
    setCamLabel: function (i) {
      this.set("btn-cam", ["CAM1", "CAM2", "HOOD"][i] || "CAM");
    },

    // Stage 3: gear is the Stage-2 audioGear (1..5) threaded through from
    // game.js. Analog needle dial replaces the old digital #hud-speed number.
    updateHud: function (player, posStr, raceTime, sessionBest, gear) {
      this.set("hud-pos", posStr);
      this.set("hud-lap", "LAP " + Math.min(3, player.lap) + "/3");
      this.set("hud-time-cur", fmt(raceTime));
      this.set("hud-time-last", "LAST " + fmt(player.lastLap));
      // Restart re-arms the new-best + gear edges (lap drops back to 1).
      if (player.lap !== this._edgeLap) {
        if (player.lap < this._edgeLap) {
          this._lastBest = null;
          this._lastGear = null;
        }
        this._edgeLap = player.lap;
      }
      var b = player.bestLap !== null ? player.bestLap : sessionBest;
      this.set("hud-time-best", "BEST " + fmt(b));
      if (typeof b === "number" && isFinite(b)) {
        if (
          this._lastBest !== null &&
          b < this._lastBest - 1e-9 &&
          !this._rm
        ) {
          var be = this._els["hud-time-best"];
          be.classList.remove("best-flash");
          void be.offsetWidth;
          be.classList.add("best-flash");
          clearTimeout(this._bestT);
          this._bestT = setTimeout(function () {
            be.classList.remove("best-flash");
          }, 1250);
        }
        this._lastBest = b;
      }
      var g = gear >= 1 && gear <= 5 ? gear | 0 : 1;
      this.set("dial-gear", String(g));
      if (this._lastGear !== null && g !== this._lastGear) {
        this._angV += 34; // small overshoot kick on shift (BACK-out flavour)
      }
      this._lastGear = g;
      var kmh = Math.abs(player.speed) * 3.6;
      var now = performance.now();
      var dt = this._needleT ? (now - this._needleT) / 1000 : 0.016;
      if (dt > 0.05) dt = 0.05;
      if (dt < 0) dt = 0;
      this._needleT = now;
      // Needle spring: ~12/s response, slightly underdamped for a subtle
      // Forza-style settle. Target clamps at 260 (needle parks at max);
      // the digital readout below shows the true value.
      var target = -120 + (Math.min(kmh, 260) / 260) * 240;
      this._angV += ((target - this._ang) * 150 - this._angV * 16.5) * dt;
      this._ang += this._angV * dt;
      if (Math.abs(this._ang - this._wroteAng) >= 0.2) {
        this._wroteAng = this._ang;
        this._els["dial-needle"].setAttribute(
          "transform",
          "rotate(" + this._ang.toFixed(1) + " 100 100)",
        );
      }
      this.set("dial-digital", String(Math.round(kmh)));
      this._els["nitro-fill"].style.width = Math.round(player.nitro) + "%";
    },

    minimapInit: function (track) {
      var pts = track.pts,
        S = track.S;
      var minX = 1e9,
        maxX = -1e9,
        minZ = 1e9,
        maxZ = -1e9;
      for (var i = 0; i < S; i += 4) {
        var p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      var W = 200,
        pad = 14;
      var sc = Math.min(
        (W - pad * 2) / (maxX - minX),
        (W - pad * 2) / (maxZ - minZ),
      );
      this._mmMap = {
        sc: sc,
        ox: pad + (W - pad * 2 - (maxX - minX) * sc) / 2 - minX * sc,
        oz: pad + (W - pad * 2 - (maxZ - minZ) * sc) / 2 - minZ * sc,
      };
      var st = document.createElement("canvas");
      st.width = W;
      st.height = W;
      var x = st.getContext("2d");
      function path() {
        x.beginPath();
        for (var i = 0; i <= S; i += 4) {
          var p = pts[i % S];
          var px = p.x * sc + this.ox,
            py = p.z * sc + this.oz;
          if (i === 0) x.moveTo(px, py);
          else x.lineTo(px, py);
        }
        x.closePath();
      }
      var self = this._mmMap;
      path.call(self);
      x.strokeStyle = "#ffffff";
      x.lineWidth = 7;
      x.lineJoin = "round";
      x.stroke();
      path.call(self);
      x.strokeStyle = "#2c313a";
      x.lineWidth = 4;
      x.stroke();
      var p0 = pts[0];
      x.fillStyle = "#ffb300";
      x.fillRect(p0.x * sc + self.ox - 4, p0.z * sc + self.oz - 4, 8, 8);
      this._mmStatic = st;
    },

    minimapDraw: function (cars) {
      var x = this._mm,
        m = this._mmMap;
      if (!x || !m) return;
      x.clearRect(0, 0, 200, 200);
      x.drawImage(this._mmStatic, 0, 0);
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i];
        var px = c.x * m.sc + m.ox,
          py = c.z * m.sc + m.oz;
        x.beginPath();
        x.arc(px, py, c.isPlayer ? 5 : 3.5, 0, 7);
        x.fillStyle = c.isPlayer ? "#ffb300" : "#ffffff";
        x.fill();
        if (c.isPlayer) {
          x.lineWidth = 2;
          x.strokeStyle = "#000";
          x.stroke();
        }
      }
    },

    results: function (won, posStr, rows, bestStr, newBest) {
      this._els["results-kicker"].textContent = won
        ? "VICTORY"
        : "RACE COMPLETE";
      this._els["results-title"].textContent =
        posStr + (won ? " — VICTORY!" : " — FINISH");
      this.set(
        "results-best",
        "BEST LAP " + bestStr + (newBest ? "  ★ NEW RECORD" : ""),
      );
      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        html +=
          '<div class="rrow' +
          (r.you ? " you" : "") +
          '"><span><span class="p1">P' +
          (i + 1) +
          "</span> &nbsp;" +
          r.name +
          "</span><span>" +
          fmt(r.best) +
          "</span></div>";
      }
      this._els["results-rows"].innerHTML = html;
    },

    fatal: function (msg) {
      var el = this._els.fatal;
      el.textContent = msg;
      el.classList.remove("hidden");
    },
  };
})();
