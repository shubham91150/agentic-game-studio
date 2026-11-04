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
  var HIDE_PEEK = 0.72;

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
          /* Door-gap peek: eye 1.55m, 0.72m out along facing
           * (clears the ~0.6m cabinet door plane so the eye looks
           * INTO the room, not at the mesh interior) forward(ry) =
           * (-sin ry, -cos ry). CSS crack overlay sells the slit. */
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

  /* ================================================================
   * StV_Platformer — Celeste-grade frame-perfect side-view (XY, y-up)
   * controller + Ori soul-lantern dash reset (Subagent C, additive).
   * Level import contract (provided by the platform build of levels.js
   * as window.StV_PlatformLevel; EVERYTHING optional, code is defensive):
   *   { solids: [{x0,y0,x1,y1}], soulLanterns: [{x,y}],
   *     orbs: [{x,y}], hazards: [{x,y,r}], spawn: {x,y},
   *     bounds: {x0,y0,x1,y1} }
   * Missing contract => built-in fallback course (FALLBACK_* below) so the
   * controller is playable standalone. Physics runs at FIXED = 1/60 driven
   * by the game loop; step() clamps stray dt. Zero heap allocs in step().
   * Math: doc 02 Celeste (derived g, 3-phase gravity, coyote 110ms,
   * buffer 120ms, variable jump, apex hang, wall-slide/jump, 8-dir dash).
   * ================================================================ */
  var PLAT_FIXED = 1 / 60;
  var PLAT_JUMP_H = 2.05;
  var PLAT_T_APEX = 0.36;
  var PLAT_G_UP = (-2 * PLAT_JUMP_H) / (PLAT_T_APEX * PLAT_T_APEX);
  var PLAT_V_JUMP = Math.abs(PLAT_G_UP) * PLAT_T_APEX;
  var PLAT_MAX_RUN = 7.2;
  var PLAT_GROUND_ACCEL = 65;
  var PLAT_GROUND_FRICTION = 55;
  var PLAT_AIR_ACCEL = 42;
  var PLAT_TERMINAL = -23;
  var PLAT_APEX_V = 1.8;
  var PLAT_COYOTE = 0.11;
  var PLAT_BUFFER = 0.12;
  var PLAT_WALL_SLIDE_V = -2.4;
  var PLAT_WALL_JUMP_X = 7.6;
  var PLAT_WALL_LOCK = 0.14;
  var PLAT_DASH_T = 0.15;
  var PLAT_DASH_SPD = 16.5;
  var PLAT_DASH_END_KEEP = 0.45;
  var PLAT_LANTERN_R = 2.2;
  var PLAT_LANTERN_CD = 0.6;
  var PLAT_ORB_R = 0.55;
  var PLAT_HW = 0.2;
  var PLAT_HH = 0.34;

  var FALLBACK_SOLIDS = [
    { x0: -14, y0: -1.2, x1: 14, y1: 0 },
    { x0: -14, y0: 0, x1: -11.5, y1: 7 },
    { x0: 11.5, y0: 0, x1: 14, y1: 7 },
    { x0: -6.5, y0: 1.7, x1: -3.5, y1: 2.1 },
    { x0: 0.5, y0: 2.9, x1: 3.5, y1: 3.3 },
    { x0: 5.5, y0: 4.1, x1: 8.5, y1: 4.5 },
    { x0: -9.5, y0: 4.6, x1: -6.5, y1: 5.0 },
    { x0: -3.5, y0: 6.1, x1: 3.5, y1: 6.5 }
  ];
  var FALLBACK_LANTERNS = [{ x: 2, y: 4.4 }, { x: -5, y: 3.2 }];
  var FALLBACK_ORBS = [
    { x: -5, y: 2.9 }, { x: 2, y: 4.1 }, { x: 7, y: 5.3 },
    { x: -8, y: 5.8 }, { x: 0, y: 7.3 }
  ];
  var FALLBACK_SPAWN = { x: -9, y: 1.2 };
  var FALLBACK_BOUNDS = { x0: -14, y0: -3, x1: 14, y1: 10 };

  function platNum(v, dflt) {
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function platLevelData() {
    var L = null;
    try { L = window.StV_PlatformLevel || null; } catch (e) { L = null; }
    function arr(v, fb) {
      if (v && v.length !== undefined && v.length > 0) return v;
      return fb;
    }
    var solids = arr(L && L.solids, FALLBACK_SOLIDS);
    var lanterns = arr(L && L.soulLanterns, FALLBACK_LANTERNS);
    var orbs = arr(L && L.orbs, FALLBACK_ORBS);
    var spawn = (L && L.spawn) || FALLBACK_SPAWN;
    var bounds = (L && L.bounds) || FALLBACK_BOUNDS;
    /* Subagent D: the contract documents hazards but levelData() never
     * returned them — water/death zones were silently harmless. */
    var hazards = (L && L.hazards && L.hazards.length > 0) ? L.hazards : [];
    return { solids: solids, lanterns: lanterns, orbs: orbs, hazards: hazards, spawn: spawn, bounds: bounds };
  }

  window.StV_Platformer = {
    FIXED: PLAT_FIXED,
    VERSION: 'celeste-ori-1.0.0',
    levelData: platLevelData,
    create: function (opts) {
      opts = opts || {};
      var D = platLevelData();
      var solids = opts.solids || D.solids;
      var bounds = opts.bounds || D.bounds;
      var spawn = opts.spawn || D.spawn;
      var hw = platNum(opts.halfW, PLAT_HW);
      var hh = platNum(opts.halfH, PLAT_HH);

      var lanterns = [];
      var orbs = [];
      var hazards = opts.hazards || D.hazards || [];
      var i;
      var srcL = opts.soulLanterns || D.lanterns;
      for (i = 0; i < srcL.length; i++) {
        lanterns.push({ x: platNum(srcL[i].x, 0), y: platNum(srcL[i].y, 2), cd: 0 });
      }
      var srcO = opts.orbs || D.orbs;
      for (i = 0; i < srcO.length; i++) {
        orbs.push({ x: platNum(srcO[i].x, 0), y: platNum(srcO[i].y, 2), taken: false });
      }

      var x = platNum(spawn.x, FALLBACK_SPAWN.x);
      var y = platNum(spawn.y, FALLBACK_SPAWN.y);
      var vx = 0;
      var vy = 0;
      var face = 1;
      var grounded = false;
      var wallDir = 0;
      var coyote = 0;
      var buffer = 0;
      var wallLock = 0;
      var dashT = 0;
      var dashDX = 1;
      var dashDY = 0;
      var dashUsed = false;
      var canDouble = true;
      var ghostAcc = 0;
      var hurtCd = 0;
      var stepAcc = 0;
      var orbCount = 0;
      var jumps = 0;

      function overlaps(s) {
        /* Subagent D: fallen crumble stones (levels.js .active=false)
         * never collide invisibly. */
        if (s.active === false) return false;
        return x + hw > s.x0 && x - hw < s.x1 && y + hh > s.y0 && y - hh < s.y1;
      }

      function collideX() {
        var s;
        for (var k = 0; k < solids.length; k++) {
          s = solids[k];
          if (!overlaps(s)) continue;
          if (vx > 0) { x = s.x0 - hw; wallDir = 1; }
          else if (vx < 0) { x = s.x1 + hw; wallDir = -1; }
          else {
            var pl = (x + hw) - s.x0;
            var pr = s.x1 - (x - hw);
            if (pl < pr) { x = s.x0 - hw; wallDir = 1; }
            else { x = s.x1 + hw; wallDir = -1; }
          }
          vx = 0;
        }
      }

      function collideY() {
        var s;
        for (var k = 0; k < solids.length; k++) {
          s = solids[k];
          if (!overlaps(s)) continue;
          if (vy <= 0) {
            /* Land: snap feet to the top face. */
            if (y > (s.y0 + s.y1) / 2) {
              y = s.y1 + hh;
              if (!grounded && vy < -9 && api.onLand) api.onLand(vy);
              vy = 0;
              grounded = true;
            } else {
              y = s.y0 - hh;
              vy = 0;
            }
          } else {
            y = s.y0 - hh;
            vy = 0;
          }
        }
      }

      function quantizeDash(dx, dy) {
        if (dx === 0 && dy === 0) { dx = face; dy = 0; }
        var ang = Math.atan2(dy, dx);
        var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        return [Math.cos(snap), Math.sin(snap)];
      }

      var api = {
        onJump: null,
        onLand: null,
        onDash: null,
        onDashGhost: null,
        onWallSlide: null,
        onWallJump: null,
        onReset: null,
        onOrb: null,
        onHazard: null,
        onStep: null,

        reset: function (rx, ry) {
          x = platNum(rx, platNum(spawn.x, FALLBACK_SPAWN.x));
          y = platNum(ry, platNum(spawn.y, FALLBACK_SPAWN.y));
          vx = 0; vy = 0; face = 1;
          grounded = false; wallDir = 0;
          coyote = 0; buffer = 0; wallLock = 0;
          dashT = 0; dashUsed = false; canDouble = true;
          ghostAcc = 0; hurtCd = 0; stepAcc = 0;
          var k;
          for (k = 0; k < lanterns.length; k++) lanterns[k].cd = 0;
          for (k = 0; k < orbs.length; k++) orbs[k].taken = false;
          orbCount = 0;
        },

        pos: function () { return { x: x, y: y }; },
        vel: function () { return { x: vx, y: vy }; },

        /* Subagent D additive: moving-platform carry (frame delta) and
         * debug/QA teleport. Neither touches orbs, lanterns, or lives. */
        nudge: function (dx, dy) {
          if (typeof dx === 'number' && isFinite(dx)) x += dx;
          if (typeof dy === 'number' && isFinite(dy)) y += dy;
        },
        teleport: function (nx, ny) {
          if (typeof nx === 'number' && isFinite(nx)) x = nx;
          if (typeof ny === 'number' && isFinite(ny)) y = ny;
          vx = 0; vy = 0;
          dashT = 0;
          grounded = false; wallDir = 0;
        },
        state: function () {
          return {
            x: x, y: y, vx: vx, vy: vy, face: face,
            grounded: grounded, wallDir: wallDir,
            dashReady: !dashUsed, doubleReady: canDouble,
            dashing: dashT > 0, orbs: orbCount, jumps: jumps
          };
        },
        lanterns: function () { return lanterns; },
        orbList: function () { return orbs; },

        step: function (dt, input) {
          if (!(dt > 0)) return;
          if (dt > 0.05) dt = 0.05;
          input = input || {};
          var move = platNum(input.move, 0);
          if (move > 1) move = 1;
          else if (move < -1) move = -1;

          var wasGrounded = grounded;
          var k;

          /* --- dash state: fixed velocity, zero gravity, ghost ticks --- */
          if (dashT > 0) {
            dashT -= dt;
            vx = dashDX * PLAT_DASH_SPD;
            vy = dashDY * PLAT_DASH_SPD;
            ghostAcc += dt;
            if (ghostAcc >= 0.025) {
              ghostAcc = 0;
              if (api.onDashGhost) api.onDashGhost(x, y, dashDX, dashDY);
            }
            if (dashT <= 0) {
              vx = dashDX * PLAT_DASH_SPD * PLAT_DASH_END_KEEP;
              vy = dashDY * PLAT_DASH_SPD * PLAT_DASH_END_KEEP;
              if (dashDY > 0.5 && vy > 4) vy = 4;
            }
          }

          /* --- timers --- */
          if (grounded) coyote = PLAT_COYOTE;
          else if (coyote > 0) { coyote -= dt; if (coyote < 0) coyote = 0; }
          if (input.jumpPressed) buffer = PLAT_BUFFER;
          else if (buffer > 0) { buffer -= dt; if (buffer < 0) buffer = 0; }
          if (wallLock > 0) wallLock -= dt;
          if (hurtCd > 0) hurtCd -= dt;
          for (k = 0; k < lanterns.length; k++) {
            if (lanterns[k].cd > 0) lanterns[k].cd -= dt;
          }

          /* --- horizontal: accel toward wish, friction on idle --- */
          if (dashT <= 0) {
            if (move !== 0) face = move > 0 ? 1 : -1;
            var wish = move * PLAT_MAX_RUN;
            var nearApex = !grounded && Math.abs(vy) < PLAT_APEX_V;
            var acc = grounded
              ? (move !== 0 ? PLAT_GROUND_ACCEL : PLAT_GROUND_FRICTION)
              : PLAT_AIR_ACCEL * (nearApex ? 1.25 : 1.0);
            if (wallLock > 0 && ((wallDir > 0 && move > 0) || (wallDir < 0 && move < 0))) {
              acc = 0;
            }
            var dv = wish - vx;
            var md = acc * dt;
            if (dv > md) vx += md;
            else if (dv < -md) vx -= md;
            else vx = wish;
          }

          /* --- wall slide: clamp sink, spark hook --- */
          var sliding = false;
          if (!grounded && dashT <= 0 && wallDir !== 0 && vy < 0) {
            var pressing = (wallDir > 0 && move > 0) || (wallDir < 0 && move < 0);
            if (pressing) {
              sliding = true;
              if (vy < PLAT_WALL_SLIDE_V) vy = PLAT_WALL_SLIDE_V;
              if (api.onWallSlide) api.onWallSlide(x + wallDir * hw, y, wallDir);
            }
          }

          /* --- jumps: buffered ground/coyote, wall, double --- */
          if (buffer > 0 && dashT <= 0) {
            if (coyote > 0) {
              vy = PLAT_V_JUMP;
              grounded = false; coyote = 0; buffer = 0;
              jumps++;
              if (api.onJump) api.onJump(x, y, 'ground');
            } else if (sliding || (wallDir !== 0 && !grounded && wallLock <= 0 &&
                ((wallDir > 0 && move >= 0) || (wallDir < 0 && move <= 0)))) {
              var wd = wallDir !== 0 ? wallDir : (move !== 0 ? (move > 0 ? 1 : -1) : -face);
              vx = -wd * PLAT_WALL_JUMP_X;
              vy = PLAT_V_JUMP * 0.92;
              face = -wd;
              wallLock = PLAT_WALL_LOCK;
              wallDir = 0;
              buffer = 0;
              jumps++;
              if (api.onWallJump) api.onWallJump(x, y, wd);
            } else if (canDouble) {
              canDouble = false;
              vy = PLAT_V_JUMP * 0.85;
              buffer = 0;
              jumps++;
              if (api.onJump) api.onJump(x, y, 'double');
            }
          }

          /* --- 8-dir air/ground dash --- */
          if (input.dashPressed && dashT <= 0 && !dashUsed) {
            var ddx = platNum(input.dashX, 0);
            var ddy = platNum(input.dashY, 0);
            if (ddx === 0 && ddy === 0) {
              ddx = move !== 0 ? move : face;
              ddy = 0;
            }
            var q = quantizeDash(ddx, ddy);
            dashDX = q[0]; dashDY = q[1];
            if (Math.abs(dashDX) > 0.1) face = dashDX > 0 ? 1 : -1;
            dashT = PLAT_DASH_T;
            dashUsed = true;
            ghostAcc = 0.025;
            if (api.onDash) api.onDash(x, y, dashDX, dashDY);
          }

          /* --- 3-phase asymmetric gravity (variable height + apex hang) --- */
          if (dashT <= 0) {
            var g = PLAT_G_UP;
            if (sliding) {
              g = 0;
              if (vy < PLAT_WALL_SLIDE_V) vy = PLAT_WALL_SLIDE_V;
            } else if (vy > PLAT_APEX_V) {
              g = input.jumpHeld ? PLAT_G_UP : PLAT_G_UP * 2.6;
            } else if (Math.abs(vy) <= PLAT_APEX_V && !grounded) {
              g = PLAT_G_UP * 0.5;
            } else {
              g = PLAT_G_UP * 1.65;
            }
            vy += g * dt;
            if (vy < PLAT_TERMINAL) vy = PLAT_TERMINAL;
          }

          /* --- integrate + axis-separated collide --- */
          wallDir = 0;
          grounded = false;
          x += vx * dt;
          collideX();
          y += vy * dt;
          collideY();
          if (x < bounds.x0 + hw) { x = bounds.x0 + hw; if (vx < 0) vx = 0; }
          if (x > bounds.x1 - hw) { x = bounds.x1 - hw; if (vx > 0) vx = 0; }
          if (y < bounds.y0 + hh) { y = bounds.y0 + hh; vy = 0; grounded = true; }
          if (y > bounds.y1 - hh) { y = bounds.y1 - hh; if (vy > 0) vy = 0; }

          /* --- landing refill + run footsteps --- */
          if (grounded) {
            var landed = !wasGrounded;
            dashUsed = false;
            canDouble = true;
            if (landed && api.onLand) api.onLand(vy);
            if (Math.abs(vx) > 1.2) {
              stepAcc += Math.abs(vx) * dt;
              if (stepAcc >= 2.1) {
                stepAcc = 0;
                if (api.onStep) api.onStep(Math.abs(vx) > 5.5);
              }
            } else {
              stepAcc = 0;
            }
          }

          /* --- Ori soul-lantern reset: 2.2m refill + hook (game.js adds
           * 35ms hit-stop, shockwave ring, bell chord) --- */
          for (k = 0; k < lanterns.length; k++) {
            var L = lanterns[k];
            if (L.cd > 0) continue;
            if (dashUsed === false && canDouble === true) break;
            var ldx = x - L.x;
            var ldy = y - L.y;
            if (ldx * ldx + ldy * ldy <= PLAT_LANTERN_R * PLAT_LANTERN_R) {
              dashUsed = false;
              canDouble = true;
              L.cd = PLAT_LANTERN_CD;
              if (api.onReset) api.onReset(L.x, L.y);
            }
          }

          /* --- orbs: pentatonic combo steps --- */
          for (k = 0; k < orbs.length; k++) {
            var O = orbs[k];
            if (O.taken) continue;
            var odx = x - O.x;
            var ody = y - O.y;
            if (odx * odx + ody * ody <= PLAT_ORB_R * PLAT_ORB_R) {
              O.taken = true;
              var idx = orbCount;
              orbCount++;
              if (api.onOrb) api.onOrb(O.x, O.y, idx);
            }
          }

          /* --- hazards: hook with 1s hurt cooldown --- */
          if (hurtCd <= 0 && hazards) {
            for (k = 0; k < hazards.length; k++) {
              var Hz = hazards[k];
              var hr = platNum(Hz.r, 0.4) + 0.25;
              var hdx = x - platNum(Hz.x, 0);
              var hdy = y - platNum(Hz.y, 0);
              if (hdx * hdx + hdy * hdy <= hr * hr) {
                hurtCd = 1.0;
                if (api.onHazard) api.onHazard(Hz.x, Hz.y);
                break;
              }
            }
          }
        }
      };

      return api;
    }
  };
})();
