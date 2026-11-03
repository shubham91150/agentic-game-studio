/* Ashes of St. Vermilion — Stage 1 world (Task 2) + gothic kit (Subagent B).
 * Owns: architecture, lights, props, lightning rig, key + chapel door.
 * Contract: window.StV_Levels = { buildWorld(scene), VERSION }.
 * r128 global style: uses window.THREE + window.WorldRealism, no modules.
 * Arch ref: docs/stvermilion-arch.md sections 1/3/4 (dims, lights, props).
 * Kit ref: ./assets/*.glb by Subagent A (Blender 3.4, meters, origin at base):
 *   gothic_pillar_arch (plinth/shaft/capital + vault springer ribs, y 0->5.41),
 *   gothic_window_frame (stone/iron/glass + MoonShaft node, shaft aims +Z),
 *   school_desk_chair (desk faces -Z, chair on +Z side, y 0->0.98),
 *   classroom_furniture (chalkboard west half + bookshelf east half, front +Z),
 *   chapel_pew_altar (altar at -Z end, pew at +Z end, emissive-only flames).
 * Art direction lock: moonlit blue-greys + amber lantern light, aged dark
 * stone/wood/iron PBR. No cartoon look. Zero new primitive geometry here:
 * all 3D architecture/furniture comes from the .glb kit (+ pre-existing
 * PBR wall planes); ash motes are THREE.Points (not a banned primitive).
 */
