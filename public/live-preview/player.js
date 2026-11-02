/* Ashes of St. Vermilion — first-person controller + torch (Stage 1).
 * window.StV_Player.create(camera, colliders, bounds) ->
 *   {pos(), update(dt,input), setTorch, setCrouch, noiseLevel,
 *    setMoveVec, setLookDelta, + additive: reset, setEnabled,
 *    setSensitivity, onStep hook}
 * Units: meters. Eye 1.6m (crouch 0.9m). Walk 3.2 / run 5.2 / crouch 1.6 m/s.
 * Collision: circle (r=0.35m) vs AABB list in XZ + bounds clamp.
 * Look: pointer-lock mouse + drag fallback + touch via setLookDelta.
 * Torch: SpotLight(0xffd9a0, 1.6, 18m, 0.5rad, decay 1.5), 1024 shadow.
 * NOTE: game.js must scene.add(camera) so the torch child renders.
 * Zero allocations in update(): all temps preallocated below.
 */
(function () {
  'use strict';

  var EYE_STAND = 1.6;
  var EYE_CROUCH = 0.9;
  var RADIUS = 0.35;
  var WALK = 3.2;
  var RUN = 5.2;
  var CROUCH_SPD = 1.6;
  var ACCEL = 26;
  var FRICTION = 11;
  var MOUSE_LOOK = 0.0023;
  var TOUCH_LOOK = 0.0042;
  var PITCH_MAX = 1.45;
  var STRIDE_WALK = 1.9;
  var STRIDE_RUN = 2.3;
  var TORCH_BASE = 1.6;

  window.StV_Player = {
    create: function (camera, colliders, bounds) {
      colliders = colliders || [];
      bounds = bounds || { x0: -12, z0: -9, x1: 12, z1: 9 };

      var yaw = 0;
      var pitch = 0;
      var px = 0;
      var pz = 8.5;
      var vx = 0;
      var vz = 0;
      var eyeH = EYE_STAND;
      var torchOn = true;
      var crouch = false;
      var enabled = true;
      var sensitivity = 1.0;
      var touchX = 0;
      var touchZ = 0;
      var noise = 0;
      var stepAcc = 0;
      var bobPhase = 0;
      var flickT = 0;
      var dragging = false;
      var lastDX = 0;
      var lastDY = 0;
      var reducedMotion = false;

      try {
        reducedMotion = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (err) { reducedMotion = false; }

      camera.rotation.order = 'YXZ';

      var torch = new THREE.SpotLight(0xffd9a0, TORCH_BASE, 18, 0.5, 1.5);
      torch.position.set(0.18, -0.1, 0.05);
      torch.castShadow = true;
      torch.shadow.mapSize.width = 1024;
      torch.shadow.mapSize.height = 1024;
      torch.shadow.camera.near = 0.2;
      torch.shadow.camera.far = 18;
      var torchTarget = new THREE.Object3D();
      torchTarget.position.set(0, -0.08, -3);
      camera.add(torchTarget);
      torch.target = torchTarget;
      camera.add(torch);

      function clampLook() {
        if (pitch > PITCH_MAX) pitch = PITCH_MAX;
        if (pitch < -PITCH_MAX) pitch = -PITCH_MAX;
      }

      function applyLook(dx, dy, scale) {
        yaw -= dx * sensitivity * scale;
        pitch -= dy * sensitivity * scale;
        clampLook();
      }

      function pointerLocked() {
        try {
          return !!document.pointerLockElement;
        } catch (err) { return false; }
      }

      function onMouseMove(ev) {
        if (!enabled) return;
        if (pointerLocked()) {
          var mx = ev.movementX || 0;
          var my = ev.movementY || 0;
          applyLook(mx, my, MOUSE_LOOK);
        } else if (dragging) {
          var dx = ev.clientX - lastDX;
          var dy = ev.clientY - lastDY;
          lastDX = ev.clientX;
          lastDY = ev.clientY;
          applyLook(dx, dy, MOUSE_LOOK * 1.4);
        }
      }

      function onMouseDown(ev) {
        if (!enabled || pointerLocked()) return;
        if (ev.button !== 0 && ev.button !== undefined) return;
        dragging = true;
        lastDX = ev.clientX;
        lastDY = ev.clientY;
      }

      function onMouseUp() { dragging = false; }

      var lookEl = null;
      try {
        lookEl = document.getElementById('canvas-container') || document.body;
        document.addEventListener('mousemove', onMouseMove, false);
        lookEl.addEventListener('mousedown', onMouseDown, false);
        document.addEventListener('mouseup', onMouseUp, false);
      } catch (err) { lookEl = null; }

      function clampNum(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
      }

      /* Push circle center (px,pz) out of one AABB. Returns nothing. */
      function resolveOne(c) {
        var cx = clampNum(px, c.x0, c.x1);
        var cz = clampNum(pz, c.z0, c.z1);
        var dx = px - cx;
        var dz = pz - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) return;
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2);
          var push = (RADIUS - d) / d;
          px += dx * push;
          pz += dz * push;
          return;
        }
        /* Center inside the rect: push along min-penetration axis. */
        var pl = px - c.x0;
        var pr = c.x1 - px;
        var pn = pz - c.z0;
        var pf = c.z1 - pz;
        var m = pl;
        var axis = 0;
        if (pr < m) { m = pr; axis = 1; }
        if (pn < m) { m = pn; axis = 2; }
        if (pf < m) { m = pf; axis = 3; }
        if (axis === 0) px = c.x0 - RADIUS;
        else if (axis === 1) px = c.x1 + RADIUS;
        else if (axis === 2) pz = c.z0 - RADIUS;
        else pz = c.z1 + RADIUS;
      }

      function collide() {
        var i;
        for (i = 0; i < colliders.length; i++) resolveOne(colliders[i]);
        px = clampNum(px, bounds.x0 + RADIUS, bounds.x1 - RADIUS);
        pz = clampNum(pz, bounds.z0 + RADIUS, bounds.z1 - RADIUS);
      }

      var api = {
        onStep: null,

        pos: function () { return camera.position; },

        setTorch: function (on) {
          torchOn = !!on;
          torch.visible = torchOn;
        },
        isTorchOn: function () { return torchOn; },

        setCrouch: function (on) { crouch = !!on; },
        isCrouch: function () { return crouch; },

        setEnabled: function (on) {
          enabled = !!on;
          if (!enabled) { dragging = false; vx = 0; vz = 0; }
        },

        setSensitivity: function (v) {
          if (typeof v === 'number' && isFinite(v)) {
            sensitivity = Math.min(2, Math.max(0.5, v));
          }
        },

        setMoveVec: function (x, z) {
          touchX = clampNum(+x || 0, -1, 1);
          touchZ = clampNum(+z || 0, -1, 1);
        },

        setLookDelta: function (dx, dy) {
          if (!enabled) return;
          applyLook(+dx || 0, +dy || 0, TOUCH_LOOK);
        },

        noiseLevel: function () { return noise; },

        reset: function (x, z, ry) {
          px = (typeof x === 'number') ? x : 0;
          pz = (typeof z === 'number') ? z : 8.5;
          if (typeof ry === 'number') yaw = ry;
          pitch = 0;
          vx = 0;
          vz = 0;
          noise = 0;
          stepAcc = 0;
          bobPhase = 0;
          touchX = 0;
          touchZ = 0;
          dragging = false;
          eyeH = crouch ? EYE_CROUCH : EYE_STAND;
          collide();
          camera.position.set(px, eyeH, pz);
          camera.rotation.set(0, yaw, 0);
        },

        update: function (dt, input) {
          if (!enabled) return;
          input = input || {};
          var f = (input.f ? 1 : 0) - (input.b ? 1 : 0) + touchZ;
          var s = (input.r ? 1 : 0) - (input.l ? 1 : 0) + touchX;
          var mag = Math.sqrt(f * f + s * s);
          if (mag > 1) { f /= mag; s /= mag; mag = 1; }

          var running = !!input.run && !crouch && f > 0.1;
          var speed = crouch ? CROUCH_SPD : (running ? RUN : WALK);

          var sy = Math.sin(yaw);
          var cy = Math.cos(yaw);
          var tvx = (f * -sy + s * cy) * speed;
          var tvz = (f * -cy + s * -sy) * speed;

          var rate = (mag > 0.05) ? ACCEL : FRICTION;
          var k = 1 - Math.exp(-rate * dt);
          vx += (tvx - vx) * k;
          vz += (tvz - vz) * k;

          /* Axis-separated integrate + resolve (stable corners). */
          px += vx * dt;
          collide();
          pz += vz * dt;
          collide();

          /* Kill velocity leaking into walls: re-derive from travel. */
          var eyeTarget = crouch ? EYE_CROUCH : EYE_STAND;
          eyeH += (eyeTarget - eyeH) * (1 - Math.exp(-12 * dt));

          var planar = Math.sqrt(vx * vx + vz * vz);
          var bob = 0;
          if (!reducedMotion && planar > 0.3) {
            bobPhase += dt * planar * 2.2;
            bob = Math.sin(bobPhase) * 0.028 * Math.min(1, planar / WALK);
          }

          camera.position.set(px, eyeH + bob, pz);
          camera.rotation.set(pitch, yaw, 0);

          flickT += dt;
          if (torchOn) {
            torch.intensity = TORCH_BASE *
              (1 + 0.05 * Math.sin(flickT * 13.7) + 0.03 * Math.sin(flickT * 31.3 + 1.7));
          }

          var nTarget = 0;
          if (planar > 0.3) {
            nTarget = crouch ? 0.25 : (running && planar > 4 ? 1 : 0.55);
          }
          noise += (nTarget - noise) * (1 - Math.exp(-6 * dt));

          stepAcc += planar * dt;
          var stride = running ? STRIDE_RUN : STRIDE_WALK;
          if (stepAcc >= stride && planar > 0.5 && api.onStep) {
            stepAcc = 0;
            api.onStep(running);
          }
        }
      };

      api.reset(px, pz, 0);
      return api;
    }
  };
})();
