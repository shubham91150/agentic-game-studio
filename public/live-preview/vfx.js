/* Ashes of St. Vermilion — camera feel + lightning flash (Stage 1).
 * window.StV_VFX.create(scene, renderer?) ->
 *   {addTrauma, flashLightning, update(dt,camera), + additive: reset}
 * Trauma shake: offset = trauma^2, decay 1.5/s, smoothed layered sines
 * (never per-frame white buzz). Honors prefers-reduced-motion: no shake.
 * Lightning: levels drive the sky light and publish the strike envelope
 * at scene.userData.stvFlash (0..1); here we mirror it to tone exposure
 * plus the #flash overlay. flashLightning() stays as a manual bump.
 * No post chain in Stage 1. Zero allocations in update().
 */
(function () {
  'use strict';

  var DECAY = 1.5;
  var EXPOSURE_DECAY = 7;
  var FLASH_EXPOSURE = 2.4;

  window.StV_VFX = {
    create: function (scene, renderer) {
      var trauma = 0;
      var t = 0;
      var baseExposure = 1.0;
      var exposure = 1.0;
      var reduced = false;

      try {
        reduced = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (err) { reduced = false; }

      var flashEl = null;
      var flashShown = -1;
      if (!renderer && scene && scene.userData) {
        renderer = scene.userData.renderer || null;
      }
      if (renderer && typeof renderer.toneMappingExposure === 'number') {
        baseExposure = renderer.toneMappingExposure;
        exposure = baseExposure;
      } else {
        renderer = null;
      }

      function readSkyFlash() {
        try {
          var f = scene && scene.userData && scene.userData.stvFlash;
          if (typeof f !== 'number') return 0;
          if (f < 0) return 0;
          if (f > 1) return 1;
          return f;
        } catch (err) { return 0; }
      }

      function paintFlashDiv(f) {
        if (Math.abs(f - flashShown) < 0.02 && f !== 0 && flashShown !== -1) return;
        if (!flashEl) {
          try { flashEl = document.getElementById('flash'); } catch (err) { flashEl = null; }
        }
        if (!flashEl) return;
        flashShown = f;
        try { flashEl.style.opacity = f <= 0.01 ? '0' : (f * 0.5).toFixed(3); } catch (err) { /* x */ }
      }

      return {
        addTrauma: function (x) {
          trauma = Math.min(1, trauma + (+x || 0));
          if (trauma < 0) trauma = 0;
        },

        flashLightning: function () {
          exposure = FLASH_EXPOSURE;
          if (!reduced) trauma = Math.min(1, trauma + 0.12);
        },

        reset: function () {
          trauma = 0;
          exposure = baseExposure;
          if (renderer) {
            try { renderer.toneMappingExposure = baseExposure; }
            catch (err) { /* ignore */ }
          }
          paintFlashDiv(0);
        },

        update: function (dt, camera) {
          t += dt;
          /* Primary sync: levels publish the strike envelope at
           * scene.userData.stvFlash (0..1); mirror it to exposure. */
          var sky = readSkyFlash();
          var skyExposure = baseExposure + sky * 1.6;
          if (skyExposure > exposure) exposure = skyExposure;
          paintFlashDiv(sky);
          if (exposure > baseExposure) {
            exposure -= EXPOSURE_DECAY * dt;
            if (exposure < baseExposure) exposure = baseExposure;
            var live = exposure > skyExposure ? exposure : skyExposure;
            if (renderer) {
              try { renderer.toneMappingExposure = live; }
              catch (err) { /* ignore */ }
            }
          } else if (renderer && sky > 0) {
            try { renderer.toneMappingExposure = skyExposure; }
            catch (err) { /* ignore */ }
          }
          if (trauma > 0) {
            trauma -= DECAY * dt;
            if (trauma < 0) trauma = 0;
            if (!reduced && camera && trauma > 0) {
              var s = trauma * trauma;
              camera.position.x += s * 0.18 * Math.sin(t * 47.3);
              camera.position.y += s * 0.14 * Math.sin(t * 38.9 + 1.3);
              camera.rotation.z += s * 0.02 * Math.sin(t * 43.1 + 0.7);
              camera.rotation.x += s * 0.015 * Math.sin(t * 51.7 + 2.1);
            }
          }
        }
      };
    }
  };
})();
