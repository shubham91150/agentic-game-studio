/* Ashes of St. Vermilion — first-person controller + torch (Stage 1).
 * window.StV_Player.create(camera, colliders, bounds) ->
 *   {pos(), update(dt,input), setTorch, setCrouch, noiseLevel,
 *    setMoveVec, setLookDelta, + additive: reset, setEnabled,
 *    setSensitivity, onStep hook, HN2 hide: enterHide/exitHide/isHidden}
 * Units: meters. Eye 1.6m (crouch 0.9m). Walk 3.2 / run 5.2 / crouch 1.6 m/s.
 * Collision: circle (r=0.35m) vs AABB list in XZ + bounds clamp.
 * Look: pointer-lock mouse + drag fallback + touch via setLookDelta.
 * Torch: SpotLight(0xffd9a0, 1.6, 18m, 0.5rad, decay 1.5), 1024 shadow.
 * Held lantern viewmodel: real CC0 Lantern_01_1k.glb (same cached URL the
 *   world lanterns use, so no extra download) attached as a camera child at
 *   lower-right (0.28, -0.26, -0.45), with subtle walk-bob, crouch offset,
 *   smoothed look-delta inertia sway, and torch-driven amber glass glow.
 *   Photogrammetry PBR materials are kept as-authored (cloned per-instance
 *   so scene lanterns are never affected); only glass emissive animates.
 * NOTE: game.js must scene.add(camera) so camera children render (done there).
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
  var LANTERN_URL = '/studio/assets/polyhaven/Lantern_01/Lantern_01_1k.glb';
  var LANTERN_BASE_X = 0.28;
  var LANTERN_BASE_Y = -0.26;
  var LANTERN_BASE_Z = -0.45;
  var LANTERN_LEN = 0.22;
  var SWAY_MAX = 0.03;
  var GLASS_HEX = 0xffa63e;
  var GLASS_EI = 1.6;
  var HIDE_EYE = 1.55;
  var HIDE_PEEK = 0.35;

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
      var emfF = 0; // goosebump EM proximity factor 0..1 (game.js fed)
      var dragging = false;
      var lastDX = 0;
      var lastDY = 0;
      var reducedMotion = false;
      /* Held-lantern viewmodel state (all preallocated; update() stays GC-free). */
      var lanternRig = null;
      var lanternLoaded = false;
      var glassMats = [];
      var accYaw = 0;
      var accPitch = 0;
      var smYawV = 0;
      var smPitchV = 0;
      var crouchK = 0;
      /* HN2 hide-mode state: resume snapshot + door-gap peek anchor. */
      var hidden = false;
      var hidePX = 0;
      var hidePZ = 0;
      var hideYaw = 0;
      var hidePitch = 0;
      var hideTorch = true;
      var hideCrouch = false;
      var hidePeekX = 0;
      var hidePeekZ = 0;

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

      /* Lower-right first-person hand rig; the .glb docks here on load. */
      lanternRig = new THREE.Group();
      lanternRig.position.set(LANTERN_BASE_X, LANTERN_BASE_Y, LANTERN_BASE_Z);
      camera.add(lanternRig);
      loadLanternViewmodel();

      /* Glass material entries {m, offH, offI}; mesh materials are cloned
       * first so the world lanterns sharing the cached .glb keep their own. */
      function pushGlassMat(mesh, mat, idx) {
        if (!mat || !mat.emissive || typeof mat.name !== 'string') return;
        if (mat.name.toLowerCase().indexOf('glass') < 0) return;
        try {
          var own = mat.clone();
          if (typeof idx === 'number') mesh.material[idx] = own;
          else mesh.material = own;
          glassMats.push({
            m: own,
            offH: own.emissive.getHex(),
            offI: own.emissiveIntensity
          });
        } catch (eGlass) { /* keep shared material, skip glow control */ }
      }

      function collectGlassMats(root) {
        glassMats = [];
        try {
          root.traverse(function (o) {
            var m = o && o.material;
            if (!m) return;
            var i;
            if (m.length !== undefined && typeof m !== 'string') {
              for (i = 0; i < m.length; i++) pushGlassMat(o, m[i], i);
            } else {
              pushGlassMat(o, m);
            }
          });
        } catch (eTrav) { /* model variant without named glass */ }
      }

      function applyGlassTorch() {
        for (var i = 0; i < glassMats.length; i++) {
          var g = glassMats[i];
          try {
            if (torchOn) {
              g.m.emissive.setHex(GLASS_HEX);
              g.m.emissiveIntensity = GLASS_EI;
            } else {
              g.m.emissive.setHex(g.offH);
              g.m.emissiveIntensity = g.offI;
            }
          } catch (eApply) { /* ignore */ }
        }
      }

      function onLanternLoaded(root) {
        if (!root || lanternLoaded) return;
        try {
          /* Recenter geometry centroid on the rig so vendor grounding
           * offsets never shift the hand placement. */
          root.updateMatrixWorld(true);
          var box = new THREE.Box3().setFromObject(root);
          var c = box.getCenter(new THREE.Vector3());
          root.position.x -= c.x;
          root.position.y -= c.y;
          root.position.z -= c.z;
          /* A hand prop must never cast/receive scene shadows. */
          root.traverse(function (o) {
            if (o && o.isMesh) {
              o.castShadow = false;
              o.receiveShadow = false;
            }
          });
        } catch (eFit) { /* keep vendor placement */ }
        collectGlassMats(root);
        applyGlassTorch();
        lanternRig.add(root);
        lanternLoaded = true;
      }

      function loadLanternViewmodel() {
        function ok(root) { onLanternLoaded(root); }
        function fail(err) {
          try {
            if (window.console && console.warn) {
              console.warn('[StV_Player] lantern viewmodel unavailable: ' +
                ((err && err.message) || err));
            }
          } catch (eLog) { /* ignore */ }
        }
        try {
          var WR = window.WorldRealism;
          if (WR && typeof WR.loadGlbModel === 'function') {
            var pr = WR.loadGlbModel(LANTERN_URL, ok, {
              targetLength: LANTERN_LEN,
              onError: fail
            });
            if (pr && typeof pr.catch === 'function') {
              pr.catch(function () { /* handled through onError */ });
            }
            return;
          }
          if (window.THREE && window.THREE.GLTFLoader) {
            new window.THREE.GLTFLoader().load(LANTERN_URL, function (gltf) {
              if (gltf && gltf.scene) {
                try {
                  var b = new THREE.Box3().setFromObject(gltf.scene);
                  var s = b.getSize(new THREE.Vector3());
                  var longest = Math.max(s.x, Math.max(s.y, s.z));
                  if (longest > 1e-6) {
                    gltf.scene.scale.setScalar(LANTERN_LEN / longest);
                  }
                } catch (eS) { /* keep author scale */ }
                ok(gltf.scene);
              } else {
                fail(new Error('empty gltf'));
              }
            }, undefined, fail);
            return;
          }
          fail(new Error('no loader'));
        } catch (eLoad) { fail(eLoad); }
      }

      function clampLook() {
        if (pitch > PITCH_MAX) pitch = PITCH_MAX;
        if (pitch < -PITCH_MAX) pitch = -PITCH_MAX;
      }

      function applyLook(dx, dy, scale) {
        var ax = dx * sensitivity * scale;
        var ay = dy * sensitivity * scale;
        yaw -= ax;
        pitch -= ay;
        /* Feed the viewmodel inertia sway (consumed + zeroed in update). */
        accYaw -= ax;
        accPitch -= ay;
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
          if (hidden) {
            /* Torch stays dark inside; remember the desired state. */
            hideTorch = !!on;
            torchOn = false;
            torch.visible = false;
            applyGlassTorch();
            return;
          }
          torchOn = !!on;
          torch.visible = torchOn;
          applyGlassTorch();
        },
        isTorchOn: function () { return hidden ? false : torchOn; },

        setCrouch: function (on) {
          if (hidden) { hideCrouch = !!on; crouch = false; return; }
          crouch = !!on;
        },
        isCrouch: function () { return hidden ? false : crouch; },

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

        noiseLevel: function () { return hidden ? 0 : noise; },

        isHidden: function () { return hidden; },
        setEMFlicker: function (f) {
          emfF = Math.max(0, Math.min(1, +f || 0));
        },

        enterHide: function (x, z, ry) {
          if (hidden) return false;
          if (typeof x !== 'number' || typeof z !== 'number' ||
              typeof ry !== 'number') return false;
          if (!isFinite(x) || !isFinite(z) || !isFinite(ry)) return false;
          hidePX = px;
          hidePZ = pz;
          hideYaw = yaw;
          hidePitch = pitch;
          hideTorch = torchOn;
          hideCrouch = crouch;
          hidden = true;
          px = x;
          pz = z;
          vx = 0;
          vz = 0;
          crouch = false;
          yaw = ry;
          pitch = 0;
          accYaw = 0;
          accPitch = 0;
          noise = 0;
          stepAcc = 0;
          /* Door-gap peek: eye 1.55m, 0.35m out along facing
           * forward(ry) = (-sin ry, -cos ry). */
          hidePeekX = x - Math.sin(ry) * HIDE_PEEK;
          hidePeekZ = z - Math.cos(ry) * HIDE_PEEK;
          eyeH = HIDE_EYE;
          torchOn = false;
          torch.visible = false;
          applyGlassTorch();
          camera.position.set(hidePeekX, HIDE_EYE, hidePeekZ);
          camera.rotation.set(pitch, yaw, 0);
          return true;
        },

        exitHide: function () {
          if (!hidden) return false;
          hidden = false;
          px = hidePX;
          pz = hidePZ;
          yaw = hideYaw;
          pitch = hidePitch;
          clampLook();
          vx = 0;
          vz = 0;
          noise = 0;
          stepAcc = 0;
          crouch = !!hideCrouch;
          eyeH = crouch ? EYE_CROUCH : EYE_STAND;
          torchOn = !!hideTorch;
          torch.visible = torchOn;
          applyGlassTorch();
          collide();
          camera.position.set(px, eyeH, pz);
          camera.rotation.set(pitch, yaw, 0);
          return true;
        },

        reset: function (x, z, ry) {
          if (hidden) {
            hidden = false;
            crouch = !!hideCrouch;
            torchOn = !!hideTorch;
            torch.visible = torchOn;
            applyGlassTorch();
          }
          px = (typeof x === 'number') ? x : 0;
          pz = (typeof z === 'number') ? z : 8.5;
          if (typeof ry === 'number') yaw = ry;
          pitch = 0;
          vx = 0;
          vz = 0;
          noise = 0;
          stepAcc = 0;
          bobPhase = 0;
          accYaw = 0;
          accPitch = 0;
          smYawV = 0;
          smPitchV = 0;
          crouchK = 0;
          if (lanternRig) {
            lanternRig.position.set(
              LANTERN_BASE_X, LANTERN_BASE_Y, LANTERN_BASE_Z);
            lanternRig.rotation.set(0, 0, 0);
          }
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
          var f;
          var s;
          var mag;
          var running;
          if (hidden) {
            /* Locked inside: no translation, camera stays live. */
            f = 0;
            s = 0;
            mag = 0;
            running = false;
          } else {
            f = (input.f ? 1 : 0) - (input.b ? 1 : 0) + touchZ;
            s = (input.r ? 1 : 0) - (input.l ? 1 : 0) + touchX;
            mag = Math.sqrt(f * f + s * s);
            if (mag > 1) { f /= mag; s /= mag; mag = 1; }
            running = !!input.run && !crouch && f > 0.1;
          }
          var speed = crouch ? CROUCH_SPD : (running ? RUN : WALK);

          var sy = Math.sin(yaw);
          var cy = Math.cos(yaw);
          var tvx = 0;
          var tvz = 0;
          if (!hidden) {
            tvx = (f * -sy + s * cy) * speed;
            tvz = (f * -cy + s * -sy) * speed;
          }

          var rate = (!hidden && mag > 0.05) ? ACCEL : FRICTION;
          var k = 1 - Math.exp(-rate * dt);
          vx += (tvx - vx) * k;
          vz += (tvz - vz) * k;

          if (!hidden) {
            /* Axis-separated integrate + resolve (stable corners). */
            px += vx * dt;
            collide();
            pz += vz * dt;
            collide();
          }

          /* Kill velocity leaking into walls: re-derive from travel. */
          var eyeTarget = hidden ? HIDE_EYE :
            (crouch ? EYE_CROUCH : EYE_STAND);
          eyeH += (eyeTarget - eyeH) * (1 - Math.exp(-12 * dt));

          var planar = Math.sqrt(vx * vx + vz * vz);
          var bob = 0;
          if (!hidden && !reducedMotion && planar > 0.3) {
            bobPhase += dt * planar * 2.2;
            bob = Math.sin(bobPhase) * 0.028 * Math.min(1, planar / WALK);
          }

          if (hidden) {
            camera.position.set(hidePeekX, eyeH + bob, hidePeekZ);
          } else {
            camera.position.set(px, eyeH + bob, pz);
          }
          camera.rotation.set(pitch, yaw, 0);

          flickT += dt;
          if (hidden) {
            if (torch.visible) torch.visible = false;
          } else if (torchOn) {
            // Goosebump EM flicker: held lantern shudders as Agatha nears.
            var emfH = 1 + Math.sin(flickT * 43.0) * 0.35 * emfF;
            torch.intensity = TORCH_BASE *
              (1 + 0.05 * Math.sin(flickT * 13.7) + 0.03 * Math.sin(flickT * 31.3 + 1.7)) * emfH;
          }

          /* Held-lantern viewmodel: smoothed look inertia + subtle physical
           * walk drift + crouch dip. Amplitudes stay millimetric (no cartoon
           * bob); reduced-motion users get a static hand prop. */
          if (lanternRig) {
            var idt = dt > 1e-4 ? 1 / dt : 0;
            var yawV = accYaw * idt;
            var pitchV = accPitch * idt;
            accYaw = 0;
            accPitch = 0;
            var sk = 1 - Math.exp(-8 * dt);
            smYawV += (yawV - smYawV) * sk;
            smPitchV += (pitchV - smPitchV) * sk;
            var ckT = crouch ? 1 : 0;
            crouchK += (ckT - crouchK) * (1 - Math.exp(-10 * dt));
            var amp = reducedMotion ? 0 : 1;
            var spdK = Math.min(1, planar / WALK);
            var swayX = -smYawV * 0.012 * amp;
            var swayY = smPitchV * 0.010 * amp;
            if (swayX > SWAY_MAX) swayX = SWAY_MAX;
            else if (swayX < -SWAY_MAX) swayX = -SWAY_MAX;
            if (swayY > SWAY_MAX) swayY = SWAY_MAX;
            else if (swayY < -SWAY_MAX) swayY = -SWAY_MAX;
            var walkX = 0;
            var walkY = 0;
            if (planar > 0.3 && amp) {
              walkX = Math.cos(bobPhase * 0.5) * 0.005 * spdK;
              walkY = Math.sin(bobPhase + 0.6) * 0.006 * spdK;
            }
            lanternRig.position.set(
              LANTERN_BASE_X + swayX + walkX,
              LANTERN_BASE_Y + swayY + walkY - 0.05 * crouchK,
              LANTERN_BASE_Z + 0.02 * crouchK
            );
            lanternRig.rotation.set(
              swayY * 1.5,
              swayX * 2.0,
              swayX * 1.2 + walkX * 0.8
            );
            /* Glass breathes with the same flame flicker as the spotlight. */
            if (lanternLoaded && torchOn && glassMats.length) {
              var fl = 1 + 0.05 * Math.sin(flickT * 13.7) +
                0.03 * Math.sin(flickT * 31.3 + 1.7);
              for (var gi = 0; gi < glassMats.length; gi++) {
                glassMats[gi].m.emissiveIntensity = GLASS_EI * fl;
              }
            }
          }

          var nTarget = 0;
          if (!hidden && planar > 0.3) {
            nTarget = crouch ? 0.25 : (running && planar > 4 ? 1 : 0.55);
          }
          noise += (nTarget - noise) * (1 - Math.exp(-6 * dt));
          if (hidden) noise = 0;

          if (!hidden) {
            stepAcc += planar * dt;
            var stride = running ? STRIDE_RUN : STRIDE_WALK;
            if (stepAcc >= stride && planar > 0.5 && api.onStep) {
              stepAcc = 0;
              api.onStep(running);
            }
          }
        }
      };

      api.reset(px, pz, 0);
      return api;
    }
  };
})();
