/* Ashes of St. Vermilion — Stage 1 world (Task 2).
 * Owns: architecture, lights, props, lightning rig, key + chapel door.
 * Contract: window.StV_Levels = { buildWorld(scene), VERSION }.
 * r128 global style: uses window.THREE + window.WorldRealism, no modules.
 * Arch ref: docs/stvermilion-arch.md sections 1/3/4 (dims, lights, props).
 */
(function () {
  "use strict";

  var VERSION = "stv-stage1-1.0.0";
  var WALL_H = 3.2;
  var WALL_T = 0.3;
  var LINTEL_Y0 = 2.3;

  // Serve URLs verbatim (disk public/X -> /studio/X). 8 unique URLs, 24 instances.
  var U_LANTERN = "/studio/assets/polyhaven/Lantern_01/Lantern_01_1k.glb";
  var U_BARREL01 = "/studio/assets/polyhaven/Barrel_01/Barrel_01_1k.glb";
  var U_KEY = "/studio/assets/models/props/key.glb";
  var U_CHEST = "/studio/assets/models/props/chest.glb";
  var U_CRATE = "/studio/assets/models/props/crate.glb";
  var U_BARREL = "/studio/assets/models/props/barrel.glb";
  var U_BOX = "/studio/assets/models/props/box-large.glb";
  var U_LADDER = "/studio/assets/models/props/ladder.glb";

  function buildWorld(scene) {
    var THREE = window.THREE;
    var WR = window.WorldRealism;
    if (!THREE) { throw new Error("StV_Levels needs global THREE (r128)."); }

    var colliders = [];
    var i;

    /* ---------- atmosphere: fog, backdrop, tone mapping ---------- */
    scene.fog = new THREE.FogExp2(0x060a0e, 0.045);
    scene.background = new THREE.Color(0x030507);
    scene.userData = scene.userData || {};
    scene.userData.stvFlash = 0;
    scene.userData.stvToneMapping = THREE.ACESFilmicToneMapping;
    // The renderer is owned by game.js; apply ACES here when reachable so the
    // look is right even if game.js reads scene.userData.stvToneMapping late.
    try {
      var earlyRenderer = (typeof window !== "undefined" &&
        (window.StV_Renderer || window.__stvRenderer)) || null;
      if (earlyRenderer) {
        earlyRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        earlyRenderer.toneMappingExposure = 1.0;
        if (THREE.sRGBEncoding !== undefined && "outputEncoding" in earlyRenderer) {
          earlyRenderer.outputEncoding = THREE.sRGBEncoding;
        }
      }
    } catch (toneErr) { /* renderer not up yet; game.js applies it */ }

    /* ---------- shared PBR materials + unit plane ---------- */
    var unitPlane = new THREE.PlaneGeometry(1, 1);
    function pbr(kind, rx, ry, tint) {
      var m = WR.createProceduralPBRMaterial(kind, { size: 256, repeat: [rx, ry] });
      m.side = THREE.DoubleSide;
      if (typeof tint === "number") { m.color.setHex(tint); }
      return m;
    }
    var wallMatLong = pbr("brick", 6, 1, 0x51463c);
    var wallMatShort = pbr("brick", 2, 1, 0x51463c);
    var floorMat = pbr("concrete", 8, 6, 0x3c3c44);
    var ceilMat = pbr("concrete", 4, 3, 0x2b2b31);
    var doorMat = pbr("brick", 2, 2, 0x4c3520);
    var trimMat = pbr("concrete", 1, 1, 0x3a3a41);

    function addPlane(axis, a, b, c, y0, y1, mat) {
      var len = b - a;
      var m = new THREE.Mesh(unitPlane, mat);
      m.scale.set(len, y1 - y0, 1);
      if (axis === 0) { m.position.set((a + b) / 2, (y0 + y1) / 2, c); }
      else { m.position.set(c, (y0 + y1) / 2, (a + b) / 2); m.rotation.y = Math.PI / 2; }
      m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    function wallMatFor(len) { return len > 8 ? wallMatLong : wallMatShort; }

    /* ---------- floor + ceiling ---------- */
    var floor = new THREE.Mesh(unitPlane, floorMat);
    floor.scale.set(24, 18, 1);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.receiveShadow = true;
    scene.add(floor);
    var ceil = new THREE.Mesh(unitPlane, ceilMat);
    ceil.scale.set(24, 18, 1);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, WALL_H, 0);
    scene.add(ceil);

    /* ---------- walls: [axis, a, b, c] (axis 0: run on X at z=c) ---------- */
    var SEGS = [
      [0, -12, -1.1, -9], [0, 1.1, 12, -9], // N exterior, chapel gap x -1.1..1.1
      [0, -12, 12, 9],                      // S exterior
      [1, -9, 9, -12],                      // W exterior
      [1, -9, 9, 12],                       // E exterior
      [0, -9, 9, -6],                       // z=-6 (W/E corridors stay open)
      [0, -9, -5.7, 2], [0, -4.3, 4.3, 2], [0, 5.7, 9, 2], // z=+2, D1/D2 gaps
      [1, -6, -2.7, -9], [1, -1.3, 2, -9],   // x=-9, D3 gap
      [1, -6, -2.7, 9], [1, -1.3, 2, 9],     // x=+9, D4 gap
      [0, -12, -8.7, 5], [0, -7.3, -2, 5],   // z=+5, D5 / arch / D6 gaps
      [0, 2, 7.3, 5], [0, 8.7, 12, 5],
      [1, 5, 9, -4],                        // x=-4 hall/store
      [1, 5, 9, 4]                          // x=+4 hall/store
    ];
    var ht = WALL_T / 2;
    for (i = 0; i < SEGS.length; i++) {
      var s = SEGS[i];
      addPlane(s[0], s[1], s[2], s[3], 0, WALL_H, wallMatFor(s[2] - s[1]));
      if (s[0] === 0) {
        colliders.push({ x0: s[1], z0: s[3] - ht, x1: s[2], z1: s[3] + ht });
      } else {
        colliders.push({ x0: s[3] - ht, z0: s[1], x1: s[3] + ht, z1: s[2] });
      }
    }
    // Divider block x -1..1, z -6..2: solid collider + visible faces.
    colliders.push({ x0: -1, z0: -6, x1: 1, z1: 2 });
    addPlane(1, -6, 2, -1, 0, WALL_H, wallMatLong);
    addPlane(1, -6, 2, 1, 0, WALL_H, wallMatLong);
    // Chapel door gap stays shut: locked collider.
    colliders.push({ x0: -1.1, z0: -9 - ht, x1: 1.1, z1: -9 + ht });

    /* ---------- lintels over door gaps ---------- */
    var LINTELS = [
      [0, -5.7, -4.3, 2], [0, 4.3, 5.7, 2],   // D1 D2
      [1, -2.7, -1.3, -9], [1, -2.7, -1.3, 9], // D3 D4
      [0, -8.7, -7.3, 5], [0, 7.3, 8.7, 5],   // D5 D6
      [0, -2, 2, 5]                            // open arch
    ];
    for (i = 0; i < LINTELS.length; i++) {
      var L = LINTELS[i];
      addPlane(L[0], L[1], L[2], L[3], LINTEL_Y0, WALL_H, wallMatFor(L[2] - L[1]));
    }

    /* ---------- lights per arch section 3 ---------- */
    scene.add(new THREE.AmbientLight(0x1a2b3a, 0.16));
    scene.add(new THREE.HemisphereLight(0x2a4a5a, 0x0a0805, 0.18));
    function point(x, y, z, color, intensity, dist) {
      var pl = new THREE.PointLight(color, intensity, dist, 2);
      pl.position.set(x, y, z);
      scene.add(pl);
      return pl;
    }
    var P1 = point(0, 2.4, 7, 0xff9a3c, 1.1, 10);
    var P2 = point(-8, 2.4, 3.5, 0xff9a3c, 1.0, 9);
    var P3 = point(0, 2.4, -7.5, 0xff9a3c, 1.1, 10);
    var P4 = point(-5, 2.4, -2, 0xff9a3c, 1.0, 9);
    var P5 = point(0, 2.6, -8.2, 0xff7733, 0.9, 6);
    var bolt = new THREE.DirectionalLight(0xbdd8ff, 0);
    bolt.position.set(20, 30, -10);
    scene.add(bolt);

    /* ---------- broken windows: 8 emissive planes, lit by lightning ---------- */
    var winBase = new THREE.Color(0x8fb8d8);
    var winHot = new THREE.Color(0xeaf6ff);
    var windowMat = new THREE.MeshBasicMaterial({ color: 0x8fb8d8, side: THREE.DoubleSide });
    var WINDOWS = [
      [-6, -8.84, 0], [6, -8.84, 0],
      [-8, 8.84, Math.PI], [8, 8.84, Math.PI]
    ];
    for (i = 0; i < WINDOWS.length; i++) {
      var w = new THREE.Mesh(unitPlane, windowMat);
      w.scale.set(1.3, 1.0, 1);
      w.position.set(WINDOWS[i][0], 1.9, WINDOWS[i][1]);
      w.rotation.y = WINDOWS[i][2];
      scene.add(w);
    }
    var SIDEWIN = [
      [-11.84, -2, Math.PI / 2], [-11.84, 3.5, Math.PI / 2],
      [11.84, -2, -Math.PI / 2], [11.84, 3.5, -Math.PI / 2]
    ];
    for (i = 0; i < SIDEWIN.length; i++) {
      var sw = new THREE.Mesh(unitPlane, windowMat);
      sw.scale.set(1.3, 1.0, 1);
      sw.position.set(SIDEWIN[i][0], 1.9, SIDEWIN[i][1]);
      sw.rotation.y = SIDEWIN[i][2];
      scene.add(sw);
    }

    /* ---------- chapel door (locked teaser) at C=(0,-9) ---------- */
    var chapelDoor = new THREE.Group();
    chapelDoor.position.set(0, 0, -9);
    chapelDoor.userData.locked = true;
    var doorSlab = new THREE.Mesh(unitPlane, doorMat);
    doorSlab.scale.set(2.2, 2.7, 1);
    doorSlab.position.set(0, 1.35, 0.05);
    chapelDoor.add(doorSlab);
    var trimL = new THREE.Mesh(unitPlane, trimMat);
    trimL.scale.set(0.25, 2.9, 1);
    trimL.position.set(-1.225, 1.45, 0.05);
    chapelDoor.add(trimL);
    var trimR = new THREE.Mesh(unitPlane, trimMat);
    trimR.scale.set(0.25, 2.9, 1);
    trimR.position.set(1.225, 1.45, 0.05);
    chapelDoor.add(trimR);
    var trimT = new THREE.Mesh(unitPlane, trimMat);
    trimT.scale.set(2.7, 0.35, 1);
    trimT.position.set(0, 2.875, 0.05);
    chapelDoor.add(trimT);
    var slitMat = new THREE.MeshBasicMaterial({ color: 0x7a9fc0, side: THREE.DoubleSide });
    var slit = new THREE.Mesh(unitPlane, slitMat);
    slit.scale.set(2.0, 0.06, 1);
    slit.position.set(0, 0.04, 0.06);
    chapelDoor.add(slit);
    scene.add(chapelDoor);

    /* ---------- lantern flames: emissive crosses + flicker ---------- */
    var flickers = [];
    function addFlame(x, y, z, light, base) {
      var fm = new THREE.MeshStandardMaterial({
        color: 0x1a0d02, emissive: 0xff9a3c, emissiveIntensity: 1.5,
        roughness: 1, metalness: 0, side: THREE.DoubleSide
      });
      var f1 = new THREE.Mesh(unitPlane, fm);
      f1.scale.set(0.2, 0.28, 1);
      f1.position.set(x, y, z);
      scene.add(f1);
      var f2 = new THREE.Mesh(unitPlane, fm);
      f2.scale.set(0.2, 0.28, 1);
      f2.position.set(x, y, z);
      f2.rotation.y = Math.PI / 2;
      scene.add(f2);
      flickers.push({ mat: fm, light: light, base: base, phase: x * 2.1 + z * 1.3 });
    }
    addFlame(0, 2.42, 7, P1, 1.1);
    addFlame(-8, 2.42, 3.5, P2, 1.0);
    addFlame(0, 2.42, -7.5, P3, 1.1);
    addFlame(-5, 2.42, -2, P4, 1.0);
    addFlame(0, 2.6, -8.6, P5, 0.9);
    // L6 in Class B stays unlit: dark key hunt, no flame, no light.

    /* ---------- prop loading with plane-cross fallbacks ---------- */
    function makeImpostor(wid, hei, color) {
      var g = new THREE.Group();
      var m = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
      var p1 = new THREE.Mesh(unitPlane, m);
      p1.scale.set(wid, hei, 1);
      g.add(p1);
      var p2 = new THREE.Mesh(unitPlane, m);
      p2.scale.set(wid, hei, 1);
      p2.rotation.y = Math.PI / 2;
      g.add(p2);
      return g;
    }
    function loadWithCatch(url, ok, fail, len) {
      try {
        if (!WR || typeof WR.loadGlbModel !== "function") { fail(new Error("no loader")); return; }
        var pr = WR.loadGlbModel(url, ok, { targetLength: len, onError: fail });
        if (pr && typeof pr.catch === "function") {
          pr.catch(function () { /* handled through onError */ });
        }
      } catch (eLoad) { fail(eLoad); }
    }
    /* Lit lanterns glow through their glass (verified mat name
     * "Lantern_01_glass"); L6 passes glow:false to stay dark. */
    function lightLanternGlass(root) {
      try {
        root.traverse(function (o) {
          var m = o && o.material;
          if (m && m.emissive && typeof m.name === "string" &&
              m.name.toLowerCase().indexOf("glass") >= 0) {
            m.emissive.setHex(0xffa63e);
            m.emissiveIntensity = 1.6;
          }
        });
      } catch (eGlow) { /* model variant without named glass */ }
    }
    function placeProp(def) {
      if (def.hw) {
        colliders.push({
          x0: def.x - def.hw, z0: def.z - def.hd,
          x1: def.x + def.hw, z1: def.z + def.hd
        });
      }
      loadWithCatch(def.url, function (root) {
        // Keep vendor XZ-centering + grounding offsets, then move to the spot.
        root.position.x += def.x;
        root.position.y += def.y;
        root.position.z += def.z;
        root.rotation.y = def.ry || 0;
        if (def.lean) { root.rotation.z = def.lean; }
        if (def.glow) { lightLanternGlass(root); }
        scene.add(root);
      }, function () {
        var fb = makeImpostor(def.fb[0], def.fb[1], def.fb[2]);
        fb.position.set(def.x, def.y + def.fb[1] / 2, def.z);
        fb.rotation.y = def.ry || 0;
        scene.add(fb);
      }, def.len);
    }

    var LANTERN_FB = [0.34, 0.5, 0xffb14e];
    var LANTERNS = [
      [0, 2.2, 7], [-8, 2.2, 3.5], [0, 2.2, -7.5],
      [-5, 2.2, -2], [0, 2.4, -8.6], [5, 2.2, -2]
    ];
    for (i = 0; i < LANTERNS.length; i++) {
      placeProp({
        url: U_LANTERN, x: LANTERNS[i][0], y: LANTERNS[i][1], z: LANTERNS[i][2],
        len: 0.45, fb: LANTERN_FB, glow: i < 5
      });
    }
    var CHESTS = [[-11.2, 0.5], [-10, 7]]; // C1 nudged W so the 3m hall keeps a 1.6m pass
    for (i = 0; i < CHESTS.length; i++) {
      placeProp({
        url: U_CHEST, x: CHESTS[i][0], y: 0, z: CHESTS[i][1],
        len: 0.95, hw: 0.48, hd: 0.3, fb: [0.8, 0.6, 0x7a5a34]
      });
    }
    // 5 crates: 2-high stack at H1, 1 key-desk under K1, 2 at H5.
    var CRATES = [
      [-7.7, 0, -4.6, true], [-7.7, 0.64, -4.6, false],
      [6.5, 0, -4.5, true], [-3.2, 0, 7.9, true], [-2.5, 0, 8.35, true]
    ];
    for (i = 0; i < CRATES.length; i++) {
      placeProp({
        url: U_CRATE, x: CRATES[i][0], y: CRATES[i][1], z: CRATES[i][2],
        len: 0.62, hw: CRATES[i][3] ? 0.31 : 0, hd: 0.31, fb: [0.55, 0.55, 0x8a6a42]
      });
    }
    var BARRELS = [[7.3, 0.3], [7.8, 0.6], [7.4, 0.9], [-6.2, 7.8], [-5.6, 8.1]];
    for (i = 0; i < BARRELS.length; i++) {
      placeProp({
        url: U_BARREL, x: BARRELS[i][0], y: 0, z: BARRELS[i][1],
        len: 0.68, hw: 0.3, hd: 0.3, fb: [0.5, 0.65, 0x6a4a2a]
      });
    }
    placeProp({
      url: U_BOX, x: 9.7, y: 0, z: 7.0, ry: 0.2,
      len: 1.15, hw: 0.55, hd: 0.55, fb: [1.0, 0.9, 0x9a7a4a]
    });
    placeProp({
      url: U_BOX, x: 10.8, y: 0, z: 6.8, ry: -0.15,
      len: 1.15, hw: 0.55, hd: 0.55, fb: [1.0, 0.9, 0x9a7a4a]
    });
    placeProp({
      url: U_LADDER, x: 11.3, y: 0, z: 5.6, lean: -0.2,
      len: 1.9, hw: 0.3, hd: 0.5, fb: [0.5, 1.7, 0x8a7a5a]
    });
    placeProp({
      url: U_BARREL01, x: -3, y: 0, z: 8.5,
      len: 0.95, hw: 0.45, hd: 0.45, fb: [0.6, 0.9, 0x5a4a3a]
    });
    placeProp({
      url: U_BARREL01, x: 3, y: 0, z: 8.5,
      len: 0.95, hw: 0.45, hd: 0.45, fb: [0.6, 0.9, 0x5a4a3a]
    });

    /* ---------- Chapel Key: sync group, model or fallback child ---------- */
    var KEY_POS = { x: 6.5, y: 0.9, z: -4.5 };
    var keyMesh = new THREE.Group();
    keyMesh.position.set(KEY_POS.x, KEY_POS.y, KEY_POS.z);
    scene.add(keyMesh);
    loadWithCatch(U_KEY, function (root) {
      root.rotation.y = 0.6;
      keyMesh.add(root);
    }, function () {
      keyMesh.add(makeImpostor(0.3, 0.42, 0xffd75e));
    }, 0.35);

    /* ---------- lightning scheduler ---------- */
    var strikeIn = 3.0 + Math.random() * 4.0;
    var strikeT = -1;
    function strikeEnvelope(s) {
      if (s < 0.06) { return 3.0; }
      if (s < 0.14) { return 0.5; }
      if (s < 0.24) { return 2.2; }
      if (s < 0.55) { return 2.2 * (1 - (s - 0.24) / 0.31); }
      return 0;
    }
    function callThunder() {
      try {
        var A = window.StV_Audio;
        if (A && typeof A.thunder === "function") {
          var delay = 300 + Math.random() * 900;
          setTimeout(function () {
            try { A.thunder(); } catch (e2) { /* audio not ready */ }
          }, delay);
        }
      } catch (e3) { /* audio file loads later */ }
    }

    /* ---------- per-frame update: flicker, lightning, key ---------- */
    function update(dt, t) {
      var k;
      for (k = 0; k < flickers.length; k++) {
        var fl = flickers[k];
        var n = Math.sin(t * 13.0 + fl.phase) * 0.5 +
          Math.sin(t * 29.0 + fl.phase * 1.7) * 0.3 +
          Math.sin(t * 47.0 + fl.phase * 0.6) * 0.2;
        fl.mat.emissiveIntensity = 1.5 + n * 0.45;
        fl.light.intensity = fl.base * (1 + n * 0.18);
      }
      var env = 0;
      if (strikeT < 0) {
        strikeIn -= dt;
        if (strikeIn <= 0) {
          strikeT = 0;
          callThunder();
        }
      } else {
        strikeT += dt;
        env = strikeEnvelope(strikeT);
        if (strikeT > 0.6) {
          strikeT = -1;
          strikeIn = 4 + Math.random() * 7;
          env = 0;
        }
      }
      bolt.intensity = env;
      var glow = env / 3;
      if (glow < 0) { glow = 0; } else if (glow > 1) { glow = 1; }
      windowMat.color.copy(winBase).lerp(winHot, glow);
      scene.userData.stvFlash = glow;
      keyMesh.rotation.y += dt * 1.4;
      keyMesh.position.y = KEY_POS.y + Math.sin(t * 2.2) * 0.06;
    }

    return {
      colliders: colliders,
      spawn: { x: 0, z: 8.5, ry: 0 },
      bounds: { x0: -12, z0: -9, x1: 12, z1: 9 },
      update: update,
      keyMesh: keyMesh,
      chapelDoor: chapelDoor
    };
  }

  window.StV_Levels = { buildWorld: buildWorld, VERSION: VERSION };
})();
