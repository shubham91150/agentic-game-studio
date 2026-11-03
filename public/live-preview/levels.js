/* Ashes of St. Vermilion — Stage 1 world (Task 2) + gothic kit (Subagent B)
 * + HN2 photogrammetry swap (world-builder: Poly Haven CC0 furniture).
 * Owns: architecture, lights, props, lightning rig, key + chapel door.
 * Contract: window.StV_Levels = { buildWorld(scene), VERSION }.
 * r128 global style: uses window.THREE + window.WorldRealism, no modules.
 * Arch ref: docs/stvermilion-arch.md sections 1/3/4 (dims, lights, props).
 * Kit ref: ./assets/*.glb by Subagent A (Blender 3.4, meters, origin at base):
 *   gothic_pillar_arch (plinth/shaft/capital + vault springer ribs, y 0->5.41),
 *   gothic_window_frame (stone/iron/glass + MoonShaft node, shaft aims +Z).
 *   (school_desk_chair / classroom_furniture / chapel_pew_altar retired by
 *   the HN2 swap: SchoolDesk+Chair, worn bookshelves, painted benches.)
 * Art direction lock: moonlit blue-greys + amber lantern light, aged dark
 * stone/wood/iron PBR. No cartoon look. Zero new primitive geometry here:
 * all 3D architecture/furniture comes from .glb scans (+ pre-existing
 * PBR wall planes); ash motes are THREE.Points (not a banned primitive).
 * HN2 additions: PMREM IBL (gradient room baked once), grounding contact
 * discs under floor props, window.__stvHideSpots / __stvSearchSpots.
 */
