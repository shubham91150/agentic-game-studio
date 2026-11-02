/* Ashes of St. Vermilion — persistence (Stage 1+2 ext).
 * Key: ags_stv_v1 -> {volume, quality, sensitivity, mute, bestMs,
 *                     + Stage 2+3: difficulty, bestSurvivalMs}.
 * r128 global style: exposes window.StV_Save. No module syntax.
 * localStorage may be blocked (private iframe) — every access is guarded.
 */
(function () {
  'use strict';

  var KEY = 'ags_stv_v1';

  var DEFAULTS = {
    volume: 0.8,
    quality: 'High',
    sensitivity: 1.0,
    mute: false,
    bestMs: null,
    difficulty: 'Normal',
    bestSurvivalMs: null
  };

  function clone(o) {
    return {
      volume: o.volume,
      quality: o.quality,
      sensitivity: o.sensitivity,
      mute: o.mute,
      bestMs: o.bestMs,
      difficulty: o.difficulty,
      bestSurvivalMs: o.bestSurvivalMs
    };
  }

  function sanitize(raw) {
    var out = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.volume === 'number' && isFinite(raw.volume)) {
      out.volume = Math.min(1, Math.max(0, raw.volume));
    }
    if (raw.quality === 'Low' || raw.quality === 'Med' || raw.quality === 'Medium' ||
        raw.quality === 'High') {
      out.quality = (raw.quality === 'Medium') ? 'Med' : raw.quality;
    }
    if (typeof raw.sensitivity === 'number' && isFinite(raw.sensitivity)) {
      out.sensitivity = Math.min(2, Math.max(0.5, raw.sensitivity));
    }
    out.mute = !!raw.mute;
    if (typeof raw.bestMs === 'number' && isFinite(raw.bestMs) && raw.bestMs > 0) {
      out.bestMs = Math.round(raw.bestMs);
    }
    /* Stage 2+3 additive keys (defaults Normal/null). */
    if (raw.difficulty === 'Easy' || raw.difficulty === 'Normal' ||
        raw.difficulty === 'Hard') {
      out.difficulty = raw.difficulty;
    }
    if (typeof raw.bestSurvivalMs === 'number' && isFinite(raw.bestSurvivalMs) &&
        raw.bestSurvivalMs > 0) {
      out.bestSurvivalMs = Math.round(raw.bestSurvivalMs);
    }
    return out;
  }

  window.StV_Save = {
    load: function () {
      try {
        var raw = window.localStorage.getItem(KEY);
        if (!raw) return clone(DEFAULTS);
        return sanitize(JSON.parse(raw));
      } catch (err) {
        return clone(DEFAULTS);
      }
    },
    save: function (s) {
      var merged = sanitize(s);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(merged));
      } catch (err) {
        /* storage blocked — settings still apply for this session */
      }
      return merged;
    }
  };
})();
