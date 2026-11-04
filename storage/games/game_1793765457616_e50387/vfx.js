/* Ashes of St. Vermilion — camera feel + lightning flash (Stage 1+2 ext).
 * window.StV_VFX.create(scene, renderer?) ->
 *   {addTrauma, flashLightning, update(dt,camera), + additive: reset,
 *    chaseRumble, silhouetteReveal}
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
      /* Stage 2 additive: silhouette-reveal pulse (0..1), self-decaying. */
      var reveal = 0;
      /* Subagent C additive: platformer dash-VFX pools (soft radial
       * sprites + shockwave rings; zero square particles, zero allocs
       * in update). Pools build lazily on first spawn (THREE-guarded). */
      var softTex = null;
      var softTried = false;
      var ghosts = [];
      var ghostN = 0;
      var GHOST_MAX = 36;
      var rings = [];
      var ringN = 0;
      var RING_MAX = 6;

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

      function softTexture() {
        if (softTex || softTried) return softTex;
        softTried = true;
        try {
          var T = (typeof window !== 'undefined') ? window.THREE : null;
          if (!T || !T.CanvasTexture) return null;
          var c = document.createElement('canvas');
          c.width = 64;
          c.height = 64;
          var g = c.getContext('2d');
          var grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
          grad.addColorStop(0.7, 'rgba(255,255,255,0.22)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 64, 64);
          softTex = new T.CanvasTexture(c);
        } catch (err) { softTex = null; }
        return softTex;
      }

      function spawnGhost(px, py, pz, color, size, life, velx, vely, grow) {
        var T = (typeof window !== 'undefined') ? window.THREE : null;
        if (!T || !scene) return;
        var tex = softTexture();
        if (!tex) return;
        var s;
        if (ghostN < GHOST_MAX) {
          try {
            var mat = new T.SpriteMaterial({
              map: tex, transparent: true, depthWrite: false,
              blending: T.AdditiveBlending
            });
            s = new T.Sprite(mat);
            s.visible = false;
            scene.add(s);
            ghosts.push({
              s: s, life: 0, max: 1, vx: 0, vy: 0,
              s0: 1, s1: 0.3, grow: 0
            });
            ghostN++;
          } catch (err) { return; }
        }
        var idx = -1;
        var k;
        for (k = 0; k < ghostN; k++) {
          if (ghosts[k].life <= 0) { idx = k; break; }
        }
        if (idx < 0) return;
        var G = ghosts[idx];
        G.life = life;
        G.max = life;
        G.vx = velx || 0;
        G.vy = vely || 0;
        G.s0 = size;
        G.s1 = grow ? size * 1.9 : size * 0.35;
        G.grow = grow ? 1 : 0;
        try {
          G.s.visible = true;
          G.s.position.set(px, py, pz);
          G.s.material.color.setHex(color);
          G.s.material.opacity = 0.9;
          G.s.material.rotation = Math.random() * 6.283;
          G.s.scale.set(size, size, 1);
        } catch (err) { G.life = 0; }
      }

      function spawnRing(px, py, pz, color) {
        var T = (typeof window !== 'undefined') ? window.THREE : null;
        if (!T || !scene || !T.RingGeometry) return;
        var k;
        if (ringN < RING_MAX) {
          try {
            var geo = new T.RingGeometry(0.42, 0.5, 48);
            var mat = new T.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: 0,
              side: T.DoubleSide, depthWrite: false,
              blending: T.AdditiveBlending
            });
            var m = new T.Mesh(geo, mat);
            m.visible = false;
            scene.add(m);
            rings.push({ m: m, life: 0 });
            ringN++;
          } catch (err) { return; }
        }
        for (k = 0; k < ringN; k++) {
          if (rings[k].life <= 0) {
            try {
              rings[k].life = 0.45;
              rings[k].m.visible = true;
              rings[k].m.position.set(px, py, pz);
              rings[k].m.material.color.setHex(color);
              rings[k].m.material.opacity = 0.9;
              rings[k].m.scale.set(0.6, 0.6, 1);
            } catch (err) { rings[k].life = 0; }
            return;
          }
        }
      }

      function tickGhosts(dt) {
        var k;
        for (k = 0; k < ghostN; k++) {
          var G = ghosts[k];
          if (G.life <= 0) continue;
          G.life -= dt;
          if (G.life <= 0) {
            try { G.s.visible = false; } catch (err) { /* x */ }
            continue;
          }
          var f = G.life / G.max;
          try {
            G.s.position.x += G.vx * dt;
            G.s.position.y += G.vy * dt;
            if (!G.grow) { G.vx *= (1 - 3 * dt); G.vy *= (1 - 3 * dt); }
            var sc = G.s1 + (G.s0 - G.s1) * f;
            G.s.scale.set(sc, sc, 1);
            G.s.material.opacity = 0.9 * f;
          } catch (err) { G.life = 0; }
        }
        for (k = 0; k < ringN; k++) {
          var R = rings[k];
          if (R.life <= 0) continue;
          R.life -= dt;
          if (R.life <= 0) {
            try { R.m.visible = false; } catch (err) { /* x */ }
            continue;
          }
          var rf = 1 - R.life / 0.45;
          try {
            var rs = 0.6 + rf * 4.4;
            R.m.scale.set(rs, rs, 1);
            R.m.material.opacity = 0.9 * (1 - rf);
          } catch (err) { R.life = 0; }
        }
      }

      function clearPlatPools() {
        var k;
        for (k = 0; k < ghostN; k++) {
          ghosts[k].life = 0;
          try { ghosts[k].s.visible = false; } catch (err) { /* x */ }
        }
        for (k = 0; k < ringN; k++) {
          rings[k].life = 0;
          try { rings[k].m.visible = false; } catch (err) { /* x */ }
        }
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

        /* Stage 2 additive: chase proximity rumble (called ~4Hz while
         * Agatha chases; prox01 scales with closeness). */
        chaseRumble: function (prox01) {
          if (reduced) return;
          var p = +prox01 || 0;
          if (p < 0) p = 0;
          if (p > 1) p = 1;
          trauma = Math.min(1, trauma + p * 0.12);
        },

        /* Stage 2 additive: lightning-style silhouette reveal beat. */
        silhouetteReveal: function () {
          exposure = FLASH_EXPOSURE;
          reveal = 1;
          if (!reduced) trauma = Math.min(1, trauma + 0.15);
        },

        /* Subagent C additive: 6 cyan/gold dash afterimages. Call once
         * per dash; ghosts stagger along -dir with alternating colors. */
        dashGhostBurst: function (px, py, pz, dx, dy, gold) {
          var cx = (typeof px === 'number' && isFinite(px)) ? px : 0;
          var cy = (typeof py === 'number' && isFinite(py)) ? py : 0;
          var cz = (typeof pz === 'number' && isFinite(pz)) ? pz : 0;
          var vx = (typeof dx === 'number' && isFinite(dx)) ? dx : 1;
          var vy = (typeof dy === 'number' && isFinite(dy)) ? dy : 0;
          var k;
          for (k = 0; k < 6; k++) {
            var back = 0.25 + k * 0.28;
            var col = ((k + (gold ? 1 : 0)) % 2 === 0) ? 0x66ffee : 0xffcf6e;
            spawnGhost(cx - vx * back, cy - vy * back, cz, col,
              0.95 - k * 0.08, 0.34 - k * 0.015, -vx * 1.2, -vy * 1.2, false);
          }
        },

        /* Single dash-trail ghost (wired to onDashGhost ticks). */
        dashGhost: function (px, py, pz, gold) {
          var cx = (typeof px === 'number' && isFinite(px)) ? px : 0;
          var cy = (typeof py === 'number' && isFinite(py)) ? py : 0;
          var cz = (typeof pz === 'number' && isFinite(pz)) ? pz : 0;
          spawnGhost(cx, cy, cz, gold ? 0xffcf6e : 0x66ffee,
            0.9, 0.34, 0, 0, false);
        },

        /* Landing / footstep dust: soft grey puffs that grow + fade. */
        dustPuff: function (px, py, pz, n) {
          var cx = (typeof px === 'number' && isFinite(px)) ? px : 0;
          var cy = (typeof py === 'number' && isFinite(py)) ? py : 0;
          var cz = (typeof pz === 'number' && isFinite(pz)) ? pz : 0;
          var count = (typeof n === 'number' && n > 0) ? Math.min(8, n | 0) : 4;
          var k;
          for (k = 0; k < count; k++) {
            var a = Math.random() * 6.283;
            var sp = 0.8 + Math.random() * 1.4;
            spawnGhost(cx, cy + 0.1, cz, 0xcfd6dd, 0.3, 0.5,
              Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.7, true);
          }
        },

        /* Wall-slide sparks: fast gold flecks streaming off the wall. */
        wallSparks: function (px, py, pz, dir) {
          var cx = (typeof px === 'number' && isFinite(px)) ? px : 0;
          var cy = (typeof py === 'number' && isFinite(py)) ? py : 0;
          var cz = (typeof pz === 'number' && isFinite(pz)) ? pz : 0;
          var d = dir >= 0 ? 1 : -1;
          var k;
          for (k = 0; k < 3; k++) {
            spawnGhost(cx, cy + (Math.random() - 0.5) * 0.5, cz,
              k === 0 ? 0xfff3c4 : 0xffb14e, 0.2, 0.26,
              -d * (2 + Math.random() * 2.5), -1 - Math.random() * 2, false);
          }
        },

        /* Ori reset shockwave: expanding additive ring in the XY plane. */
        shockwave: function (px, py, pz, color) {
          var cx = (typeof px === 'number' && isFinite(px)) ? px : 0;
          var cy = (typeof py === 'number' && isFinite(py)) ? py : 0;
          var cz = (typeof pz === 'number' && isFinite(pz)) ? pz : 0;
          spawnRing(cx, cy, cz, color || 0x9fe8ff);
        },

        platformerClear: function () {
          clearPlatPools();
        },

        reset: function () {
          trauma = 0;
          reveal = 0;
          clearPlatPools();
          exposure = baseExposure;
          if (renderer) {
            try { renderer.toneMappingExposure = baseExposure; }
            catch (err) { /* ignore */ }
          }
          paintFlashDiv(0);
        },

        update: function (dt, camera) {
          t += dt;
          if (ghostN > 0 || ringN > 0) {
            try { tickGhosts(dt > 0 ? dt : 0.016); }
            catch (err) { /* pools cosmetic */ }
          }
          /* Primary sync: levels publish the strike envelope at
           * scene.userData.stvFlash (0..1); mirror it to exposure. */
          var sky = readSkyFlash();
          /* Stage 2 additive: fold the reveal pulse into the same mirror. */
          if (reveal > 0) {
            reveal -= EXPOSURE_DECAY * dt * 0.5;
            if (reveal < 0) reveal = 0;
            if (reveal > sky) sky = reveal;
          }
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