(function () {
  "use strict";

  var VERSION = "stv-stage1-1.2.0";
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
  // /studio/live-preview/assets/ (every model a .glb). Loaded with NO
  // targetLength so the
  // meter-accurate Blender dims survive (loader still XZ-centers + grounds).
  var U_PILLAR = "./assets/gothic_pillar_arch.glb";
  var U_WINDOW = "./assets/gothic_window_frame.glb";
  var U_SHAFT = "./assets/moonlight_shaft.glb";
  // Retired by the HN2 photogrammetry swap (consts kept, zero references).
  var U_DESK = "./assets/school_desk_chair.glb";
  var U_FURN = "./assets/classroom_furniture.glb";
  var U_PEW = "./assets/chapel_pew_altar.glb";

  // HN2 photogrammetry set: CC0 Poly Haven scans, 1K (disk
  // public/assets/polyhaven/<id>/<id>_1k.glb -> /studio/assets/...).
  // loadGlbModel normalizes by targetLength — meter lengths per prop family
  // are chosen at each placeProp call site (see swap table in handoff).
  // Credit: Poly Haven CC0 (one line, per asset rule).
  var U_DESK2 = "/studio/assets/polyhaven/SchoolDesk_01/SchoolDesk_01_1k.glb";
  var U_CHAIR = "/studio/assets/polyhaven/SchoolChair_01/SchoolChair_01_1k.glb";
  var U_SHELF = "/studio/assets/polyhaven/wooden_bookshelf_worn/wooden_bookshelf_worn_1k.glb";
  var U_BOOKS = "/studio/assets/polyhaven/book_encyclopedia_set_01/book_encyclopedia_set_01_1k.glb";
  var U_WARD = "/studio/assets/polyhaven/GothicCabinet_01/GothicCabinet_01_1k.glb";
  var U_DRAWER = "/studio/assets/polyhaven/drawer_cabinet/drawer_cabinet_1k.glb";
  var U_DOOR = "/studio/assets/polyhaven/large_castle_door/large_castle_door_1k.glb";
  var U_BENCH = "/studio/assets/polyhaven/painted_wooden_bench/painted_wooden_bench_1k.glb";
  var U_CANDLE = "/studio/assets/polyhaven/brass_candleholders/brass_candleholders_1k.glb";
  var U_CHAND = "/studio/assets/polyhaven/Chandelier_01/Chandelier_01_1k.glb";
  var U_CHAND2 = "/studio/assets/polyhaven/lantern_chandelier_01/lantern_chandelier_01_1k.glb";
  var U_ROCK = "/studio/assets/polyhaven/Rockingchair_01/Rockingchair_01_1k.glb";
  var U_WHEEL = "/studio/assets/polyhaven/wheelchair_01/wheelchair_01_1k.glb";
  var U_CLOCK = "/studio/assets/polyhaven/vintage_grandfather_clock_01/vintage_grandfather_clock_01_1k.glb";
  var U_FRAME = "/studio/assets/polyhaven/hanging_picture_frame_01/hanging_picture_frame_01_1k.glb";
  var U_TREAS = "/studio/assets/polyhaven/treasure_chest/treasure_chest_1k.glb";
  var U_LAMP = "/studio/assets/polyhaven/vintage_oil_lamp/vintage_oil_lamp_1k.glb";
  var U_TABLE = "/studio/assets/polyhaven/WoodenTable_01/WoodenTable_01_1k.glb";
  var U_COMM = "/studio/assets/polyhaven/GothicCommode_01/GothicCommode_01_1k.glb";

  /* ------ renderer capture for PMREM (eval-time, levels.js only) ------
   * First principles: r128 PMREMGenerator bakes IBL by RENDERING an env
   * scene, so it needs the live WebGLRenderer — but the renderer is owned
   * by game.js and publishes no handle. Deferred scripts eval in document
   * order (this file before game.js), so wrapping the constructor here
   * transparently records the instance before game.js constructs it.
   * Proxy(construct) keeps prototype/instanceof semantics identical;
   * guarded so a missing Proxy (or any failure) just disables IBL. */
  var stvCapturedRenderer = null;
  try {
    var Tcap = (typeof window !== "undefined") ? window.THREE : null;
    if (Tcap && Tcap.WebGLRenderer && !Tcap.WebGLRenderer.__stvWrapped &&
        typeof Proxy === "function" && typeof Reflect !== "undefined") {
      var OrigWGL = Tcap.WebGLRenderer;
      Tcap.WebGLRenderer = new Proxy(OrigWGL, {
        construct: function (target, args) {
          var inst = Reflect.construct(target, args);
          stvCapturedRenderer = inst;
          try { window.__stvRenderer = inst; } catch (ePub) { /* optional */ }
          return inst;
        }
      });
      try { Tcap.WebGLRenderer.__stvWrapped = true; } catch (eMark) { /* optional */ }
    }
  } catch (eWrap) { /* no capture: PMREM block below skips silently */ }

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

    /* ---------- PMREM image-based lighting (HN2) ----------
     * First principles: MeshStandardMaterial PBR reflects its environment;
     * with scene.environment null, varnish/brass/glass have nothing to
     * reflect and read flat black under point lights alone. A tiny
     * procedural gradient ROOM (warm amber ceiling, teal-grey walls,
     * near-black floor + bright lantern/moon proxy quads) baked through
     * r128 PMREMGenerator.fromScene gives every PBR surface cheap IBL
     * fill + soft specular streaks. All PlaneGeometry (zero gate
     * primitives), baked once here before first render; fully guarded. */
    try {
      if (THREE.PMREMGenerator) {
        var pmremRenderer = stvCapturedRenderer ||
          ((typeof window !== "undefined" &&
            (window.StV_Renderer || window.__stvRenderer)) || null);
        if (pmremRenderer) {
          var envScene = new THREE.Scene();
          var envQuad = function (w, h, color, px, py, pz, rx, ry) {
            var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
              new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
            m.position.set(px, py, pz);
            m.rotation.set(rx || 0, ry || 0, 0);
            envScene.add(m);
            return m;
          };
          envQuad(12, 12, 0x6a3d1e, 0, 3, 0, Math.PI / 2, 0);   // ceiling: lantern amber
          envQuad(12, 12, 0x040405, 0, -3, 0, -Math.PI / 2, 0); // floor: light pit
          envQuad(12, 6, 0x1d323b, 0, 0, -6, 0, 0);             // walls: teal-grey stone
          envQuad(12, 6, 0x1d323b, 0, 0, 6, 0, Math.PI);
          envQuad(12, 6, 0x24363e, -6, 0, 0, 0, Math.PI / 2);
          envQuad(12, 6, 0x24363e, 6, 0, 0, 0, -Math.PI / 2);
          envQuad(3, 1.6, 0xffc27a, -3, 1.4, -5.7, 0, 0);       // lantern proxy L
          envQuad(3, 1.6, 0xff9a3c, 3, 1.4, 5.7, 0, Math.PI);   // lantern proxy R
          envQuad(1.6, 3.2, 0xbcd6f0, 5.7, 1.0, 0, 0, -Math.PI / 2); // moon-slit proxy
          var pmrem = new THREE.PMREMGenerator(pmremRenderer);
          var envRT = pmrem.fromScene(envScene, 0.035);
          if (envRT && envRT.texture) { scene.environment = envRT.texture; }
          pmrem.dispose();
          scene.userData.stvEnv = scene.environment ? "pmrem" : "none";
        } else {
          scene.userData.stvEnv = "none";
        }
      }
    } catch (envErr) { scene.userData.stvEnv = "none"; }

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
    // (Iron/Metal032 stays on disk: no iron prop this stage. Bare metal
    // now gets PMREM IBL from the gradient room baked above.)
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
    // Contact-shadow disc (HN2): radial black falloff on the shared
    // unitPlane, laid 5mm above the floor. Pure grounding AO under floor
    // props — transparent, depthWrite off, zero colliders, zero routes.
    var contactTex = radialSpriteTex(128, [
      [0, "rgba(0,0,0,0.55)"],
      [0.6, "rgba(0,0,0,0.28)"],
      [1, "rgba(0,0,0,0)"]
    ]);
    var contactMat = new THREE.MeshBasicMaterial({
      map: contactTex, transparent: true, depthWrite: false
    });
    function addContactShadow(x, z, w, d) {
      var m = new THREE.Mesh(unitPlane, contactMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.005, z);
      m.scale.set(w, d, 1);
      m.renderOrder = 2;
      scene.add(m);
    }
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
    // Shared 1K dark-stone PBR for kit stone/brick: Rock035 maps load
    // once and are stamped onto every ConventStone/Brick material so
    // pillars read as normal-mapped masonry, never flat grey.
    var pbrStoneMaps = null;
    function stoneMaps() {
      if (!pbrStoneMaps) {
        pbrStoneMaps = {
          map: pbrTex("Rock035", "Color", 1, 1, true),
          normalMap: pbrTex("Rock035", "NormalGL", 1, 1, false),
          roughnessMap: pbrTex("Rock035", "Roughness", 1, 1, false)
        };
      }
      return pbrStoneMaps;
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
            // HN2 fix: stamp real 1K Rock035 PBR (dark gothic masonry)
            // over the flat authored tints. Vertex-color soot is kept.
            if (!m.userData.stvPbrStone) {
              try {
                var sm = stoneMaps();
                m.map = sm.map;
                m.normalMap = sm.normalMap;
                m.roughnessMap = sm.roughnessMap;
                m.color.setHex(0x4a4640);
                m.needsUpdate = true;
                m.userData.stvPbrStone = true;
              } catch (eStone) { /* keep authored maps */ }
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
    // HN2: photogrammetry castle-door leaf inside the SAME group (game.js
    // contract intact: doorPos reads group world pos, unlock swings
    // rotation.y, tintDoor finds the MeshBasicMaterial slit below).
    // The locked wall-band collider above is untouched. Fallback slab only
    // materializes if the .glb 404s.
    loadWithCatch(U_DOOR, function (doorRoot) {
      doorRoot.position.set(0, 0, 0.05);
      doorRoot.rotation.y = 0;
      chapelDoor.add(doorRoot);
    }, function () {
      var doorSlab = new THREE.Mesh(unitPlane, doorMat);
      doorSlab.scale.set(2.2, 2.7, 1);
      doorSlab.position.set(0, 1.35, 0.05);
      chapelDoor.add(doorSlab);
    }, 2.6);
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
    /* Weathered convent wood for crates/chests (prop-polish).
     * First principles: a GLB material's .color is a linear multiplier
     * over its albedo map, so stamping dark walnut drags cartoon-orange
     * wood to aged convent timber while keeping grain detail; roughness
     * 0.85 kills the plastic sheen. Runs ONLY on crate/chest roots via
     * onRoot (lantern glass/flames never pass through here); unmapped
     * materials are kept and tinted the same way. Idempotent setHex, so
     * shared clone materials can't double-darken. */
    var WALNUT_HEX = 0x241a10;
    function weatherWood(root) {
      try {
        root.traverse(function (o) {
          var mats = o && o.material;
          if (!mats) { return; }
          if (!mats.length) { mats = [mats]; }
          for (var k = 0; k < mats.length; k++) {
            var m = mats[k];
            if (!m) { continue; }
            var nm = (typeof m.name === "string") ? m.name.toLowerCase() : "";
            if (nm.indexOf("lantern") >= 0 || nm.indexOf("glass") >= 0 ||
                nm.indexOf("flame") >= 0) { continue; }
            if (m.color) { m.color.setHex(WALNUT_HEX); }
            if (typeof m.roughness === "number") { m.roughness = 0.85; }
            m.needsUpdate = true;
          }
        });
      } catch (eWood) { /* cosmetic only */ }
    }
    function placeProp(def) {
      if (def.hw) {
        colliders.push({
          x0: def.x - def.hw, z0: def.z - def.hd,
          x1: def.x + def.hw, z1: def.z + def.hd
        });
      }
      // HN2: visual-only grounding disc (never a collider).
      if (def.shadow) { addContactShadow(def.x, def.z, def.shadow[0], def.shadow[1]); }
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
    // HN2: photogrammetry treasure_chest on the SAME spots with the SAME
    // hw/hd (identical collider rects). No weatherWood: the scan ships
    // graded and a walnut stamp would flatten its PBR.
    for (i = 0; i < CHESTS.length; i++) {
      placeProp({
        url: U_TREAS, x: CHESTS[i][0], y: 0, z: CHESTS[i][1],
        len: 0.9, hw: 0.48, hd: 0.3, fb: [0.8, 0.6, 0x7a5a34],
        shadow: [1.0, 0.65]
      });
    }
    // 5 crates: 2-high stack at H1, 1 key-desk under K1, 2 at H5.
    var CRATES = [
      [-7.7, 0, -4.6, true], [-7.7, 0.64, -4.6, false],
      [6.5, 0, -4.5, true], [-3.2, 0, 7.9, true], [-2.5, 0, 8.35, true]
    ];
    for (i = 0; i < CRATES.length; i++) {
      // Gothic photogrammetry instead of low-poly orange crates (same
      // coords/colliders): commodes everywhere, treasure chest riding
      // on top of the H1 stack. Scans ship graded — no walnut stamp.
      var crateUrl = (i === 1) ? U_TREAS : U_COMM;
      placeProp({
        url: crateUrl, x: CRATES[i][0], y: CRATES[i][1], z: CRATES[i][2],
        len: (i === 1) ? 0.9 : 1.0, hw: CRATES[i][3] ? 0.31 : 0, hd: 0.31,
        fb: [0.55, 0.55, 0x8a6a42],
        shadow: [0.7, 0.7]
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

    /* ------ HN2: photogrammetry school desks + chairs + books (all face
     * the south board). Retires school_desk_chair kit: SchoolDesk_01 sits
     * EXACTLY on the route-verified DESKS center (same hw 0.47 / hd 0.63
     * rect pushed — BFS 36/36 untouched, zero route changes), SchoolChair_01
     * tucks on the +Z side facing the desk (visual only, same rect), and an
     * encyclopedia set rides every 3rd desktop. Aisles kept clear (as before):
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
      (function (dx, dz, k) {
        placeProp({
          url: U_DESK2, x: dx, y: 0, z: dz, ry: 0, len: 1.1,
          hw: 0.47, hd: 0.63, fb: DESK_FB, shadow: [1.0, 1.35]
        });
        placeProp({
          url: U_CHAIR, x: dx, y: 0, z: dz + 0.42, ry: Math.PI, len: 0.9,
          fb: [0.5, 0.8, 0x6a5236]
        });
        if (k % 3 === 0) {
          placeProp({
            url: U_BOOKS, x: dx + 0.22, y: 0.72, z: dz - 0.05, ry: 0.3,
            len: 0.4, fb: [0.3, 0.25, 0x7a2a2a]
          });
        }
      })(DESKS[i][0], DESKS[i][1], i);
    }

    /* ------ HN2: photogrammetry bookshelf walls + encyclopedias -------
     * Retires classroom_furniture kit: 3 worn bookshelves span each 4m FURN
     * unit (south units ry 0 face north; divider units ry -/+PI/2 face into
     * their classroom), one encyclopedia set per unit at mid-shelf on the
     * room face. The CENTER shelf of each unit sits EXACTLY on the FURN
     * center and pushes the SAME hw/hd (identical collider rects). */
    var FURN_FB = [3.6, 1.8, 0x4a4438];
    var FURNS = [
      // x, z, ry, hw, hd
      [-6.2, -5.7, 0, 2.0, 0.2],            // A south wall
      [-1.25, 0, -Math.PI / 2, 0.2, 2.0],   // A divider wall
      [5.6, -5.7, 0, 2.0, 0.2],             // B south wall
      [1.25, 0, Math.PI / 2, 0.2, 2.0]      // B divider wall
    ];
    var SHELF_OFF = [-1.25, 0, 1.25];
    for (i = 0; i < FURNS.length; i++) {
      (function (fx, fz, fry, fhw, fhd) {
        var alongZ = (fhw < fhd); // divider units run along Z
        for (var q = 0; q < SHELF_OFF.length; q++) {
          var sx = alongZ ? fx : fx + SHELF_OFF[q];
          var sz = alongZ ? fz + SHELF_OFF[q] : fz;
          placeProp({
            url: U_SHELF, x: sx, y: 0, z: sz, ry: fry, len: 1.9,
            hw: (q === 1) ? fhw : 0, hd: fhd,
            fb: [0.95, 1.8, 0x4a4438],
            shadow: alongZ ? [0.6, 1.0] : [1.0, 0.6]
          });
        }
        var bx = alongZ ? fx + ((fry > 0) ? 0.15 : -0.15) : fx;
        var bz = alongZ ? fz : fz + 0.15;
        placeProp({
          url: U_BOOKS, x: bx, y: 1.1, z: bz, ry: fry + 0.2,
          len: 0.4, fb: [0.3, 0.25, 0x7a2a2a]
        });
      })(FURNS[i][0], FURNS[i][1], FURNS[i][2], FURNS[i][3], FURNS[i][4]);
    }

    /* ------ HN2: photogrammetry pew benches (retires chapel_pew_altar) --
     * Two painted benches per PEW rect: the FIRST sits EXACTLY on the
     * route-verified center and pushes the SAME hw/hd (identical collider
     * rects); the second fills the rect, visual only. The altar ends become
     * candle nooks (brass pairs + oil lamps below) under the SAME amber
     * PointLights; altar flicker entries stay light-only (no ConventFlame
     * material now that the kit unit is gone — guarded by the mat check). */
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
      (function (px, pz, pry, phw, phd) {
        var deepZ = (phw < phd); // hall rect deeper in Z, chapel rect in X
        // Altar table at the nook end (hall: z-1.1, chapel: x-1.1) pushes
        // the SAME rect collider; ONE bench at center (visual); the old
        // +0.7 offset second bench floated — deleted by design.
        var tx = deepZ ? px : px - 1.1;
        var tz = deepZ ? pz - 1.1 : pz;
        placeProp({
          url: U_TABLE, x: tx, y: 0, z: tz, ry: pry, len: 1.3,
          hw: phw, hd: phd, fb: PEW_FB,
          shadow: deepZ ? [1.4, 0.9] : [0.9, 1.4]
        });
        placeProp({
          url: U_BENCH, x: px, y: 0, z: pz, ry: pry, len: 1.8, fb: PEW_FB,
          shadow: deepZ ? [1.9, 0.7] : [0.7, 1.9]
        });
      })(PEWS[i][0], PEWS[i][1], PEWS[i][2], PEWS[i][3], PEWS[i][4]);
    }
    // Altar candle glow (HN2: now washes the candle nooks): hall nook at
    // (3.0, 5.2), chapel nook at (3.9, -8.25). y=1.9 floats just above the
    // bench candles. Flicker entries stay light-only (mat:null guarded).
    var altarA = point(3.0, 1.9, 5.2, 0xff9a3c, 0.85, 6);
    var altarB = point(3.9, 1.9, -8.25, 0xff9a3c, 0.85, 6);
    flickers.push({ mat: null, light: altarA, base: 0.85, phase: 9.1 });
    flickers.push({ mat: null, light: altarB, base: 0.85, phase: 21.7 });

    /* ---- HN2: chandeliers, bench candles, oil-lamp glow spots ---------
     * Chandeliers hang below the beams (hall / north corridor / south
     * corridor); brass pairs ride the pew benches under the altar glow;
     * oil lamps sit on the floor as glow spots. Zero colliders here. */
    /* Goosebump layer 1 — autonomous living props: rocking chair +
     * swaying chandeliers. Roots collected via onRoot, animated in
     * update() with slow sines (rot.x rock, rot.z sway). */
    var rockers = [];
    var swayers = [];
    function trackRocker(root) { rockers.push({ root: root, ph: rockers.length * 1.7 }); }
    function trackSway(root) { swayers.push({ root: root, ph: swayers.length * 2.3 }); }
    var CHAND_FB = [0.7, 0.6, 0xd8a040];
    placeProp({ url: U_CHAND, x: -2.2, y: 2.45, z: 7.0, len: 0.8, fb: CHAND_FB, onRoot: trackSway });
    placeProp({ url: U_CHAND2, x: 5.5, y: 2.45, z: -7.5, len: 0.8, fb: CHAND_FB, onRoot: trackSway });
    placeProp({ url: U_CHAND, x: 0, y: 2.45, z: 3.5, len: 0.8, fb: CHAND_FB, onRoot: trackSway });
    var CAND_FB = [0.3, 0.3, 0xc89858];
    placeProp({ url: U_CANDLE, x: 2.5, y: 0.46, z: 6.3, ry: 0.2, len: 0.35, fb: CAND_FB });
    placeProp({ url: U_CANDLE, x: 3.5, y: 0.46, z: 6.3, ry: -0.2, len: 0.35, fb: CAND_FB });
    placeProp({ url: U_CANDLE, x: 5.0, y: 0.46, z: -8.7, ry: 0.1, len: 0.35, fb: CAND_FB });
    placeProp({ url: U_CANDLE, x: 5.0, y: 0.46, z: -7.8, ry: -0.1, len: 0.35, fb: CAND_FB });
    var LAMP_FB = [0.25, 0.3, 0xffc06a];
    placeProp({ url: U_LAMP, x: 2.5, y: 0, z: 5.2, len: 0.3, fb: LAMP_FB, shadow: [0.35, 0.35] });
    placeProp({ url: U_LAMP, x: 3.9, y: 0, z: -8.25, len: 0.3, fb: LAMP_FB, shadow: [0.35, 0.35] });
    placeProp({ url: U_LAMP, x: 9.0, y: 0, z: 8.2, len: 0.3, fb: LAMP_FB, shadow: [0.35, 0.35] });

    /* ---- HN2: clock, wardrobes, drawer, wheelchair, frames ------------
     * Wall-hugging NEW colliders in dead zones only (BFS-audited: every
     * previously reachable waypoint stays reachable — see handoff report).
     * Wardrobe/drawer/chest coords feed the __stvHideSpots /
     * __stvSearchSpots export at the bottom (game.js contract). */
    placeProp({ url: U_CLOCK, x: -3.65, y: 0, z: 6.5, ry: Math.PI / 2,
      len: 1.9, hw: 0.3, hd: 0.3, fb: [0.6, 1.8, 0x4a3320], shadow: [0.7, 0.6] });
    // HIDE = [x, z, ry, hw, hd]: A-west (faces E), S-corridor (faces S),
    // E-store south wall (faces N). E-store sits W of the S windows + boxes.
    var HIDE = [
      [-8.55, -4.6, Math.PI / 2, 0.32, 0.55],
      [0, 2.42, 0, 0.55, 0.32],
      [6.6, 8.55, Math.PI, 0.55, 0.32]
    ];
    for (var hc = 0; hc < HIDE.length; hc++) {
      (function (hx, hz, hry, hhw, hhd) {
        placeProp({ url: U_WARD, x: hx, y: 0, z: hz, ry: hry, len: 2.0,
          hw: hhw, hd: hhd, fb: [1.0, 1.9, 0x3a2c1e],
          shadow: (hhw < hhd) ? [0.7, 1.15] : [1.15, 0.7] });
      })(HIDE[hc][0], HIDE[hc][1], HIDE[hc][2], HIDE[hc][3], HIDE[hc][4]);
    }
    var DRAWER = { x: 8.6, z: 0.5, ry: -Math.PI / 2 }; // B east wall, faces W
    placeProp({ url: U_DRAWER, x: DRAWER.x, y: 0, z: DRAWER.z, ry: DRAWER.ry,
      len: 1.0, hw: 0.3, hd: 0.45, fb: [0.8, 0.9, 0x5a4632], shadow: [0.65, 0.95] });
    placeProp({ url: U_WHEEL, x: -9.3, y: 0, z: 6.0, ry: 0.5,
      len: 1.1, hw: 0.35, hd: 0.45, fb: [0.7, 0.9, 0x6a6a70], shadow: [0.7, 0.95] });
    placeProp({ url: U_ROCK, x: 5.4, y: 0, z: 7.8, ry: -0.6,
      len: 0.9, hw: 0.35, hd: 0.4, fb: [0.65, 0.9, 0x5a4632], shadow: [0.7, 0.9],
      onRoot: trackRocker });
    var FRAME_FB = [0.6, 0.6, 0x8a7648];
    placeProp({ url: U_FRAME, x: -2, y: 1.7, z: 8.92, ry: Math.PI, len: 0.7, fb: FRAME_FB });
    placeProp({ url: U_FRAME, x: -8.92, y: 1.7, z: -3.2, ry: Math.PI / 2, len: 0.7, fb: FRAME_FB });
    placeProp({ url: U_FRAME, x: 3, y: 1.7, z: -8.92, ry: 0, len: 0.7, fb: FRAME_FB });

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
    /* ---------- live AI Environment Director state ----------
     * Memory: ai-npc-and-environment-director.md section 2. Armed by
     * applyAiEnvironment(order) below; every timer ticks inside the
     * existing update(dt,t). Zero colliders, zero BFS/route impact. */
    var aiAshTurb = 1.0;      // ash_vortex swirl/drift multiplier, decays to 1
    var aiAshPeak = 1.0;      // armed vortex peak (linear 8s ramp reference)
    var aiBlackoutT = 0;      // lantern_blackout seconds remaining
    var aiBlackoutDim = 0.25; // lantern_blackout dim multiplier
    var aiOmenT = 0;          // chapel_omen seconds remaining
    var aiProxF = 0;          // goosebump EM proximity factor 0..1 (game.js fed)
    var omenCrimson = new THREE.Color(0xff2a1a);
    var omenAmber = new THREE.Color(0xff9a3c);
    var chapelSet = [P5, altarA, altarB];
    var chapelBase = [];
    for (var cb = 0; cb < chapelSet.length; cb++) {
      chapelBase.push(chapelSet[cb].color.getHex());
    }
    function updateAsh(t) {
      var turb = (typeof aiAshTurb === "number") ? aiAshTurb : 1.0;
      for (var a = 0; a < ASH_N; a++) {
        var ph = ashSeed[a * 2], sp = ashSeed[a * 2 + 1];
        var ax = ashBase[a * 3] + t * 0.12 * sp * turb + Math.sin(t * 0.4 * sp + ph) * 0.6 * turb;
        var az = ashBase[a * 3 + 2] + t * 0.05 * sp * turb + Math.cos(t * 0.3 * sp + ph * 1.7) * 0.6 * turb;
        // Wrap into the hall without branching on sign of t.
        ax = ((ax + ASH_X) % (ASH_X * 2) + ASH_X * 2) % (ASH_X * 2) - ASH_X;
        az = ((az + ASH_Z) % (ASH_Z * 2) + ASH_Z * 2) % (ASH_Z * 2) - ASH_Z;
        ashPos[a * 3] = ax;
        ashPos[a * 3 + 1] = ashBase[a * 3 + 1] + Math.sin(t * 0.5 * sp + ph) * 0.25 * turb;
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
        // AI Director lantern_blackout: scale the stored base by the armed
        // dim factor plus a fast guttering flicker; bases stay untouched so
        // restore is automatic when aiBlackoutT hits zero.
        var dim = 1.0;
        if (aiBlackoutT > 0) {
          var bf = Math.sin(t * 31.0 + fl.phase * 2.0) * Math.sin(t * 17.0 + fl.phase);
          dim = aiBlackoutDim * (0.75 + 0.25 * bf);
          if (dim < 0.02) { dim = 0.02; }
        }
        // Goosebump layer 2 — proximity EM flicker: game.js feeds
        // aiProxF (0..1) from Agatha's distance; lanterns shudder at
        // 43 rad/s as she closes in, before you ever see her.
        var emf = 1 + Math.sin(t * 43.0 + fl.phase) * 0.35 * aiProxF;
        fl.light.intensity = fl.base * dim * (1 + n * 0.18) * emf;
      }
      // Goosebump layer 1 drivers (cheap: 1 rocker + 3 chandeliers).
      var lr;
      for (lr = 0; lr < rockers.length; lr++) {
        try {
          rockers[lr].root.rotation.x = Math.sin(t * 1.4 + rockers[lr].ph) * 0.06;
        } catch (eRock) { /* x */ }
      }
      for (lr = 0; lr < swayers.length; lr++) {
        try {
          swayers[lr].root.rotation.z = Math.sin(t * 0.9 + swayers[lr].ph) * 0.025;
        } catch (eSway) { /* x */ }
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
      // AI Director timers: blackout countdown, ash turbulence decay back
      // to 1.0 (~8s exponential), chapel omen crimson-amber pulse + restore.
      try {
        if (aiBlackoutT > 0) {
          aiBlackoutT -= dt;
          if (aiBlackoutT <= 0) { aiBlackoutT = 0; }
        }
        if (aiAshTurb > 1.0) {
          var span = aiAshPeak - 1.0;
          if (!(span > 0)) { span = 1.5; }
          aiAshTurb -= dt * span / 8;
          if (aiAshTurb <= 1.0) { aiAshTurb = 1.0; }
        }
        if (aiOmenT > 0) {
          aiOmenT -= dt;
          var om = 0.5 + 0.5 * Math.sin(t * 2.4);
          for (var oc = 0; oc < chapelSet.length; oc++) {
            chapelSet[oc].color.copy(omenCrimson).lerp(omenAmber, om);
          }
          if (aiOmenT <= 0) {
            aiOmenT = 0;
            for (var oj = 0; oj < chapelSet.length; oj++) {
              chapelSet[oj].color.setHex(chapelBase[oj]);
            }
          }
        }
      } catch (eAiTick) { /* cosmetic timers never break the frame */ }
      keyMesh.rotation.y += dt * 1.4;
      keyMesh.position.y = KEY_POS.y + Math.sin(t * 2.2) * 0.06;
      updateAsh(t);
    }

    /* ---------- live AI Environment Director entry point ----------
     * order = { envEvent, fogDensity, lightDim, ashTurbulence } from
     * POST /api/studio/ai/director (see ai-npc-and-environment-director
     * memory section 2). Fog density is ALWAYS applied (clamped); the
     * envEvent arms a time-driven effect consumed by update(dt,t). */
    function applyAiEnvironment(order) {
      try {
        if (!order) { return; }
        if (typeof order.fogDensity === "number") {
          var fd = order.fogDensity;
          if (fd < 0.038) { fd = 0.038; }
          else if (fd > 0.065) { fd = 0.065; }
          if (scene.fog) { scene.fog.density = fd; }
        }
        var ev = order.envEvent;
        if (ev === "lantern_blackout") {
          var ld = (typeof order.lightDim === "number") ? order.lightDim : 0.25;
          if (ld < 0.05) { ld = 0.05; } else if (ld > 1) { ld = 1; }
          aiBlackoutDim = ld;
          aiBlackoutT = 5;
        } else if (ev === "storm_surge") {
          strikeT = 0;
          try { callThunder(); } catch (eTh) { /* audio not ready */ }
          try {
            if (scene.fog) {
              var sd = scene.fog.density + 0.008;
              if (sd > 0.065) { sd = 0.065; }
              scene.fog.density = sd;
            }
          } catch (eFg) { /* fog shift is cosmetic */ }
        } else if (ev === "ash_vortex") {
          var tb = (typeof order.ashTurbulence === "number") ? order.ashTurbulence : 2.5;
          if (tb < 1) { tb = 1; } else if (tb > 4) { tb = 4; }
          aiAshTurb = tb;
          aiAshPeak = tb;
        } else if (ev === "chapel_omen") {
          aiOmenT = 6;
        }
      } catch (eAi) { /* director orders never break the world */ }
    }

    /* ---------- HN2 hide/search spot export (game.js contract) ----------
     * hideSpots=[{x,z,ry,name}] (enterHide numbers), searchSpots=[{x,z,name}]
     * + searched flag. Coords match the wardrobes/drawer/chests above. */
    try {
      window.__stvHideSpots = [
        { x: HIDE[0][0], z: HIDE[0][1], ry: HIDE[0][2], name: "Classroom A wardrobe" },
        { x: HIDE[1][0], z: HIDE[1][1], ry: HIDE[1][2], name: "South corridor wardrobe" },
        { x: HIDE[2][0], z: HIDE[2][1], ry: HIDE[2][2], name: "East store wardrobe" }
      ];
      window.__stvSearchSpots = [
        { x: DRAWER.x, z: DRAWER.z, name: "Classroom B drawer cabinet", searched: false },
        { x: CHESTS[0][0], z: CHESTS[0][1], name: "West nook chest", searched: false },
        { x: CHESTS[1][0], z: CHESTS[1][1], name: "South-west store chest", searched: false }
      ];
    } catch (eSpots) { /* guarded: game plays identically without spots */ }

    return {
      colliders: colliders,
      spawn: { x: 0, z: 8.5, ry: 0 },
      bounds: { x0: -12, z0: -9, x1: 12, z1: 9 },
      update: update,
      applyAiEnvironment: applyAiEnvironment,
      setThreatFactor: function (f) {
        aiProxF = Math.max(0, Math.min(1, +f || 0));
      },
      keyMesh: keyMesh,
      chapelDoor: chapelDoor
    };
  }

  window.StV_Levels = { buildWorld: buildWorld, VERSION: VERSION };
})();
