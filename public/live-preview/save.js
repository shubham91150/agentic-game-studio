/* Horizon Sprint — save.js
 * localStorage persistence: best lap, volume, quality, steering, car color. */
(function () {
  window.G = window.G || {};
  var G = window.G;
  var KEY = "horizon_sprint_v1";

  G.Save = {
    data: {
      best: null,
      volume: 70,
      quality: 1,
      sens: 100,
      muted: false,
      color: "210,31,38",
      colorblind: false,
      subs: true,
      keys: { left: "KeyA", right: "KeyD" },
    },
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return this.data;
        var d = JSON.parse(raw);
        for (var k in this.data) if (d[k] !== undefined) this.data[k] = d[k];
        // Nested keymap: merge per-key so old saves keep working (additive).
        if (d.keys && typeof d.keys === "object") {
          for (var kk in this.data.keys)
            if (d.keys[kk] !== undefined) this.data.keys[kk] = d.keys[kk];
        }
      } catch (e) {
        /* private mode etc — play with defaults */
      }
      return this.data;
    },
    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) {}
    },
    reset: function () {
      this.data.best = null;
      this.save();
    },
  };
})();
