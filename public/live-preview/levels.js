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
  var U_SHAFT = "./assets/moonlight_shaft.glb";
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

    /* ---------- shared 1K PBR materials + unit plane ----------
     * First principles: real ambientCG 1K Color+NormalGL+Roughness maps via
     * THREE.TextureLoader. Albedo JPEGs store gamma-encoded sRGB, so ONLY the
     * albedo gets texture.encoding=sRGBEncoding (GPU decodes to linear for
     * lighting math; without it the grade washes out). Normal/roughness are
     * linear data — tagging them sRGB would corrupt vectors/curves.
     * RepeatWrapping tiles without clamp streaks; anisotropy 8 keeps
     * grazing-angle texels (floor running to the horizon) sharp. Meshes still
     * reuse the one shared unitPlane — zero new geometry of any kind. */
    var unitPlane = new THREE.PlaneGeometry(1, 1);
    var texLoader = new THREE.TextureLoader();
    function pbrTex(set, kind, rx, ry, srgb) {
      var t = texLoader.load("/studio/assets/ambientcg/" + set + "/" +
        set + "_1K-JPG_" + kind + ".jpg");
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = 8;
      if (srgb && THREE.sRGBEncoding !== undefined) { t.encoding = THREE.sRGBEncoding; }
      return t;
    }
    function pbr1k(set, rx, ry, tint, normalScale) {
      var m = new THREE.MeshStandardMaterial({
        map: pbrTex(set, "Color", rx, ry, true),
        normalMap: pbrTex(set, "NormalGL", rx, ry, false),
        roughnessMap: pbrTex(set, "Roughness", rx, ry, false),
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide
      });
      if (m.normalScale) {
        var ns = (typeof normalScale === "number") ? normalScale : 0.9;
        m.normalScale.set(ns, ns);
      }
      if (typeof tint === "number") { m.color.setHex(tint); }
      return m;
    }
    // Convent interior grade: aged damp plaster walls, weathered dark-grey
    // stone on the chapel face, dark wood wainscot below. NO red brick grid
    // anywhere indoors — Bricks075A stays on disk, unused by this level.
    // (Iron/Metal032 stays unused: this stage has no IBL envmap, and bare
    // metal under point lights alone renders near-black. Revisit with PMREM.)
    var wallMatLong = pbr1k("Plaster001", 3, 1, 0x453f36, 0.7);
    var wallMatShort = pbr1k("Plaster001", 2, 1, 0x453f36, 0.7);
    var wallMatStone = pbr1k("Rock035", 3, 1, 0x615f5a, 1.0);
    var floorMat = pbr1k("Tiles074", 8, 6, 0x555049);
    var ceilMat = pbr1k("Plaster001", 4, 3, 0x4a453e, 0.35);
    var doorMat = pbr1k("Wood096", 1, 1, 0x1c130c);
    var trimMat = pbr1k("Wood096", 1, 1, 0x38302a);
    var beamMat = pbr1k("Wood096", 4, 1, 0x4a3a28);
    var skirtMat = pbr1k("WoodFloor051", 4, 1, 0x3a2e22);

    /* ---------- canvas sprite textures (radial falloff, never squares) ------
     * WebGL rasterizes every gl.POINTS particle / sprite texel quad as an
     * axis-aligned SQUARE. A flat-filled map (or no map) = hard ■ edges. A
     * radial Gaussian-falloff alpha map drives corner fragments to alpha 0,
     * so only soft round discs / teardrops survive. alphaTest 0.01 discards
     * the near-zero fringe (no halo bleed, no sort artifacts). */
    function radialSpriteTex(size, stops) {
      var cv = document.createElement("canvas");
      cv.width = cv.height = size;
      var ctx = cv.getContext("2d");
      var grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (var s = 0; s < stops.length; s++) { grad.addColorStop(stops[s][0], stops[s][1]); }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(cv);
    }
    var ashTex = radialSpriteTex(64, [
      [0, "rgba(255,235,205,1)"],
      [0.4, "rgba(180,175,170,0.45)"],
      [1, "rgba(0,0,0,0)"]
    ]);
    var haloTex = radialSpriteTex(64, [
      [0, "rgba(255,170,60,0.9)"],
      [0.5, "rgba(255,120,30,0.25)"],
      [1, "rgba(0,0,0,0)"]
    ]);
    // Flame teardrop: additive-stacked radial blobs, orange base -> amber
    // mid -> pale core -> white-hot tip. Additive faint sprites read as
    // flame because real flame IS emissive gas: bright core, soft falloff,
    // light summed onto the backdrop instead of occluding it.
    function makeFlameTex() {
      var S = 64;
      var cv = document.createElement("canvas");
      cv.width = cv.height = S;
      var ctx = cv.getContext("2d");
      ctx.globalCompositeOperation = "lighter";
      function blob(cx, cy, rx, ry, r, g, b, a) {
        var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + "," + a + ")");
        gr.addColorStop(0.55, "rgba(" + r + "," + g + "," + b + "," + (a * 0.45) + ")");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx, ry);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      blob(32, 44, 15, 14, 255, 110, 25, 0.75);
      blob(32, 37, 10, 13, 255, 180, 70, 0.9);
      blob(32, 31, 6.5, 9.5, 255, 230, 160, 0.95);
      blob(32, 21, 3.5, 7.5, 255, 244, 214, 1.0);
      return new THREE.CanvasTexture(cv);
    }
    var flameTex = makeFlameTex();

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
      // Chapel north face (z=-9): weathered dark-grey stone masonry accent.
      var segMat = (s[0] === 0 && s[3] === -9) ? wallMatStone :
        wallMatFor(s[2] - s[1]);
      addPlane(s[0], s[1], s[2], s[3], 0, WALL_H, segMat);
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

    /* ---------- wood wainscot + chair rail + ceiling timber (visual only) --
     * Full-height (1.02m) dark plank wainscot hugs BOTH faces of every wall
     * segment (3.5cm off the face: no z-fight, no colliders, gaps stay open
     * because SEGS does), capped by a chair rail. Timber beams hug the
     * ceiling (soffit at y 3.1 + side cheeks), each spanning inside one room
     * so no beam pierces a wall. Reuses unitPlane. */
    var sk;
    for (sk = 0; sk < SEGS.length; sk++) {
      var g = SEGS[sk];
      addPlane(g[0], g[1], g[2], g[3] + 0.035, 0, 1.02, skirtMat);
      addPlane(g[0], g[1], g[2], g[3] - 0.035, 0, 1.02, skirtMat);
      addPlane(g[0], g[1], g[2], g[3] + 0.03, 1.02, 1.1, trimMat);
      addPlane(g[0], g[1], g[2], g[3] - 0.03, 1.02, 1.1, trimMat);
    }
    addPlane(1, -6, 2, -1 + 0.035, 0, 1.02, skirtMat);
    addPlane(1, -6, 2, -1 - 0.035, 0, 1.02, skirtMat);
    addPlane(1, -6, 2, 1 + 0.035, 0, 1.02, skirtMat);
    addPlane(1, -6, 2, 1 - 0.035, 0, 1.02, skirtMat);
    function addBeamX(x0, x1, z) {
      var soffit = new THREE.Mesh(unitPlane, beamMat);
      soffit.scale.set(x1 - x0, 0.3, 1);
      soffit.rotation.x = Math.PI / 2; // face down like the ceiling plane
      soffit.position.set((x0 + x1) / 2, 3.1, z);
      scene.add(soffit);
      addPlane(0, x0, x1, z - 0.15, 2.95, 3.2, beamMat);
      addPlane(0, x0, x1, z + 0.15, 2.95, 3.2, beamMat);
    }
    addBeamX(-4, 4, 7);        // entrance hall (touches x=+-4 walls)
    addBeamX(-12, 12, -7.5);   // north corridor (clear of divider + D3/D4)
    addBeamX(-9, -1, -2);       // classroom A (ends kiss x=-9/-1 walls)
    addBeamX(1, 9, -2);         // classroom B
    addBeamX(-12, -4, 7);       // south-west store
    addBeamX(4, 12, 7);         // south-east store

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

    /* ---------- gothic windows: split frame + shaft (no colliders: they hug
     * the walls; shafts are light, Agatha/the player walk through them).
     * Frame GLB holds stone+mullions+glass ONLY (x +-1.00, y 0.72->3.82,
     * z +-0.21) — the old baked diagonal shaft is GONE, so no bbox trick
     * can drag the window off the wall. Both load raw (autoGround:false):
     * frame x0.62 at y=0.70 -> sill 1.15 / crown 3.07, flush 10cm inboard
     * of the wall plane; shaft origin (top mount edge, +Z aim) sits at the
     * glass head (y 2.6) and stretches (0.42, 1.1, 1.3): 0.8m wide like
     * the glass, down to the floor and 3m into the room. Shaft aims +Z
     * locally, so ry matches facings. */
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
    // Soft volumetric look: the Blender shaft reads as an opaque white ramp
    // unless tamed at load — faint additive beam, no depth writes. The
    // lightning hook keeps driving emissiveIntensity on top of this.
    function softenShaft(mat) {
      if (!mat) { return; }
      mat.transparent = true;
      mat.opacity = 0.10;
      mat.depthWrite = false;
      mat.blending = THREE.AdditiveBlending;
      mat.needsUpdate = true;
    }
    // Named-node fast path (MoonShaft exists per kit contract) + a
    // material-name sweep fallback. Clones share materials, so dedupe.
    function collectWindowMats(root) {
      var shaft = null;
      try { shaft = root.getObjectByName("MoonShaft"); } catch (eShaft) { shaft = null; }
      if (shaft && shaft.material) { grabUnique(shaft.material, moonMats); softenShaft(shaft.material); }
      try {
        root.traverse(function (o) {
          if (!o || !o.material || typeof o.material.name !== "string") { return; }
          var m = o.material;
          var nm = m.name.toLowerCase();
          if (nm.indexOf("moonshaft") >= 0) { grabUnique(m, moonMats); softenShaft(m); }
          else if (nm.indexOf("glass") >= 0 && nm.indexOf("lantern") < 0) {
            grabUnique(m, glassMats);
            // Night moonlit glass: the authored pale diffuse (0x9eb7cc)
            // blows out baby-blue under the torch. Darken the diffuse,
            // keep a faint blue emissive so panes read moonlit, and sync
            // baseEmissive (the flash hook rewrites intensity per frame).
            m.color.setHex(0x141c26);
            m.emissive.setHex(0x0b1322);
            m.emissiveIntensity = 0.6;
            m.userData.baseEmissive = 0.6;
          }
          else if (nm.indexOf("flame") >= 0) { grabUnique(m, flameMats); }
          else if (nm.indexOf("stone") >= 0 || nm.indexOf("brick") >= 0) {
            // Amplify the authored relief: plaster-tinted stone normals
            // are subtle; x1.6 makes carving read under dim torch light.
            if (m.normalScale) { m.normalScale.set(1.6, 1.6); }
            // Brick factors were authored near-white for a linear
            // pipeline, so they wash out under sRGB output — pull to a
            // mid weathered grade (flagged: materials are shared clones).
            if (nm.indexOf("brick") >= 0 && !m.userData.stvBrickGrade) {
              m.color.multiplyScalar(0.5);
              m.userData.stvBrickGrade = true;
            }
          }
        });
      } catch (eTrav) { /* keep whatever the named node gave us */ }
    }
    // x, z, ry — frame origins 10cm inboard of the wall planes.
    var KIT_WINDOWS = [
      [-6, -8.90, 0], [6, -8.90, 0],                 // N wall
      [-8, 8.90, Math.PI], [8, 8.90, Math.PI],       // S wall
      [-11.90, -2, Math.PI / 2], [-11.90, 3.5, Math.PI / 2],   // W wall
      [11.90, -2, -Math.PI / 2], [11.90, 3.5, -Math.PI / 2]    // E wall
    ];
    var WIN_Y = 0.70, WIN_SC = 0.62;      // sill 1.15, crown 3.07
    var SHAFT_Y = 2.6, SHAFT_IN = 0.13;   // glass head + frame front face
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

    /* ---------- lantern flames: soft sprites + halo + flicker ----------
     * Core = additive teardrop THREE.Sprite (always camera-facing, no hard
     * plane edges from any angle) + a larger faint halo glow sprite.
     * Registry contract unchanged: { mat, light, base, phase } drives the
     * update loop; sprite entries add { sprite, halo } for stretch/breathe.
     * Altar entries (mat:null -> shared ConventFlame) keep the emissive path. */
    var flickers = [];
    var FLAME_W = 0.34, FLAME_H = 0.5, HALO_S = 1.1, HALO_A = 0.55;
    function addFlame(x, y, z, light, base) {
      var coreMat = new THREE.SpriteMaterial({
        map: flameTex, color: 0xffc37a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var core = new THREE.Sprite(coreMat);
      core.scale.set(FLAME_W, FLAME_H, 1);
      core.position.set(x, y, z);
      scene.add(core);
      var haloMat = new THREE.SpriteMaterial({
        map: haloTex, color: 0xff9a3c, transparent: true, opacity: HALO_A,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var halo = new THREE.Sprite(haloMat);
      halo.scale.set(HALO_S, HALO_S, 1);
      halo.position.set(x, y, z);
      scene.add(halo);
      flickers.push({
        mat: coreMat, light: light, base: base, phase: x * 2.1 + z * 1.3,
        sprite: core, halo: halo
      });
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
    function loadWithCatch(url, ok, fail, len, raw) {
      try {
        if (!WR || typeof WR.loadGlbModel !== "function") { fail(new Error("no loader")); return; }
        // raw: autoGround:false — no bbox normalize, GLB author coords used
        // verbatim (windows/shafts mount at exact wall transforms instead).
        var lo = raw ? { autoGround: false, onError: fail }
                     : { targetLength: len, onError: fail };
        var pr = WR.loadGlbModel(url, ok, lo);
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
        if (def.sxyz) { root.scale.set(def.sxyz[0], def.sxyz[1], def.sxyz[2]); }
        else if (typeof def.sc === "number") { root.scale.multiplyScalar(def.sc); }
        root.rotation.y = def.ry || 0;
        if (def.lean) { root.rotation.z = def.lean; }
        if (def.glow) { lightLanternGlass(root); }
        if (def.onRoot) { try { def.onRoot(root); } catch (eHook) { /* cosmetic */ } }
        scene.add(root);
      }, function () {
        if (def.noFb) { return; } // shafts are light: silent when missing
        var fb = makeImpostor(def.fb[0], def.fb[1], def.fb[2]);
        fb.position.set(def.x, def.y + def.fb[1] / 2, def.z);
        fb.rotation.y = def.ry || 0;
        scene.add(fb);
      }, def.len, def.raw);
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

    /* ------ gothic kit: windows + separate moonlight shafts (flash hook) ----- */
    for (i = 0; i < KIT_WINDOWS.length; i++) {
      (function (wx, wz, wry) {
        placeProp({
          url: U_WINDOW, x: wx, y: WIN_Y, z: wz, ry: wry,
          raw: true, sc: WIN_SC, fb: WINDOW_FB, onRoot: collectWindowMats
        });
        // Shaft origin mounts at the glass head, inboard of the frame face.
        var sdx = Math.sin(wry), sdz = Math.cos(wry);
        placeProp({
          url: U_SHAFT, x: wx + sdx * SHAFT_IN, y: SHAFT_Y,
          z: wz + sdz * SHAFT_IN, ry: wry,
          raw: true, sxyz: [0.42, 1.1, 1.3],
          noFb: true, onRoot: collectWindowMats
        });
      })(KIT_WINDOWS[i][0], KIT_WINDOWS[i][1], KIT_WINDOWS[i][2]);
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
        ry: PILLARS[i][2], len: undefined, fb: PILLAR_FB, onRoot: collectWindowMats
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
        len: undefined, hw: 0.47, hd: 0.63, fb: DESK_FB, onRoot: collectWindowMats
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
        len: undefined, hw: FURNS[i][3], hd: FURNS[i][4], fb: FURN_FB,
        onRoot: collectWindowMats
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
    // Per-mote tint: ~80% pale ash flakes, ~20% warm embers. Multiplied by
    // the radial map, so every mote is a soft round disc — zero ■ squares.
    var ashCol = new Float32Array(ASH_N * 3);
    for (i = 0; i < ASH_N; i++) {
      if (Math.random() < 0.2) {
        ashCol[i * 3] = 1.0; ashCol[i * 3 + 1] = 0.52; ashCol[i * 3 + 2] = 0.2;
      } else {
        var g = 0.62 + Math.random() * 0.2;
        ashCol[i * 3] = g * 0.92; ashCol[i * 3 + 1] = g * 0.96; ashCol[i * 3 + 2] = g;
      }
    }
    ashGeo.setAttribute("color", new THREE.BufferAttribute(ashCol, 3));
    var ashMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.05, sizeAttenuation: true, map: ashTex,
      vertexColors: true, transparent: true, opacity: 0.55,
      alphaTest: 0.01, blending: THREE.AdditiveBlending, depthWrite: false
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
          if (fl.sprite) {
            // Sprite flame: vertical stretch + counter-squeeze + halo
            // breathe. Same noise n drives the light below, so core, halo,
            // and lantern light stay in sync like one flame.
            fl.sprite.scale.set(FLAME_W * (1 - n * 0.08), FLAME_H * (1 + n * 0.18), 1);
            if (fl.halo) { fl.halo.material.opacity = HALO_A * (1 + n * 0.22); }
          } else {
            var base = (fl.mat.userData && typeof fl.mat.userData.baseEmissive === "number") ?
              fl.mat.userData.baseEmissive : 1.5;
            // Lantern flames pulse around 1.5; altar flames around their own
            // glTF base (1.0) so the emissive amber never blows out.
            var span = (base > 1.2) ? 0.45 : 0.25;
            fl.mat.emissiveIntensity = base + n * span;
          }
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
