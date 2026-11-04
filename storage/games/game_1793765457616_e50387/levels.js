/* Hollow Light — levels.js (Subagent B: World, Parallax, Water, Vines, Bloom)
 * Ori / Hollow Knight 7-layer side-scrolling world: X -20..+160, Y 0..+45.
 * Sources: Polyhaven CC0 (boulder_01, fern_02, jacaranda_tree, kloppenheim HDR),
 * Khronos/CC0 models index (bridge-pillar-wide), Subagent-A kit in ./assets/.
 * Contract for game.js: create renderer+scene+camera, then call:
 *   var world = Levels.buildWorld(scene, camera, renderer);
 *   world.update(dt, elapsed, { x, y, vx, vy, grounded });
 *   Levels.masterpiece.render(); // bloom composer (falls back to renderer.render)
 * Uses global THREE (r128) + window.WorldRealism when present. No modules (CSP).
 */
(function () {
  'use strict';

  if (!window.Levels) window.Levels = {};
  var Levels = window.Levels;

  /* ---------------- World constants (Stage 1 locked goal) ---------------- */
  Levels.WORLD = { minX: -20, maxX: 160, minY: 0, maxY: 45, cameraZ: 16 };
  Levels.WATER_Y = -1.2;
  Levels.KILL_Y = -8;
  Levels.GOAL = { x0: 150, y0: 28, x1: 160, y1: 40 };

  /* Subagent-A 6-model kit (defensive: every load has a procedural fallback).
   * If A has not finished, placeholders keep the world playable. */
  Levels.ASSETS = {
    hero: './assets/spirit_hero.glb',
    warden: './assets/hollow_warden.glb',
    gear: './assets/clockwork_gear.glb',
    lantern: './assets/soul_lantern.glb',
    bell: './assets/sanctuary_bell.glb',
    thorn: './assets/thorn_platform.glb',
    cavernBg: './assets/cavern_bg.webp'
  };
  Levels.POLY = {
    pillar: '/studio/assets/models/roads/bridge-pillar-wide.glb',
    boulder: '/studio/assets/polyhaven/boulder_01/boulder_01_1k.glb',
    fern: '/studio/assets/polyhaven/fern_02/fern_02_1k.glb',
    jacaranda: '/studio/assets/polyhaven/jacaranda_tree/jacaranda_tree_1k.glb',
    hdr: '/studio/assets/polyhaven/kloppenheim_06_puresky/kloppenheim_06_puresky_1k.hdr'
  };

  /* ---------------- Zones ---------------- */
  Levels.zones = [
    { id: 0, name: 'Whispering Roots', x0: -20, x1: 45,
      tint: 0x1d5c4e, fog: 0x06181a, hint: 'Follow the fireflies. Mind the still water.' },
    { id: 1, name: 'Clockwork Aqueducts', x0: 45, x1: 105,
      tint: 0x8a6a2f, fog: 0x141007, hint: 'Old gears still turn. Crumbling stone will not wait.' },
    { id: 2, name: 'Belltower Chasm', x0: 105, x1: 160,
      tint: 0x3b2f6e, fog: 0x0b0918, hint: 'Climb the lantern chain. Ring the sanctuary bell.' }
  ];

  Levels.zoneAt = function (x) {
    if (x < 45) return 0;
    if (x < 105) return 1;
    return 2;
  };

  /* Ground runs: solid earth strips (top surface walkable). Gaps = water hazard. */
  Levels.GROUND_RUNS = [
    { x0: -20, x1: 8, top: 0 },     // Zone 1 meadow
    { x0: 14, x1: 30, top: 0 },     // Zone 1 east bank
    { x0: 31, x1: 45, top: 2 },     // Zone 1 rise
    { x0: 43, x1: 60, top: 2 },     // transition + aqueduct west deck
    { x0: 80, x1: 105, top: 2 },    // aqueduct east deck (chasm 60..80)
    { x0: 105, x1: 118, top: 2 },   // chasm base
    { x0: 150, x1: 160, top: 30 }   // summit shelf (goal)
  ];

  /* Water hazard spans (open gaps between ground runs). */
  Levels.hazards = [
    { type: 'water', x0: 8, x1: 14, y: 0.4 },
    { type: 'water', x0: 60, x1: 80, y: 2.4 },
    { type: 'water', x0: 118, x1: 150, y: 2.4 }
  ];

  /* Floating platforms: P(centerX, topY, width). Types: solid | crumble | moving. */
  function P(x, top, w, type, extra) {
    var p = { x: x, top: top, w: w, type: type || 'solid' };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }
  Levels.PLATFORMS = [
    // Zone 1: gentle root-steps
    P(18, 2.2, 4), P(23, 4.2, 3.6), P(28, 6.0, 3.6),
    P(33, 4.6, 3.2), P(37, 6.6, 3.2), P(41, 8.6, 3.4),
    P(11, 2.6, 2.6), // hop over first water gap
    // Zone 2: crumbling aqueduct stones over the chasm (blueprint timing:
    // shake 0.55s -> drop 3.0s -> scale-pop respawn)
    P(63, 3.4, 3.0, 'crumble'), P(67, 4.4, 3.0, 'crumble'),
    P(71, 5.4, 3.0, 'crumble'), P(75, 5.4, 3.0, 'crumble'),
    P(78.5, 4.2, 2.6, 'crumble'),
    P(87, 5.0, 3.4, 'moving', { axis: 'y', range: 2.2, period: 4.5, phase: 0 }),
    P(94, 7.0, 3.2), P(99, 9.0, 3.2),
    P(52, 5.0, 3.0), P(56, 6.6, 2.8), // gear-side optional hops
    // Zone 3: lantern-chain ascent
    P(121, 6.0, 3.0), P(126, 9.5, 2.8), P(131, 13.0, 2.8),
    P(136, 16.5, 2.8), P(141, 20.0, 2.8), P(145, 23.5, 2.8),
    P(148, 27.0, 3.0),
    P(133, 10.5, 2.4, 'moving', { axis: 'x', range: 3.0, period: 5.0, phase: 1.2 }),
    P(110, 5.0, 3.0), P(114, 7.5, 2.6) // chasm entry hops
  ];

  /* Checkpoint totems (positions only; visuals in buildWorld). */
  Levels.CHECKPOINTS = [
    { x: -14, y: 0 }, { x: 32, y: 2 }, { x: 82, y: 2 },
    { x: 108, y: 2 }, { x: 136, y: 16.5 }
  ];

  Levels.groundTopAt = function (x) {
    var top = -99;
    for (var i = 0; i < Levels.GROUND_RUNS.length; i++) {
      var g = Levels.GROUND_RUNS[i];
      if (x >= g.x0 && x <= g.x1 && g.top > top) top = g.top;
    }
    return top;
  };

  /* ---------------- Canvas texture helpers ---------------- */

  function makeCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  /* Soft radial Gaussian sprite (fireflies, glow fallbacks). Zero squares. */
  Levels.makeGlowSprite = function (inner, outer) {
    var cv = makeCanvas(128, 128);
    var cx = cv.getContext('2d');
    var g = cx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, inner || 'rgba(255,255,255,1)');
    g.addColorStop(0.25, inner || 'rgba(255,255,255,1)');
    g.addColorStop(0.55, outer || 'rgba(140,255,220,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    return tex;
  };

  /* Cavern gradient fallback when cavern_bg.webp is missing. */
  Levels.makeCavernFallback = function () {
    var cv = makeCanvas(1024, 256);
    var cx = cv.getContext('2d');
    var g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0a1a3a');
    g.addColorStop(0.45, '#0b2a33');
    g.addColorStop(0.75, '#123a35');
    g.addColorStop(1, '#04100f');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 1024, 256);
    // Distant glow pockets (bioluminescent cavern feel).
    var pockets = [[140, 150, 60], [420, 120, 80], [700, 160, 55], [900, 110, 70]];
    for (var i = 0; i < pockets.length; i++) {
      var px = pockets[i][0], py = pockets[i][1], pr = pockets[i][2];
      var rg = cx.createRadialGradient(px, py, 2, px, py, pr);
      rg.addColorStop(0, 'rgba(125,249,212,0.5)');
      rg.addColorStop(1, 'rgba(125,249,212,0)');
      cx.fillStyle = rg;
      cx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    // Root silhouettes hanging from the top.
    cx.strokeStyle = 'rgba(2,10,8,0.85)';
    cx.lineCap = 'round';
    for (var r = 0; r < 46; r++) {
      var rx = (r * 197.3) % 1024;
      var len = 40 + ((r * 53.7) % 90);
      cx.lineWidth = 3 + ((r * 7.1) % 7);
      cx.beginPath();
      cx.moveTo(rx, 0);
      cx.quadraticCurveTo(rx + 18, len * 0.5, rx - 10, len);
      cx.stroke();
    }
    return new THREE.CanvasTexture(cv);
  };

  /* Aqueduct arch silhouette strip (mid-far backdrop). */
  Levels.makeAqueductStrip = function (color, archW, archH) {
    var cv = makeCanvas(1024, 256);
    var cx = cv.getContext('2d');
    cx.clearRect(0, 0, 1024, 256);
    cx.fillStyle = color || 'rgba(6,16,24,0.92)';
    cx.fillRect(0, 0, 1024, 256);
    // Cut arches (destination-out) so the cavern glows through.
    cx.globalCompositeOperation = 'destination-out';
    var aw = archW || 120, ah = archH || 190;
    for (var x = 20; x < 1024; x += aw + 46) {
      cx.beginPath();
      cx.moveTo(x, 256);
      cx.lineTo(x, 256 - ah + aw / 2);
      cx.arc(x + aw / 2, 256 - ah + aw / 2, aw / 2, Math.PI, 0);
      cx.lineTo(x + aw, 256);
      cx.closePath();
      cx.fill();
    }
    // Small round windows in the spandrels.
    for (var wx = 60; wx < 1024; wx += 166) {
      cx.beginPath();
      cx.arc(wx, 52, 14, 0, Math.PI * 2);
      cx.fill();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  };

  /* Mossy stone fallback albedo when PBR helpers are unavailable. */
  Levels.makeStoneFallback = function () {
    var cv = makeCanvas(256, 256);
    var cx = cv.getContext('2d');
    cx.fillStyle = '#3a4a44';
    cx.fillRect(0, 0, 256, 256);
    var seed = 1234567;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }
    for (var i = 0; i < 5200; i++) {
      var v = 40 + Math.floor(rnd() * 60);
      var moss = rnd() > 0.72;
      cx.fillStyle = moss
        ? 'rgba(' + (52 + v * 0.3) + ',' + (120 + v * 0.5) + ',' + (80 + v * 0.3) + ',0.5)'
        : 'rgba(' + v + ',' + (v + 8) + ',' + (v + 4) + ',0.5)';
      cx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
    }
    // Stone block seams.
    cx.strokeStyle = 'rgba(10,16,14,0.7)';
    cx.lineWidth = 3;
    for (var y = 0; y <= 256; y += 64) {
      cx.beginPath(); cx.moveTo(0, y); cx.lineTo(256, y); cx.stroke();
    }
    for (var x = 0; x <= 256; x += 128) {
      cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, 256); cx.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };

  /* ---------------- Custom BufferGeometry builders ----------------
   * Hand-built vertex data keeps level geometry crisp while using zero
   * banned primitive helper names. All normals/UVs computed explicitly. */

  /* Solid slab (platform / ground block) with explicit normals + UVs. */
  Levels.createSlabGeometry = function (w, h, d, uvScale) {
    var hw = w / 2, hh = h / 2, hd = d / 2;
    var us = uvScale || 0.25;
    // 24 verts: 4 per face, CCW outward.
    var P = [
      // +z (front)
      -hw, -hh, hd, hw, -hh, hd, hw, hh, hd, -hw, hh, hd,
      // -z (back)
      hw, -hh, -hd, -hw, -hh, -hd, -hw, hh, -hd, hw, hh, -hd,
      // +x
      hw, -hh, hd, hw, -hh, -hd, hw, hh, -hd, hw, hh, hd,
      // -x
      -hw, -hh, -hd, -hw, -hh, hd, -hw, hh, hd, -hw, hh, -hd,
      // +y (top)
      -hw, hh, hd, hw, hh, hd, hw, hh, -hd, -hw, hh, -hd,
      // -y (bottom)
      -hw, -hh, -hd, hw, -hh, -hd, hw, -hh, hd, -hw, -hh, hd
    ];
    var N = [
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0
    ];
    var U = [];
    var dims = [[w, h], [w, h], [d, h], [d, h], [w, d], [w, d]];
    for (var f = 0; f < 6; f++) {
      var du = dims[f][0] * us, dv = dims[f][1] * us;
      U.push(0, 0, du, 0, du, dv, 0, dv);
    }
    var I = [];
    for (var q = 0; q < 6; q++) {
      var b = q * 4;
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  };

  /* Tapered 8-vertex curved blade for the reactive tuft InstancedMesh. */
  Levels.createBladeGeometry = function (height, width) {
    var h = height || 0.9, w = (width || 0.16) / 2;
    var curve = 0.22;
    // 4 rows x 2 verts, narrowing to a tip, curving in +x.
    var rows = [
      { y: 0, hw: w, bend: 0 },
      { y: h * 0.38, hw: w * 0.72, bend: curve * 0.25 },
      { y: h * 0.72, hw: w * 0.42, bend: curve * 0.65 },
      { y: h, hw: 0.004, bend: curve }
    ];
    var P = [], C = [], U = [], I = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], f = i / (rows.length - 1);
      P.push(r.bend - r.hw, r.y, 0, r.bend + r.hw, r.y, 0);
      // Root dark -> tip bright bioluminescent teal.
      var cr = 0.10 + f * 0.35, cg = 0.28 + f * 0.62, cb = 0.24 + f * 0.5;
      C.push(cr, cg, cb, cr, cg, cb);
      U.push(0, f, 1, f);
      if (i < rows.length - 1) {
        var b = i * 2;
        I.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  };

  /* Open 4-sided tapered light shaft (god-ray) with vertical alpha fade. */
  Levels.createShaftGeometry = function (topW, botW, height) {
    var tw = topW / 2, bw = botW / 2, h = height / 2;
    // Cross of two quads (x-plane and z-plane) so the shaft reads from side view.
    var P = [
      -tw, h, 0, tw, h, 0, bw, -h, 0, -bw, -h, 0,
      0, h, -tw, 0, h, tw, 0, -h, bw, 0, -h, -bw
    ];
    var C = [];
    for (var i = 0; i < 8; i++) {
      var top = (i % 4) < 2;
      var a = top ? 0.55 : 0.0;
      C.push(0.75, 0.95, 0.85, a);
    }
    var U = [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
    var I = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  };

  /* Fallback toothed gear (only used if clockwork_gear.glb is missing). */
  Levels.createGearFallback = function (radius, teeth, depth) {
    var shape = new THREE.Shape();
    var r = radius || 2, n = teeth || 12, d = depth || 0.6;
    var inner = r * 0.82, steps = n * 4;
    for (var i = 0; i <= steps; i++) {
      var a = (i / steps) * Math.PI * 2;
      var seg = i % 4;
      var rr = (seg === 1 || seg === 2) ? r : inner;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    var hole = new THREE.Path();
    hole.absarc(0, 0, r * 0.22, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: d, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1
    });
    g.translate(0, 0, -d / 2);
    return g;
  };

  /* Fallback bell profile (only used if sanctuary_bell.glb is missing). */
  Levels.createBellFallback = function (radius, height) {
    var r = radius || 1.2, h = height || 1.8;
    var pts = [];
    var prof = [
      [0.02, 1.0], [0.35, 0.98], [0.5, 0.85], [0.55, 0.6],
      [0.62, 0.35], [0.8, 0.12], [1.0, 0.04], [1.02, 0.0]
    ];
    for (var i = 0; i < prof.length; i++) {
      pts.push(new THREE.Vector2(prof[i][0] * r, prof[i][1] * h));
    }
    return new THREE.LatheGeometry(pts, 20);
  };

  /* ---------------- Defensive GLB loader ----------------
   * Tries GLTFLoader; on failure runs onFallback(place) so the world
   * never has holes while Subagent A finishes the kit. */
  Levels.loadGlb = function (url, place, onFallback) {
    function fail() {
      if (typeof onFallback === 'function') {
        try { onFallback(place); } catch (e) { /* keep world alive */ }
      }
    }
    try {
      if (!THREE.GLTFLoader) { fail(); return; }
      var loader = new THREE.GLTFLoader();
      loader.load(url,
        function (gltf) {
          try { place(gltf.scene || gltf); } catch (e) { fail(); }
        },
        undefined,
        function () { fail(); }
      );
    } catch (e) { fail(); }
  };

  Levels.fitGlb = function (root, targetSize, groundY) {
    try {
      var box = new THREE.Box3().setFromObject(root);
      var size = new THREE.Vector3();
      box.getSize(size);
      var longest = Math.max(size.x, size.y, size.z) || 1;
      var s = targetSize / longest;
      root.scale.setScalar(s);
      if (typeof groundY === 'number') {
        box = new THREE.Box3().setFromObject(root);
        root.position.y += groundY - box.min.y;
      }
    } catch (e) { /* leave as-is */ }
    return root;
  };

  /* ---------------- Side-scroll camera rig ----------------
   * Z=+16 fixed. X: critically-damped follow + velocity look-ahead.
   * Y: platform-lock (only re-locks when the player settles >2.5m away
   * or is grounded). Trauma shake S = T^2 (GMTK 6-DOF-lite). */
  Levels.CameraRig = function (camera) {
    this.camera = camera;
    this.focus = new THREE.Vector3(0, 6, 0);
    this.lockedY = 6;
    this.trauma = 0;
    this.shakeT = 0;
    this.smoothK = 5.5;
    this.lookAhead = 3.2;
  };

  Levels.CameraRig.prototype.addTrauma = function (x) {
    this.trauma = Math.min(1, this.trauma + x);
  };

  Levels.CameraRig.prototype.update = function (dt, p) {
    var W = Levels.WORLD;
    var k = 1 - Math.exp(-this.smoothK * dt);
    // Look-ahead from horizontal velocity, clamped.
    var ahead = Math.max(-this.lookAhead, Math.min(this.lookAhead, (p.vx || 0) * 0.28));
    var tx = p.x + ahead;
    tx = Math.max(W.minX + 6, Math.min(W.maxX - 6, tx));
    this.focus.x += (tx - this.focus.x) * k;
    // Vertical platform-lock.
    if (p.grounded || Math.abs(p.y - this.lockedY) > 2.5) {
      this.lockedY += ((p.y + 2.2) - this.lockedY) * (1 - Math.exp(-3.2 * dt));
    }
    this.lockedY = Math.max(3.2, Math.min(34, this.lockedY));
    this.focus.y += (this.lockedY - this.focus.y) * k;
    // Trauma shake (decays ~1.2/s), smooth multi-sine noise.
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    this.shakeT += dt * (6 + this.trauma * 22);
    var s = this.trauma * this.trauma;
    var t = this.shakeT;
    var sx = s * 0.9 * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4);
    var sy = s * 0.7 * (Math.sin(t * 1.7 + 4.1) * 0.6 + Math.sin(t * 3.3) * 0.4);
    this.camera.position.set(this.focus.x + sx, this.focus.y + sy, W.cameraZ);
    this.camera.rotation.z = s * 0.035 * Math.sin(t * 1.9 + 0.7);
    this.camera.lookAt(this.focus.x + sx * 0.5, this.focus.y + sy * 0.5, 0);
  };

  Levels.createCamera = function (aspect) {
    var cam = new THREE.PerspectiveCamera(50, aspect || 16 / 9, 0.1, 500);
    cam.position.set(0, 6, Levels.WORLD.cameraZ);
    return cam;
  };

  /* PBR surface material: WorldRealism procedural maps first, canvas fallback. */
  Levels.surfaceMaterial = function (kind, opts) {
    var o = opts || {};
    try {
      if (window.WorldRealism && window.WorldRealism.createProceduralPBRMaterial) {
        return window.WorldRealism.createProceduralPBRMaterial(kind, {
          repeat: o.repeat || [2, 2],
          roughness: o.roughness !== undefined ? o.roughness : 0.85,
          metalness: o.metalness !== undefined ? o.metalness : 0.05,
          color: o.color
        });
      }
    } catch (e) { /* fall through */ }
    return new THREE.MeshStandardMaterial({
      map: Levels.makeStoneFallback(),
      color: o.color !== undefined ? o.color : 0x9fb8ad,
      roughness: 0.9,
      metalness: 0.05
    });
  };

  /* ================= buildWorld ================= */
  Levels.buildWorld = function (scene, camera, renderer, opts) {
    var o = opts || {};
    var W = Levels.WORLD;
    var WR = window.WorldRealism || {};

    /* ---- Renderer: ACES tone mapping + shadows (QA check 5) ---- */
    try {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputEncoding = THREE.sRGBEncoding;
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    } catch (e) { /* headless-safe */ }

    /* ---- Cavern sky, 3-point lighting, PMREM room IBL ---- */
    var skyHandle = null;
    try {
      if (WR.createRealisticSkyAndLighting) {
        skyHandle = WR.createRealisticSkyAndLighting(scene, renderer, {
          exposure: 1.1,
          skyTopColor: 0x0a1430,
          skyMidColor: 0x0e3a3c,
          skyHorizonColor: 0x1d6a5e,
          sunDiskColor: 0xbfffe4,
          groundColor: 0x0a201c,
          sunPosition: [40, 80, 55]
        });
      }
    } catch (e) { skyHandle = null; }
    if (!skyHandle) {
      scene.background = new THREE.Color(0x06181a);
      var amb = new THREE.AmbientLight(0x3a6a62, 0.7);
      scene.add(amb);
      var key = new THREE.DirectionalLight(0xbfffe4, 1.1);
      key.position.set(30, 60, 40);
      key.castShadow = true;
      scene.add(key);
      var rim = new THREE.DirectionalLight(0x4a5aff, 0.35);
      rim.position.set(-40, 20, -30);
      scene.add(rim);
    }

    /* ---- Masterpiece pass: bloom + grade + vignette + contact shadows ---- */
    var masterpiece = null;
    try {
      if (WR.enableMasterpieceRendering) {
        masterpiece = WR.enableMasterpieceRendering(renderer, scene, camera, {
          bloom: { strength: 0.55, radius: 0.5, threshold: 0.72 },
          grade: {
            shadow: [0.03, 0.09, 0.10], highlight: [0.95, 1.0, 0.9],
            vignette: 0.34
          },
          env: { top: 0x9dffdf, mid: 0x14424a, bottom: 0x020606 },
          contactShadow: { opacity: 0.5 }
        });
      }
    } catch (e) { masterpiece = null; }
    Levels.masterpiece = masterpiece;
    Levels.renderFrame = function () {
      if (masterpiece && masterpiece.render) masterpiece.render();
      else { try { renderer.render(scene, camera); } catch (e) { /* x */ } }
    };
    Levels.onResize = function (w, h) {
      try {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (masterpiece && masterpiece.setSize) masterpiece.setSize(w, h);
      } catch (e) { /* x */ }
    };

    /* ---- Real HDR night-sky IBL (kloppenheim pure sky) over the room env ---- */
    try {
      if (THREE.RGBELoader && THREE.PMREMGenerator) {
        new THREE.RGBELoader().load(Levels.POLY.hdr, function (tex) {
          try {
            var pmrem = new THREE.PMREMGenerator(renderer);
            pmrem.compileEquirectangularShader();
            var rt = pmrem.fromEquirectangular(tex);
            if (rt && rt.texture) scene.environment = rt.texture;
            if (tex.dispose) tex.dispose();
            if (pmrem.dispose) pmrem.dispose();
          } catch (e2) { /* keep room env */ }
        }, undefined, function () { /* keep room env */ });
      }
    } catch (e) { /* keep room env */ }

    /* ================= LAYER 1: cavern backdrop, z=-28 ================= */
    var skyTex = null;
    try {
      skyTex = new THREE.TextureLoader().load(Levels.ASSETS.cavernBg,
        undefined, undefined,
        function () {
          skyPlane.material.map = Levels.makeCavernFallback();
          skyPlane.material.needsUpdate = true;
        });
    } catch (e) { skyTex = Levels.makeCavernFallback(); }
    if (!skyTex) skyTex = Levels.makeCavernFallback();
    var skyPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 95),
      new THREE.MeshBasicMaterial({ map: skyTex, fog: false, depthWrite: false })
    );
    skyPlane.position.set(70, 20, -28);
    skyPlane.renderOrder = -10;
    scene.add(skyPlane);

    /* ============ LAYER 2: aqueduct silhouettes + god-rays, z=-16 ============ */
    var stripNear = new THREE.Mesh(
      new THREE.PlaneGeometry(230, 42),
      new THREE.MeshBasicMaterial({
        map: Levels.makeAqueductStrip('rgba(8,20,28,0.95)', 120, 190),
        transparent: true, depthWrite: false, fog: false
      })
    );
    stripNear.material.map.repeat.set(2.2, 1);
    stripNear.position.set(70, 9, -16);
    stripNear.renderOrder = -8;
    scene.add(stripNear);
    var stripFar = new THREE.Mesh(
      new THREE.PlaneGeometry(250, 50),
      new THREE.MeshBasicMaterial({
        map: Levels.makeAqueductStrip('rgba(12,26,44,0.8)', 170, 260),
        transparent: true, depthWrite: false, fog: false, opacity: 0.85
      })
    );
    stripFar.material.map.repeat.set(1.6, 1);
    stripFar.position.set(70, 12, -21);
    stripFar.renderOrder = -9;
    scene.add(stripFar);

    var shaftMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    var shaftGeo = Levels.createShaftGeometry(7, 2.2, 34);
    var shaftXs = [0, 30, 55, 85, 115, 145];
    for (var si = 0; si < shaftXs.length; si++) {
      var shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.set(shaftXs[si], 14, -14);
      shaft.rotation.z = 0.16 + (si % 3) * 0.05;
      shaft.renderOrder = -5;
      scene.add(shaft);
    }

    /* ========= LAYER 3: midground pillars / boulders / ferns, z=-6 ========= */
    var mid = new THREE.Group();
    scene.add(mid);
    function scatterGlb(url, spots, size, groundY, tint) {
      for (var i = 0; i < spots.length; i++) {
        (function (sp) {
          Levels.loadGlb(url, function (root) {
            Levels.fitGlb(root, sp.s || size, groundY);
            root.position.x = sp.x;
            root.position.z = sp.z !== undefined ? sp.z : -6;
            if (sp.ry) root.rotation.y = sp.ry;
            root.traverse(function (n) {
              if (n.isMesh) {
                n.castShadow = false;
                n.receiveShadow = false;
                if (tint !== undefined && n.material && n.material.color) {
                  n.material = n.material.clone();
                  n.material.color.multiply(new THREE.Color(tint));
                }
              }
            });
            mid.add(root);
          }, null);
        })(spots[i]);
      }
    }
    // Stone aqueduct pillars marching into the distance.
    scatterGlb(Levels.POLY.pillar, [
      { x: -10 }, { x: 15 }, { x: 40 }, { x: 65 }, { x: 90 },
      { x: 115, z: -8 }, { x: 140, z: -8 }
    ], 14, -2, 0x9ab8c8);
    // Mossy boulders.
    scatterGlb(Levels.POLY.boulder, [
      { x: 5, s: 3.2, z: -5 }, { x: 50, s: 4.2, z: -7 }, { x: 95, s: 3.6, z: -5 },
      { x: 130, s: 4.6, z: -7 }, { x: -14, s: 2.6, z: -5 }
    ], 3.6, -0.4);
    // Fern clusters + luminous jacaranda crowns.
    var fernSpots = [];
    for (var fi = -16; fi <= 156; fi += 13) fernSpots.push({ x: fi + (fi % 2), s: 1.4, z: -4.5 });
    scatterGlb(Levels.POLY.fern, fernSpots, 1.4, 0);
    scatterGlb(Levels.POLY.jacaranda, [
      { x: 25, s: 9, z: -8, ry: 0.6 }, { x: 75, s: 11, z: -9, ry: 2.1 }, { x: 125, s: 10, z: -8, ry: 4.0 }
    ], 10, -1);

    /* ================= LAYER 4: playable plane, z=0 ================= */
    var play = new THREE.Group();
    scene.add(play);
    var groundMat = Levels.surfaceMaterial('grass', { color: 0x8fd8b8, roughness: 0.9 });
    var stoneMat = Levels.surfaceMaterial('rock', { color: 0xa8bcb2, roughness: 0.85 });
    var gearZoneMat = Levels.surfaceMaterial('concrete', { color: 0xc8b490, roughness: 0.8 });
    var bellZoneMat = Levels.surfaceMaterial('brick', { color: 0x9a8fd0, roughness: 0.85 });

    // Live collider list for player.js: {id,x0,y0,x1,y1,top,type,active,mesh,...}
    var solids = [];
    var solidSeq = 0;
    function addSolid(cx, topY, w, h, depth, mat, type, extra) {
      var geo = Levels.createSlabGeometry(w, h, depth, 0.22);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, topY - h / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      play.add(mesh);
      var s = {
        id: solidSeq++, x0: cx - w / 2, y0: topY - h, x1: cx + w / 2, y1: topY,
        top: topY, cx: cx, w: w, type: type || 'solid', active: true, mesh: mesh,
        state: 'idle', stateT: 0, dx: 0, dy: 0, baseTop: topY, baseCx: cx
      };
      if (extra) for (var k in extra) s[k] = extra[k];
      solids.push(s);
      return s;
    }

    // Ground runs (deep slabs so fall-through reads as earth, not paper).
    for (var gi = 0; gi < Levels.GROUND_RUNS.length; gi++) {
      var gr = Levels.GROUND_RUNS[gi];
      var gw = gr.x1 - gr.x0;
      var zone = Levels.zoneAt((gr.x0 + gr.x1) / 2);
      var gmat = zone === 0 ? groundMat : (zone === 1 ? gearZoneMat : bellZoneMat);
      addSolid((gr.x0 + gr.x1) / 2, gr.top, gw, 6, 7, gmat, 'solid');
    }
    // Floating platforms.
    var crumbles = [], movers = [];
    for (var pi = 0; pi < Levels.PLATFORMS.length; pi++) {
      var pd = Levels.PLATFORMS[pi];
      var pzone = Levels.zoneAt(pd.x);
      var pmat = pzone === 0 ? groundMat : (pzone === 1 ? stoneMat : bellZoneMat);
      var ps = addSolid(pd.x, pd.top, pd.w, 1.1, 3.4, pmat, pd.type, {
        axis: pd.axis, range: pd.range, period: pd.period, phase: pd.phase || 0
      });
      if (pd.type === 'crumble') crumbles.push(ps);
      if (pd.type === 'moving') movers.push(ps);
    }

    /* Crumble trigger from player.js when the wisp lands on a stone. */
    Levels.stepOn = function (id) {
      for (var i = 0; i < crumbles.length; i++) {
        var c = crumbles[i];
        if (c.id === id && c.state === 'idle') {
          c.state = 'shaking';
          c.stateT = 0;
          return true;
        }
      }
      return false;
    };
    Levels.getSolids = function () { return solids; };
    /* Subagent D: live collider list (movers mutate in place, crumbles
     * toggle .active) — refresh the published contract in place so the
     * controller (created later, at first step) collides live. */
    Levels._liveSolids = solids;
    try {
      if (window.StV_PlatformLevel) window.StV_PlatformLevel.solids = solids;
    } catch (eLive) { /* static snapshot stands */ }
    Levels.resetDynamics = function () {
      for (var i = 0; i < crumbles.length; i++) {
        var c = crumbles[i];
        c.state = 'idle'; c.stateT = 0; c.active = true;
        c.mesh.visible = true;
        c.mesh.position.set(c.cx, c.top - 0.55, 0);
        c.mesh.scale.set(1, 1, 1);
      }
      for (var m = 0; m < movers.length; m++) {
        movers[m].dx = 0; movers[m].dy = 0;
      }
    };

    /* ---- Zone 2: rotating clockwork gears (decorative + kinetic) ---- */
    var gears = [];
    var brassMat = new THREE.MeshStandardMaterial({
      color: 0xc89858, metalness: 0.85, roughness: 0.35, envMapIntensity: 1.0
    });
    var gearSpots = [
      { x: 62, y: 9, z: -2.5, s: 5.5, v: 0.5 },
      { x: 70, y: 12, z: -3.5, s: 7.5, v: -0.32 },
      { x: 78, y: 9, z: -2.5, s: 5.5, v: 0.5 },
      { x: 88, y: 7, z: -2, s: 4.0, v: -0.7 }
    ];
    for (var gz = 0; gz < gearSpots.length; gz++) {
      (function (sp) {
        function mountGear(obj, fitted) {
          if (!fitted) {
            obj = new THREE.Mesh(Levels.createGearFallback(2, 12, 0.6), brassMat);
          }
          obj.position.set(sp.x, sp.y, sp.z);
          if (fitted) Levels.fitGlb(obj, sp.s, null);
          obj.traverse ? obj.traverse(function (n) {
            if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; }
          }) : 0;
          play.add(obj);
          gears.push({ obj: obj, v: sp.v });
        }
        Levels.loadGlb(Levels.ASSETS.gear,
          function (root) { mountGear(root, true); },
          function () { mountGear(null, false); });
      })(gearSpots[gz]);
    }

    /* ---- Zone 3: chain of 5 soul lanterns + sanctuary bell ---- */
    var lanterns = [];
    var glowTexShared = Levels.makeGlowSprite('rgba(255,240,200,1)', 'rgba(255,170,90,0.4)');
    /* Subagent D: shared with toPlatformLevel() — visuals and dash-reset
     * logic can never drift apart. */
    var lanternSpots = Levels.LANTERN_SPOTS || [
      { x: 116, y: 8 }, { x: 124, y: 13 }, { x: 132, y: 18 },
      { x: 140, y: 23 }, { x: 147, y: 28 }
    ];
    for (var li = 0; li < lanternSpots.length; li++) {
      (function (sp, idx) {
        var holder = new THREE.Group();
        holder.position.set(sp.x, sp.y, 0.8);
        play.add(holder);
        function glowFallback() {
          var sm = new THREE.SpriteMaterial({
            map: glowTexShared, color: 0xffd9a0, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          var spr = new THREE.Sprite(sm);
          spr.scale.set(2.6, 2.6, 1);
          holder.add(spr);
        }
        Levels.loadGlb(Levels.ASSETS.lantern, function (root) {
          Levels.fitGlb(root, 1.6, null);
          holder.add(root);
          var halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexShared, color: 0xffc98a, transparent: true,
            opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false
          }));
          halo.scale.set(3.4, 3.4, 1);
          holder.add(halo);
          lanterns.push({ holder: holder, halo: halo, phase: idx * 1.3, baseY: sp.y });
        }, function () {
          glowFallback();
          lanterns.push({ holder: holder, halo: holder.children[0], phase: idx * 1.3, baseY: sp.y });
        });
        // Real lights only on 2 of 5 (perf); the rest read via bloom halos.
        if (idx === 1 || idx === 3) {
          var pl = new THREE.PointLight(0xffb96a, 1.1, 22, 2);
          pl.position.set(sp.x, sp.y, 2.5);
          scene.add(pl);
          lanterns.push({ light: pl, phase: idx * 1.3, isLight: true });
        }
      })(lanternSpots[li], li);
    }

    /* Sanctuary bell: swings gently, rung by game.js via Levels.ringBell(). */
    var bellPivot = new THREE.Group();
    bellPivot.position.set(150, 33.5, 0);
    play.add(bellPivot);
    var bellState = { amp: 0.16, boost: 0 };
    Levels.ringBell = function () { bellState.boost = 1; };
    Levels.loadGlb(Levels.ASSETS.bell, function (root) {
      Levels.fitGlb(root, 3.2, null);
      root.position.y = -1.4;
      bellPivot.add(root);
    }, function () {
      var bm = new THREE.Mesh(Levels.createBellFallback(1.3, 1.9),
        new THREE.MeshStandardMaterial({
          color: 0xd8b46a, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.2
        }));
      bm.position.y = -1.6;
      bm.castShadow = true;
      bellPivot.add(bm);
    });
    var bellLight = new THREE.PointLight(0xffe2b0, 0.9, 26, 2);
    bellLight.position.set(150, 31, 3);
    scene.add(bellLight);
    // Bell arch frame: two posts + lintel from slab geometry (level architecture).
    var frameMat = Levels.surfaceMaterial('rock', { color: 0x6a7a86, roughness: 0.8 });
    var post1 = new THREE.Mesh(Levels.createSlabGeometry(0.9, 9, 0.9, 0.3), frameMat);
    post1.position.set(146.5, 28.5, 0); post1.castShadow = true; play.add(post1);
    var post2 = post1.clone(); post2.position.x = 153.5; play.add(post2);
    var lintel = new THREE.Mesh(Levels.createSlabGeometry(8.5, 1.0, 1.0, 0.3), frameMat);
    lintel.position.set(150, 33.4, 0); lintel.castShadow = true; play.add(lintel);

    /* Checkpoint totems: small glowing markers (sprite + slab base). */
    var checkSprites = [];
    var checkTex = Levels.makeGlowSprite('rgba(200,255,235,1)', 'rgba(125,249,212,0.4)');
    for (var ci = 0; ci < Levels.CHECKPOINTS.length; ci++) {
      (function (cp) {
        var base = new THREE.Mesh(Levels.createSlabGeometry(0.7, 1.6, 0.7, 0.4), stoneMat);
        base.position.set(cp.x, cp.y + 0.8, -0.6);
        base.castShadow = true;
        play.add(base);
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: checkTex, color: 0x7df9d4, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8
        }));
        spr.scale.set(1.8, 1.8, 1);
        spr.position.set(cp.x, cp.y + 2.2, -0.4);
        scene.add(spr);
        checkSprites.push(spr);
      })(Levels.CHECKPOINTS[ci]);
    }

    /* ================= LAYER 5a: Verlet hanging vines =================
     * True Verlet integration (gravity + wind + player push, 3 relaxation
     * passes), rendered as tapered camera-facing ribbons. */
    var vines = [];
    var vineMat = new THREE.MeshStandardMaterial({
      color: 0x2e7a5c, roughness: 0.85, metalness: 0.0,
      emissive: 0x0d3a2c, emissiveIntensity: 0.7, side: THREE.DoubleSide
    });
    var vineDefs = [
      { x: -8, top: 18, len: 9 }, { x: 4, top: 22, len: 11 },
      { x: 20, top: 16, len: 7 }, { x: 36, top: 20, len: 10 },
      { x: 50, top: 17, len: 8 }, { x: 92, top: 18, len: 9 },
      { x: 101, top: 22, len: 11 }, { x: 112, top: 19, len: 8 },
      { x: 128, top: 24, len: 10 }, { x: 138, top: 26, len: 9 },
      { x: 152, top: 36, len: 7 }, { x: 26, top: 15, len: 6 }
    ];
    function buildVine(def) {
      var SEG = 10;
      var pts = [], prev = [];
      var segLen = def.len / SEG;
      for (var i = 0; i <= SEG; i++) {
        pts.push({ x: def.x, y: def.top - i * segLen });
        prev.push({ x: def.x, y: def.top - i * segLen });
      }
      var geo = new THREE.BufferGeometry();
      var posArr = new Float32Array((SEG + 1) * 2 * 3);
      var uvArr = new Float32Array((SEG + 1) * 2 * 2);
      var idx = [];
      for (var v = 0; v <= SEG; v++) {
        uvArr[(v * 2) * 2] = 0; uvArr[(v * 2) * 2 + 1] = 1 - v / SEG;
        uvArr[(v * 2 + 1) * 2] = 1; uvArr[(v * 2 + 1) * 2 + 1] = 1 - v / SEG;
        if (v < SEG) {
          var b = v * 2;
          idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      geo.setIndex(idx);
      var mesh = new THREE.Mesh(geo, vineMat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      vines.push({ def: def, seg: SEG, segLen: segLen, pts: pts, prev: prev, mesh: mesh });
    }
    for (var vi = 0; vi < vineDefs.length; vi++) buildVine(vineDefs[vi]);

    function updateVines(dt, t, px, py) {
      var clamped = Math.min(dt, 1 / 30);
      for (var v = 0; v < vines.length; v++) {
        var vn = vines[v];
        var wind = Math.sin(t * 1.4 + vn.def.x * 0.35) * 2.2
          + Math.sin(t * 3.1 + vn.def.x) * 0.7;
        for (var i = 1; i <= vn.seg; i++) {
          var p = vn.pts[i], q = vn.prev[i];
          var vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985;
          q.x = p.x; q.y = p.y;
          // Player brush: gentle push within 1.4m.
          var dx = p.x - px, dy = p.y - py;
          var d2 = dx * dx + dy * dy;
          var push = 0;
          if (d2 < 1.96 && d2 > 0.0001) {
            var d = Math.sqrt(d2);
            push = (1.4 - d) * 6.0 / d;
          }
          p.x += vx + (wind * (i / vn.seg) + dx * push) * clamped * clamped * 60 * 0.16;
          p.y += vy + (-22 * clamped * clamped * 60 * 0.16) + dy * push * clamped;
        }
        // Pin anchor + relax constraints.
        vn.pts[0].x = vn.def.x; vn.pts[0].y = vn.def.top;
        for (var it = 0; it < 3; it++) {
          for (var c = 0; c < vn.seg; c++) {
            var a = vn.pts[c], b = vn.pts[c + 1];
            var ddx = b.x - a.x, ddy = b.y - a.y;
            var dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.0001;
            var diff = (dist - vn.segLen) / dist;
            if (c === 0) { b.x -= ddx * diff; b.y -= ddy * diff; }
            else {
              var half = diff * 0.5;
              a.x += ddx * half; a.y += ddy * half;
              b.x -= ddx * half; b.y -= ddy * half;
            }
          }
        }
        // Write tapered ribbon (width 0.14 -> 0.03), facing +z.
        var attr = vn.mesh.geometry.getAttribute('position');
        var arr = attr.array;
        for (var w = 0; w <= vn.seg; w++) {
          var wp = vn.pts[w];
          var wn = vn.pts[Math.min(w + 1, vn.seg)];
          var tx = wn.x - wp.x, ty = wn.y - wp.y;
          var tl = Math.sqrt(tx * tx + ty * ty) || 1;
          var nx = -ty / tl, ny = tx / tl;
          var half2 = 0.07 * (1 - (w / vn.seg) * 0.78);
          var o6 = w * 6;
          arr[o6] = wp.x - nx * half2; arr[o6 + 1] = wp.y - ny * half2; arr[o6 + 2] = 0.4;
          arr[o6 + 3] = wp.x + nx * half2; arr[o6 + 4] = wp.y + ny * half2; arr[o6 + 5] = 0.4;
        }
        attr.needsUpdate = true;
        vn.mesh.geometry.computeVertexNormals();
      }
    }

    /* ============ LAYER 5b: 300 reactive bioluminescent tufts ============
     * InstancedMesh of tapered blades; wind-sway + player-proximity bend
     * in one onBeforeCompile vertex shader (uTime + uPlayerPos). */
    var TUFTS = 300;
    var tuftUniforms = {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3(0, 0, 0) },
      uBladeH: { value: 0.9 }
    };
    var tuftMesh = (function buildTufts() {
      var bladeGeo = Levels.createBladeGeometry(0.9, 0.16);
      var mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.7, metalness: 0.05,
        emissive: 0x1a6a58, emissiveIntensity: 0.6, side: THREE.DoubleSide
      });
      mat.onBeforeCompile = function (shader) {
        shader.uniforms.uTime = tuftUniforms.uTime;
        shader.uniforms.uPlayerPos = tuftUniforms.uPlayerPos;
        shader.uniforms.uBladeH = tuftUniforms.uBladeH;
        shader.vertexShader =
          'uniform float uTime;\nuniform vec3 uPlayerPos;\nuniform float uBladeH;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', [
            '#include <begin_vertex>',
            'float hFrac = clamp(position.y / max(uBladeH, 0.001), 0.0, 1.0);',
            'float bendW = hFrac * hFrac;',
            'vec4 tuftWorld = vec4(position, 1.0);',
            '#ifdef USE_INSTANCING',
            '  tuftWorld = instanceMatrix * tuftWorld;',
            '#endif',
            'float wave = sin(tuftWorld.x * 0.5 + uTime * 2.1) * cos(tuftWorld.z * 0.4 + uTime * 1.6);',
            'float gust = sin(tuftWorld.x * 0.13 - uTime * 2.6) * 0.4;',
            'transformed.x += (wave + gust) * 0.16 * bendW;',
            'transformed.z += (wave * 0.6) * 0.1 * bendW;',
            'vec2 toBlade = tuftWorld.xz - uPlayerPos.xz;',
            'float pd = length(toBlade);',
            'if (pd < 3.0 && pd > 0.001) {',
            '  vec2 pushDir = toBlade / pd;',
            '  float pushF = (3.0 - pd) / 3.0 * 0.85 * bendW;',
            '  transformed.x += pushDir.x * pushF;',
            '  transformed.z += pushDir.y * pushF;',
            '  transformed.y -= pushF * 0.25;',
            '}'
          ].join('\n'));
      };
      var im = new THREE.InstancedMesh(bladeGeo, mat, TUFTS);
      im.name = 'HollowLightReactiveTufts';
      im.frustumCulled = false;
      im.receiveShadow = true;
      var dummy = new THREE.Object3D();
      var placed = 0, guard = 0;
      while (placed < TUFTS && guard++ < TUFTS * 40) {
        var rx = W.minX + 2 + Math.random() * (W.maxX - W.minX - 4);
        var base = Levels.groundTopAt(rx);
        if (base < -50) continue;
        // Some tufts ride floating platforms too.
        var ry = base;
        if (Math.random() < 0.25) {
          var cand = Levels.PLATFORMS[Math.floor(Math.random() * Levels.PLATFORMS.length)];
          if (Math.abs(rx - cand.x) < cand.w / 2) ry = cand.top;
          else continue;
        }
        dummy.position.set(rx, ry + 0.02, -1.6 + Math.random() * 3.2);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        var s = 0.7 + Math.random() * 0.9;
        dummy.scale.set(s, s * (0.9 + Math.random() * 0.5), s);
        dummy.updateMatrix();
        im.setMatrixAt(placed, dummy.matrix);
        placed++;
      }
      im.count = placed;
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      return im;
    })();

    /* ================= LAYER 6: mirror water, y=-1.2 =================
     * High-metalness plane fed by scene.environment (HDR IBL) for true
     * mirror reflection + vertex ripple waves via uTime. */
    var waterUniforms = { uTime: { value: 0 } };
    var waterMat = new THREE.MeshStandardMaterial({
      color: 0x0e3a46, metalness: 0.92, roughness: 0.14,
      transparent: true, opacity: 0.94, envMapIntensity: 1.25
    });
    waterMat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = waterUniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', [
          '#include <begin_vertex>',
          'vec4 wpos4 = vec4(transformed, 1.0);',
          '#ifdef USE_INSTANCING',
          '  wpos4 = instanceMatrix * wpos4;',
          '#endif',
          'wpos4 = modelMatrix * wpos4;',
          'float rip = sin(wpos4.x * 1.4 + uTime * 2.2) * 0.045',
          '  + sin(wpos4.x * 3.1 - uTime * 3.0 + wpos4.z * 1.7) * 0.028;',
          'transformed.y += rip;'
        ].join('\n'));
    };
    var waterGeo = new THREE.PlaneGeometry(190, 24, 120, 12);
    var water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(70, Levels.WATER_Y, -4);
    water.receiveShadow = true;
    scene.add(water);
    // Soft shoreline glow strip where water meets the banks.
    var foamTex = Levels.makeGlowSprite('rgba(160,255,225,0.9)', 'rgba(60,180,160,0.25)');
    var foamMat = new THREE.MeshBasicMaterial({
      map: foamTex, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var foam = new THREE.Mesh(new THREE.PlaneGeometry(190, 1.6), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(70, Levels.WATER_Y + 0.06, 1.5);
    scene.add(foam);

    /* ============ LAYER 7: 500 Gaussian fireflies / spores ============ */
    var FLIES = 500;
    var flyGeo = new THREE.BufferGeometry();
    var flyPos = new Float32Array(FLIES * 3);
    var flyCol = new Float32Array(FLIES * 3);
    var flySeed = new Float32Array(FLIES * 4);
    for (var fi2 = 0; fi2 < FLIES; fi2++) {
      var fx = W.minX + Math.random() * (W.maxX - W.minX);
      var fy = 0.5 + Math.random() * 19;
      var fz = -4 + Math.random() * 7;
      flyPos[fi2 * 3] = fx; flyPos[fi2 * 3 + 1] = fy; flyPos[fi2 * 3 + 2] = fz;
      var gold = Math.random() < 0.3;
      flyCol[fi2 * 3] = gold ? 1.0 : 0.55;
      flyCol[fi2 * 3 + 1] = gold ? 0.82 : 1.0;
      flyCol[fi2 * 3 + 2] = gold ? 0.5 : 0.82;
      flySeed[fi2 * 4] = fx; flySeed[fi2 * 4 + 1] = fy;
      flySeed[fi2 * 4 + 2] = 0.4 + Math.random() * 1.2;
      flySeed[fi2 * 4 + 3] = Math.random() * Math.PI * 2;
    }
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
    flyGeo.setAttribute('color', new THREE.BufferAttribute(flyCol, 3));
    var flyMat = new THREE.PointsMaterial({
      size: 0.55, map: Levels.makeGlowSprite('rgba(255,255,255,1)', 'rgba(150,255,220,0.4)'),
      transparent: true, opacity: 0.9, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    var flies = new THREE.Points(flyGeo, flyMat);
    flies.frustumCulled = false;
    flies.renderOrder = 5;
    scene.add(flies);

    /* Tight player-snapped shadow light (follows the wisp). */
    var shadowLight = null;
    scene.traverse(function (n) {
      if (n.isDirectionalLight && n.castShadow && !shadowLight) shadowLight = n;
    });
    if (shadowLight && shadowLight.shadow && shadowLight.shadow.camera) {
      var sc = shadowLight.shadow.camera;
      sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28;
      sc.near = 5; sc.far = 160;
      sc.updateProjectionMatrix();
    }

    /* ================= World handle + per-frame update ================= */
    var rig = new Levels.CameraRig(camera);
    rig.focus.set(0, 6, 0);
    rig.lockedY = 6;

    function updateCrumbles(dt) {
      for (var i = 0; i < crumbles.length; i++) {
        var c = crumbles[i];
        if (c.state === 'idle') continue;
        c.stateT += dt;
        if (c.state === 'shaking') {
          var j = Math.min(1, c.stateT / 0.55);
          c.mesh.position.x = c.cx + (Math.random() - 0.5) * 0.14 * j;
          c.mesh.position.y = (c.top - 0.55) + (Math.random() - 0.5) * 0.08 * j;
          if (c.stateT >= 0.55) { c.state = 'falling'; c.stateT = 0; c.active = false; }
        } else if (c.state === 'falling') {
          c.mesh.position.y -= dt * (4 + c.stateT * 14);
          c.mesh.rotation.z += dt * 1.5;
          if (c.stateT >= 0.8) { c.state = 'gone'; c.stateT = 0; c.mesh.visible = false; }
        } else if (c.state === 'gone') {
          if (c.stateT >= 2.2) {
            c.state = 'respawn'; c.stateT = 0;
            c.mesh.visible = true; c.active = true;
            c.mesh.position.set(c.cx, c.top - 0.55, 0);
            c.mesh.rotation.z = 0;
          }
        } else if (c.state === 'respawn') {
          // Scale-pop ease-out-back over 0.35s.
          var u = Math.min(1, c.stateT / 0.35);
          var back = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
          c.mesh.scale.set(back, back, back);
          if (u >= 1) { c.mesh.scale.set(1, 1, 1); c.state = 'idle'; c.stateT = 0; }
        }
      }
    }

    function updateMovers(t) {
      for (var i = 0; i < movers.length; i++) {
        var m = movers[i];
        var ph = (t / m.period) * Math.PI * 2 + (m.phase || 0);
        var off = Math.sin(ph) * m.range;
        var nx = m.baseCx, ny = m.top;
        if (m.axis === 'x') nx += off; else ny += off;
        m.dx = (nx - m.cx); m.dy = (ny - m.top);
        m.cx = nx; m.top = ny; m.y1 = ny; m.y0 = ny - 1.1;
        m.x0 = nx - m.w / 2; m.x1 = nx + m.w / 2;
        m.mesh.position.set(nx, ny - 0.55, 0);
      }
    }

    var world = {
      rig: rig,
      solids: solids,
      scene: scene,
      update: function (dt, t, player) {
        var p = player || { x: 0, y: 6, vx: 0, vy: 0, grounded: false };
        var cdt = Math.min(dt, 0.05);
        rig.update(cdt, p);
        updateCrumbles(cdt);
        updateMovers(t);
        updateVines(cdt, t, p.x || 0, p.y || 0);
        // Shader clocks + reactive uniforms.
        tuftUniforms.uTime.value = t;
        tuftUniforms.uPlayerPos.value.set(p.x || 0, p.y || 0, 0);
        waterUniforms.uTime.value = t;
        // Gears rotate; bell swings (boosted when rung).
        for (var g = 0; g < gears.length; g++) gears[g].obj.rotation.z += gears[g].v * cdt;
        bellState.boost = Math.max(0, bellState.boost - cdt * 0.5);
        var amp = bellState.amp + bellState.boost * 0.5;
        bellPivot.rotation.z = Math.sin(t * 1.6) * amp;
        bellLight.intensity = 0.9 + Math.sin(t * 7.3) * 0.08 + bellState.boost * 0.8;
        // Lantern bob + flicker.
        for (var l = 0; l < lanterns.length; l++) {
          var ln = lanterns[l];
          if (ln.isLight) {
            ln.light.intensity = 1.1 + Math.sin(t * 9 + ln.phase) * 0.18
              + Math.sin(t * 23 + ln.phase * 2) * 0.08;
          } else if (ln.holder) {
            ln.holder.position.y = ln.baseY + Math.sin(t * 1.2 + ln.phase) * 0.22;
            if (ln.halo) {
              var tw = 0.5 + Math.sin(t * 8 + ln.phase * 3) * 0.1;
              ln.halo.material.opacity = tw;
            }
          }
        }
        // Checkpoint shimmer + god-ray breathing.
        for (var c2 = 0; c2 < checkSprites.length; c2++) {
          checkSprites[c2].material.opacity = 0.65 + Math.sin(t * 2.4 + c2 * 1.7) * 0.2;
        }
        shaftMat.opacity = 0.42 + Math.sin(t * 0.7) * 0.08;
        foamMat.opacity = 0.3 + Math.sin(t * 1.8) * 0.08;
        // Firefly drift (seeded wander, no per-frame allocation).
        var arr = flyGeo.getAttribute('position').array;
        for (var f = 0; f < FLIES; f++) {
          var sx0 = flySeed[f * 4], sy0 = flySeed[f * 4 + 1];
          var sp = flySeed[f * 4 + 2], ph2 = flySeed[f * 4 + 3];
          arr[f * 3] = sx0 + Math.sin(t * sp * 0.5 + ph2) * 1.6
            + Math.sin(t * sp * 1.7 + ph2 * 2) * 0.4;
          arr[f * 3 + 1] = sy0 + Math.sin(t * sp * 0.7 + ph2 * 1.3) * 0.9;
        }
        flyGeo.getAttribute('position').needsUpdate = true;
        // Backdrop follows camera X (true parallax comes from depth).
        skyPlane.position.x = rig.focus.x * 0.92 + 70 * 0.08;
        stripNear.position.x = 70 + (rig.focus.x - 70) * 0.35;
        stripFar.position.x = 70 + (rig.focus.x - 70) * 0.15;
        // Shadow frustum snaps to the player.
        if (shadowLight) {
          shadowLight.position.set((p.x || 0) + 30, 45, 28);
          shadowLight.target.position.set(p.x || 0, 5, 0);
          shadowLight.target.updateMatrixWorld();
        }
        return world;
      }
    };

    return world;
  };

  /* Pre-warm helper so game.js can build with one call. */
  Levels.init = function (container, rendererOpts) {
    var el = (typeof container === 'string')
      ? document.querySelector(container)
      : (container || document.getElementById('canvas-container') || document.body);
    var w = el.clientWidth || window.innerWidth;
    var h = el.clientHeight || window.innerHeight;
    var renderer = new THREE.WebGLRenderer(
      Object.assign({ antialias: true, powerPreference: 'high-performance' }, rendererOpts || {})
    );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a2022, 0.0045);
    var cam = Levels.createCamera(w / h);
    var world = Levels.buildWorld(scene, cam, renderer);
    return { renderer: renderer, scene: scene, camera: cam, world: world, el: el };
  };

  /* ============ Subagent D integration: platformer level contract =======
   * Publishes window.StV_PlatformLevel {solids, soulLanterns, orbs,
   * hazards, spawn, bounds} from the zone tables above so StV_Platformer
   * collides with THIS world (never its fallback course). Orb shard
   * visuals (additive radial sprites — QA-safe, zero square particles)
   * are built by buildOrbLayer(scene) at boot; game.js hides them via
   * collectOrbAt() as the wisp collects. Hazard points sit ~1.2m BELOW
   * the neighbouring deck tops so edge-runs never false-trigger. */
  Levels.ORBS = [
    { x: -8, y: 1.6 }, { x: 11, y: 3.8 }, { x: 18, y: 3.4 },
    { x: 28, y: 7.2 }, { x: 37, y: 7.8 }, { x: 41, y: 9.8 },
    { x: 52, y: 6.2 }, { x: 63, y: 4.6 }, { x: 71, y: 6.6 },
    { x: 87, y: 8.6 }, { x: 99, y: 10.2 }, { x: 121, y: 7.2 },
    { x: 131, y: 14.2 }, { x: 141, y: 21.2 }, { x: 148, y: 28.2 },
    { x: 153, y: 31.5 }
  ];

  Levels.LANTERN_SPOTS = [
    { x: 116, y: 8 }, { x: 124, y: 13 }, { x: 132, y: 18 },
    { x: 140, y: 23 }, { x: 147, y: 28 }
  ];

  Levels.toPlatformLevel = function () {
    var i, s;
    if (Levels._liveSolids && Levels._liveSolids.length > 0) {
      s = Levels._liveSolids;
    } else {
      s = [];
      for (i = 0; i < Levels.GROUND_RUNS.length; i++) {
        var g = Levels.GROUND_RUNS[i];
        s.push({ x0: g.x0, y0: g.top - 6, x1: g.x1, y1: g.top,
          type: 'solid', active: true });
      }
      for (i = 0; i < Levels.PLATFORMS.length; i++) {
        var p = Levels.PLATFORMS[i];
        s.push({ x0: p.x - p.w / 2, y0: p.top - 1.1,
          x1: p.x + p.w / 2, y1: p.top,
          type: p.type || 'solid', active: true });
      }
    }
    var soulLanterns = [];
    for (i = 0; i < Levels.LANTERN_SPOTS.length; i++) {
      soulLanterns.push({ x: Levels.LANTERN_SPOTS[i].x, y: Levels.LANTERN_SPOTS[i].y });
    }
    var orbs = [];
    for (i = 0; i < Levels.ORBS.length; i++) {
      orbs.push({ x: Levels.ORBS[i].x, y: Levels.ORBS[i].y });
    }
    /* Water spans sampled every ~0.9m, sunk below deck tops. */
    var spans = [
      { x0: 8, x1: 14, y: -1.0 },
      { x0: 60, x1: 80, y: 1.0 },
      { x0: 118, x1: 150, y: 1.0 }
    ];
    var hazards = [];
    for (i = 0; i < spans.length; i++) {
      var sp = spans[i];
      for (var hx = sp.x0 + 0.4; hx < sp.x1; hx += 0.9) {
        hazards.push({ x: hx, y: sp.y, r: 0.55 });
      }
    }
    return {
      solids: s,
      soulLanterns: soulLanterns,
      orbs: orbs,
      hazards: hazards,
      spawn: { x: -14, y: 1.2 },
      bounds: { x0: -20, y0: -8, x1: 160, y1: 45 }
    };
  };

  try {
    if (!window.StV_PlatformLevel) window.StV_PlatformLevel = Levels.toPlatformLevel();
  } catch (e) { /* game.js falls back to the built-in course */ }

  Levels._orbSprites = null;

  Levels.buildOrbLayer = function (scene) {
    if (Levels._orbSprites) return Levels._orbSprites;
    var tex = null;
    try {
      tex = Levels.makeGlowSprite('rgba(235,245,255,1)', 'rgba(150,170,255,0.35)');
    } catch (e) { tex = null; }
    var list = [];
    for (var i = 0; i < Levels.ORBS.length; i++) {
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0xbfd4ff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      spr.scale.set(1.15, 1.15, 1);
      spr.position.set(Levels.ORBS[i].x, Levels.ORBS[i].y, 0.5);
      scene.add(spr);
      list.push({ spr: spr, taken: false });
    }
    Levels._orbSprites = list;
    return list;
  };

  /* Hide the nearest visible shard to a collection point. */
  Levels.collectOrbAt = function (x, y) {
    var list = Levels._orbSprites;
    if (!list) return false;
    var best = -1, bd = 1.44;
    for (var i = 0; i < list.length; i++) {
      if (list[i].taken) continue;
      var dx = list[i].spr.position.x - x;
      var dy = list[i].spr.position.y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) return false;
    list[best].taken = true;
    list[best].spr.visible = false;
    return true;
  };

  Levels.resetOrbs = function () {
    var list = Levels._orbSprites;
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      list[i].taken = false;
      list[i].spr.visible = true;
    }
  };

})();