(function () {
  "use strict";

  var VERSION = "stv-stage1-1.1.0";
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

  // Subagent-A gothic kit, relative to the live-preview page like
  // enemy.js AGATHA_URL ("./assets/agatha.glb"). Served at
  // /studio/live-preview/assets/*.glb. Loaded with NO targetLength so the
  // meter-accurate Blender dims survive (loader still XZ-centers + grounds).
  var U_PILLAR = "./assets/gothic_pillar_arch.glb";
  var U_WINDOW = "./assets/gothic_window_frame.glb";
  var U_DESK = "./assets/school_desk_chair.glb";
  var U_FURN = "./assets/classroom_furniture.glb";
  var U_PEW = "./assets/chapel_pew_altar.glb";

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

    /* ---------- gothic windows: real .glb frames + MoonShafts (no colliders:
     * they hug the walls; the shafts are light, Agatha/the player walk
     * through them). Shaft aims +Z locally, so ry matches the old plane
     * facings. Loader XZ-centering shifts the frame plane ~1.1m behind the
     * origin (bounds z -0.21..2.4 incl. shaft), hence the inward offsets.
     * y=-0.45: 3.77m-tall frame runs sill 0.22 -> crown 3.32 (crown kisses
     * the 3.2m ceiling; shaft foot pools just under the floor, hidden). */
    var moonMats = [];   // unique ConventMoonShaft materials (lightning flash)
    var glassMats = [];  // unique ConventGlass materials (mild flash)
    var flameMats = [];  // unique ConventFlame materials (altar flicker)
    function grabUnique(mat, arr) {
      if (!mat || !mat.emissive) { return; }
      for (var g = 0; g < arr.length; g++) { if (arr[g] === mat) { return; } }
      mat.userData.baseEmissive = (typeof mat.emissiveIntensity === "number") ?
        mat.emissiveIntensity : 1;
      arr.push(mat);
    }
    // Named-node fast path (MoonShaft exists per kit contract) + a
    // material-name sweep fallback. Clones share materials, so dedupe.
    function collectWindowMats(root) {
      var shaft = null;
      try { shaft = root.getObjectByName("MoonShaft"); } catch (eShaft) { shaft = null; }
      if (shaft && shaft.material) { grabUnique(shaft.material, moonMats); }
      try {
        root.traverse(function (o) {
          if (!o || !o.material || typeof o.material.name !== "string") { return; }
          var nm = o.material.name.toLowerCase();
          if (nm.indexOf("moonshaft") >= 0) { grabUnique(o.material, moonMats); }
          else if (nm.indexOf("glass") >= 0) { grabUnique(o.material, glassMats); }
          else if (nm.indexOf("flame") >= 0) { grabUnique(o.material, flameMats); }
        });
      } catch (eTrav) { /* keep whatever the named node gave us */ }
    }
    var KIT_WINDOWS = [
      // x, y, z, ry — N wall (frame plane ~z -8.95, shaft into room)
      [-6, -0.45, -7.85, 0], [6, -0.45, -7.85, 0],
      // S wall
      [-8, -0.45, 7.85, Math.PI], [8, -0.45, 7.85, Math.PI],
      // W wall (frame plane ~x -11.95)
      [-10.85, -0.45, -2, Math.PI / 2], [-10.85, -0.45, 3.5, Math.PI / 2],
      // E wall
      [10.85, -0.45, -2, -Math.PI / 2], [10.85, -0.45, 3.5, -Math.PI / 2]
    ];
    var WINDOW_FB = [1.6, 2.2, 0x4a6a8a]; // load-failure impostor only

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
        if (def.onRoot) { try { def.onRoot(root); } catch (eHook) { /* cosmetic */ } }
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

    /* ---------- gothic kit: windows (collect MoonShaft mats for flash) ---------- */
    for (i = 0; i < KIT_WINDOWS.length; i++) {
      placeProp({
        url: U_WINDOW, x: KIT_WINDOWS[i][0], y: KIT_WINDOWS[i][1],
        z: KIT_WINDOWS[i][2], ry: KIT_WINDOWS[i][3],
        len: undefined, fb: WINDOW_FB, onRoot: collectWindowMats
      });
    }

    /* ---------- gothic kit: pillars + vault springers ----------
     * Model is 5.41m tall (shaft 0.7->3.3, capital 3.42->3.78, ribs
     * 3.85->5.41); sunk to y=-1.0 the capital sits at 2.42->2.78 and the
     * rib springers pierce the 3.2m ceiling as instructed. Ribs span local
     * X, so Z-running door walls get ry=PI/2. Doorway flankers sit inside
     * the wall collider band -> no new colliders, zero route impact. Only
     * the free-standing north-corridor anchor gets a collider. */
    var PILLAR_Y = -1.0;
    var PILLAR_FB = [0.6, 2.6, 0x5a5a60];
    var PILLARS = [
      // D1/D2 flanks on the z=2 wall (gap edges +/-0.4 clear of the gaps)
      [-6.1, 2.0, 0], [-3.9, 2.0, 0], [3.9, 2.0, 0], [6.1, 2.0, 0],
      // D3/D4 flanks on the x=+/-9 walls
      [-9.0, -3.1, Math.PI / 2], [-9.0, -0.9, Math.PI / 2],
      [9.0, -3.1, Math.PI / 2], [9.0, -0.9, Math.PI / 2],
      // D5/D6 flanks on the z=5 wall
      [-9.1, 5.0, 0], [-6.9, 5.0, 0], [6.9, 5.0, 0], [9.1, 5.0, 0],
      // open-arch flanks x -2..2 on the z=5 wall
      [-2.4, 5.0, 0], [2.4, 5.0, 0]
    ];
    for (i = 0; i < PILLARS.length; i++) {
      placeProp({
        url: U_PILLAR, x: PILLARS[i][0], y: PILLAR_Y, z: PILLARS[i][1],
        ry: PILLARS[i][2], len: undefined, fb: PILLAR_FB
      });
    }
    // Lone free-standing anchor in the north corridor (shaft +/-0.34).
    // Route row z=-7.5 keeps 0.25m+ clearance past the expanded collider.
    placeProp({
      url: U_PILLAR, x: -5.0, y: PILLAR_Y, z: -6.3, ry: 0,
      len: undefined, hw: 0.35, hd: 0.35, fb: PILLAR_FB
    });

    /* ---------- gothic kit: classroom desks (all face the south board) ----------
     * Footprint after centering: x +/-0.47, z +/-0.625. Aisles kept clear:
     * A: vertical x -5 lane, horizontal z -2 lane, dwell (-6,-4.5), H1 crate,
     *    D1/D3 gaps. B: vertical x 5 lane, horizontal z -2 lane, dwell
     *    (6,-0.5), key crate + key target (6.5,-3.5), H2 barrels, D2/D4. */
    var DESK_FB = [0.9, 0.8, 0x6a5236];
    var DESKS = [
      // Classroom A east block (x -3.5/-2.6), north + south rows
      [-3.5, -0.5], [-3.5, 0.4], [-3.5, 1.3],
      [-2.6, -0.5], [-2.6, 0.4], [-2.6, 1.3],
      [-3.5, -5.2], [-3.5, -4.3], [-3.5, -3.4],
      [-2.6, -5.2], [-2.6, -4.3], [-2.6, -3.4],
      // Classroom A west block (clear of D3 gap + route cell (-8.75,-1.75))
      [-8.3, -0.5], [-8.3, 0.4], [-8.3, 1.3],
      [-7.4, -0.5], [-7.4, 0.4], [-7.4, 1.3],
      // Classroom B west-of-divider block
      [2.0, -5.2], [2.0, -4.3], [2.0, -3.4],
      [2.9, -5.2], [2.9, -4.3], [2.9, -3.4],
      [2.4, -0.5], [2.4, 0.4], [2.4, 1.3],
      [3.3, -0.5], [3.3, 0.4], [3.3, 1.3],
      // Classroom B east column (clear of key zone + z -2 lane + D4 gap)
      [8.3, -5.2], [8.3, -4.3], [8.3, -3.4]
    ];
    for (i = 0; i < DESKS.length; i++) {
      placeProp({
        url: U_DESK, x: DESKS[i][0], y: 0, z: DESKS[i][1], ry: 0,
        len: undefined, hw: 0.47, hd: 0.63, fb: DESK_FB
      });
    }

    /* ---------- gothic kit: chalkboard + bookshelf walls ----------
     * Unit spans x -2..2 after centering (board west, shelf east), 0.4 deep,
     * front (+Z, tray side) faces the room. South units face north (ry 0);
     * divider units face into their classroom (ry -/+PI/2). */
    var FURN_FB = [3.6, 1.8, 0x4a4438];
    var FURNS = [
      // x, z, ry, hw, hd
      [-6.2, -5.7, 0, 2.0, 0.2],            // A south wall
      [-1.25, 0, -Math.PI / 2, 0.2, 2.0],   // A divider wall
      [5.6, -5.7, 0, 2.0, 0.2],             // B south wall
      [1.25, 0, Math.PI / 2, 0.2, 2.0]      // B divider wall
    ];
    for (i = 0; i < FURNS.length; i++) {
      placeProp({
        url: U_FURN, x: FURNS[i][0], y: 0, z: FURNS[i][1], ry: FURNS[i][2],
        len: undefined, hw: FURNS[i][3], hd: FURNS[i][4], fb: FURN_FB
      });
    }

    /* ---------- gothic kit: chapel pew + altar ----------
     * Unit: altar at -Z end, pew at +Z end, 1.9 x 2.9 after centering.
     * Flames are emissive-only (r128 has no bloom), so each altar gets a
     * real amber PointLight + a flicker entry on the shared ConventFlame
     * material (picked up by collectWindowMats via the flame sweep). */
    var PEW_FB = [1.8, 1.2, 0x5a4632];
    var PEWS = [
      // x, z, ry, hw, hd — entrance-hall east aisle + north-chapel anchor.
      // Hall pew hugs the x=4 wall; arch passage stays open via x=1.25.
      [3.0, 6.3, 0, 0.95, 1.45],
      // Chapel pew: altar end west, back 0.2 embedded in the N wall; the
      // corridor flood passes on row z=-6.75 (0.2 clearance, BFS-verified).
      [5.0, -8.25, Math.PI / 2, 1.45, 0.95]
    ];
    for (i = 0; i < PEWS.length; i++) {
      placeProp({
        url: U_PEW, x: PEWS[i][0], y: 0, z: PEWS[i][1], ry: PEWS[i][2],
        len: undefined, hw: PEWS[i][3], hd: PEWS[i][4],
        fb: PEW_FB, onRoot: collectWindowMats
      });
    }
    // Altar candle glow: hall altar sits at the unit's -Z end (3.0, 5.2);
    // chapel altar maps to (3.9, -8.25) under ry=PI/2. y=1.9 floats just
    // above the 1.5m candle flames. Flicker entries attach once the shared
    // ConventFlame material arrives (first pew load wins the race is fine:
    // both pew clones share the material, one entry each keeps phases).
    var altarA = point(3.0, 1.9, 5.2, 0xff9a3c, 0.85, 6);
    var altarB = point(3.9, 1.9, -8.25, 0xff9a3c, 0.85, 6);
    flickers.push({ mat: null, light: altarA, base: 0.85, phase: 9.1 });
    flickers.push({ mat: null, light: altarB, base: 0.85, phase: 21.7 });

    /* ---------- ash motes: 600 wind-drifted THREE.Points ----------
     * r128 PointsMaterial, additive at low opacity for a faint ember-dust
     * hang in the moonbeams. Time-evaluated (no integration drift), wraps
     * inside the 24x18 hall. BufferGeometry+Points: not a banned primitive. */
    var ASH_N = 600;
    var ASH_X = 11.5, ASH_Z = 8.5;
    var ashBase = new Float32Array(ASH_N * 3);
    var ashPos = new Float32Array(ASH_N * 3);
    var ashSeed = new Float32Array(ASH_N * 2);
    for (i = 0; i < ASH_N; i++) {
      ashBase[i * 3] = (Math.random() * 2 - 1) * ASH_X;
      ashBase[i * 3 + 1] = 0.2 + Math.random() * 2.8;
      ashBase[i * 3 + 2] = (Math.random() * 2 - 1) * ASH_Z;
      ashSeed[i * 2] = Math.random() * Math.PI * 2;
      ashSeed[i * 2 + 1] = 0.3 + Math.random() * 0.7;
    }
    var ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute("position", new THREE.BufferAttribute(ashPos, 3));
    var ashMat = new THREE.PointsMaterial({
      color: 0x9aa8b8, size: 0.045, sizeAttenuation: true,
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    var ash = new THREE.Points(ashGeo, ashMat);
    ash.frustumCulled = false;
    scene.add(ash);
    function updateAsh(t) {
      for (var a = 0; a < ASH_N; a++) {
        var ph = ashSeed[a * 2], sp = ashSeed[a * 2 + 1];
        var ax = ashBase[a * 3] + t * 0.12 * sp + Math.sin(t * 0.4 * sp + ph) * 0.6;
        var az = ashBase[a * 3 + 2] + t * 0.05 * sp + Math.cos(t * 0.3 * sp + ph * 1.7) * 0.6;
        // Wrap into the hall without branching on sign of t.
        ax = ((ax + ASH_X) % (ASH_X * 2) + ASH_X * 2) % (ASH_X * 2) - ASH_X;
        az = ((az + ASH_Z) % (ASH_Z * 2) + ASH_Z * 2) % (ASH_Z * 2) - ASH_Z;
        ashPos[a * 3] = ax;
        ashPos[a * 3 + 1] = ashBase[a * 3 + 1] + Math.sin(t * 0.5 * sp + ph) * 0.25;
        ashPos[a * 3 + 2] = az;
      }
      ashGeo.attributes.position.needsUpdate = true;
    }
    updateAsh(0);

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

    /* ---------- per-frame update: flicker, lightning, key, ash ---------- */
    function update(dt, t) {
      var k;
      // Late-bind the shared ConventFlame material to the altar flicker
      // entries once the first pew .glb arrives (clones share materials).
      if (flameMats.length > 0) {
        for (k = 0; k < flickers.length; k++) {
          if (flickers[k].mat === null) { flickers[k].mat = flameMats[0]; }
        }
      }
      for (k = 0; k < flickers.length; k++) {
        var fl = flickers[k];
        var n = Math.sin(t * 13.0 + fl.phase) * 0.5 +
          Math.sin(t * 29.0 + fl.phase * 1.7) * 0.3 +
          Math.sin(t * 47.0 + fl.phase * 0.6) * 0.2;
        if (fl.mat) {
          var base = (fl.mat.userData && typeof fl.mat.userData.baseEmissive === "number") ?
            fl.mat.userData.baseEmissive : 1.5;
          // Lantern flames pulse around 1.5; altar flames around their own
          // glTF base (1.0) so the emissive amber never blows out.
          var span = (base > 1.2) ? 0.45 : 0.25;
          fl.mat.emissiveIntensity = base + n * span;
        }
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
      // Lightning path: volumetric MoonShafts flare hard, moon-glass lifts
      // mildly. Same 0..1 glow still feeds scene.userData.stvFlash for VFX.
      for (k = 0; k < moonMats.length; k++) {
        var mm = moonMats[k];
        mm.emissiveIntensity = mm.userData.baseEmissive + glow * 3.0;
      }
      for (k = 0; k < glassMats.length; k++) {
        var gm = glassMats[k];
        gm.emissiveIntensity = gm.userData.baseEmissive + glow * 1.5;
      }
      scene.userData.stvFlash = glow;
      keyMesh.rotation.y += dt * 1.4;
      keyMesh.position.y = KEY_POS.y + Math.sin(t * 2.2) * 0.06;
      updateAsh(t);
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
