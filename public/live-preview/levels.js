/* Horizon Sprint — levels.js
 * World builder: a large, varied closed Catmull-Rom circuit (~2.5x the original
 * lap length) with a long main straight, sweeping Turn 1, a climbing out-leg +
 * S-bend, a tight crest hairpin, a descending back-leg, a chicane on the return
 * straight and a sweeping SW loop; WorldRealism shader sky + PMREM IBL, Sobel
 * normal-mapped PBR road/kerbs/terrain, gentle along-track elevation (flat in
 * the south, rising to the hairpin crest), 20,000 3D wind-swaying grass blades
 * in 8 distance-cullable track sectors, and real GLTF (.glb) trackside scenery
 * (trees, palms, rocks, boulders, buildings, tents, street lights, and
 * concrete barriers) with per-object distance culling. */
(function () {
  "use strict";
  window.G = window.G || {};
  var G = window.G;

  function canvasTex(w, h, draw, srgb) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb !== false && THREE.sRGBEncoding !== undefined) {
      t.encoding = THREE.sRGBEncoding;
    }
    t.anisotropy = 4;
    return t;
  }

  // Expanded circuit: ~2.5x the original length. A long main straight, a
  // sweeping Turn 1, a climbing out-leg with an S-bend, a tight R~16m hairpin
  // at the crest, a descending back-leg, a return straight broken by a
  // chicane, and a sweeping SW loop back to the start. Bounds ~709 x 717 m.
  var CTRL = [
    [-81.2, -398.8], // 0  START/FINISH (south main straight, heading +x)
    [81.2, -394.6], // 1
    [216.3, -388.2], // 2  main straight
    [303.8, -367.1], // 3  Turn 1 sweep (SE -> up the east side)
    [354.5, -316.5], // 4
    [373.5, -251.1], // 5  out-leg climb (uphill)
    [381.9, -179.3], // 6
    [373.5, -105.5], // 7
    [367.1, -45.4], // 8  sweep
    [394.6, 22.2], // 9  S-bend
    [361.9, 82.3], // 10
    [386.1, 143.5], // 11
    [375.6, 217.3], // 12 short straight to the hairpin
    [409.3, 269.0], // 13 approach (heading N)
    [409.3, 316.5], // 14 HAIRPIN entry (R~35 U-turn)
    [398.8, 342.9], // 15
    [372.4, 353.4], // 16 crest apex (northmost point of the lap)
    [346.0, 342.9], // 17
    [335.5, 316.5], // 18 hairpin exit (heading S)
    [316.5, 282.7], // 19 exit S
    [289.1, 237.4], // 20 back-leg descent (downhill)
    [270.1, 157.2], // 21
    [289.1, 76.0], // 22
    [263.8, -5.3], // 23
    [283.8, -86.5], // 24
    [263.8, -164.6], // 25
    [277.5, -235.3], // 26 sweep back to the return straight
    [226.8, -272.2], // 27
    [107.6, -274.3], // 28 return straight (W-bound)
    [46.4, -272.2], // 29 CHICANE entry
    [0.0, -255.3], // 30 chicane kink N
    [-46.4, -272.2], // 31 chicane kink back
    [-126.6, -273.2], // 32 return straight
    [-211.0, -274.3], // 33 return straight
    [-270.1, -272.2], // 34 SW sweep start (big R~61 loop)
    [-316.5, -295.4], // 35 SW loop
    [-335.5, -336.5], // 36 westernmost point
    [-316.5, -377.7], // 37
    [-270.1, -400.9], // 38 grid run-up west end
    [-177.2, -400.9], // 39 grid run-up mid (closes to start line)
  ];
  var SAMPLES = 1500,
    ROAD_HALF = 6;

  // Smooth, gentle road elevation profile (metres). Flat (0) across the whole
  // south (start straight + chicane + grid) where tyre-skid VFX lives at y~0,
  // then it ramps up toward the north so the out-leg climbs and the back-leg
  // descends, with a soft crest right under the hairpin apex. Total range ~0-7m
  // with shallow gradients, so the camera and arcade physics stay calm.
  function roadElev(x, z) {
    var t = (z + 200) / 560;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var sm = t * t * (3 - 2 * t);
    var climb = 4.2 * sm;
    var roll =
      1.5 *
      (Math.sin(x * 0.0042 + 0.6) * Math.cos(z * 0.0046 - 0.4) * 0.5 + 0.5) *
      sm;
    var crest =
      2.4 *
      Math.exp(
        -((x - 340) * (x - 340) + (z - 360) * (z - 360)) / (250 * 250 * 1.2),
      );
    return climb + roll + crest;
  }

  function computeTrackData() {
    var curve = new THREE.CatmullRomCurve3(
      CTRL.map(function (p) {
        return new THREE.Vector3(p[0], 0, p[1]);
      }),
      true,
      "centripetal",
      0.5,
    );
    var raw = curve.getSpacedPoints(SAMPLES);
    raw.pop();
    var S = raw.length,
      pts = raw,
      tan = [],
      side = [],
      cum = [0],
      elev = [];
    for (var i = 0; i < S; i++) {
      var a = pts[(i - 1 + S) % S],
        b = pts[(i + 1) % S];
      var t = new THREE.Vector3().subVectors(b, a).normalize();
      tan.push(t);
      side.push(new THREE.Vector3(-t.z, 0, t.x));
      if (i > 0) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      elev.push(roadElev(pts[i].x, pts[i].z));
    }
    var totalLen = cum[S - 1] + pts[0].distanceTo(pts[S - 1]);
    var gates = [];
    for (var gi = 0; gi < 8; gi++) gates.push(Math.floor((gi * S) / 8));
    return {
      curve: curve,
      pts: pts,
      tan: tan,
      side: side,
      cum: cum,
      elev: elev,
      totalLen: totalLen,
      S: S,
      roadHalf: ROAD_HALF,
      offLateral: ROAD_HALF + 0.6,
      barrierLateral: ROAD_HALF + 3.1,
      gates: gates,
    };
  }

  function multiOctaveHeight(x, z) {
    var h1 = Math.sin(x * 0.014) * Math.cos(z * 0.014) * 5.5;
    var h2 = Math.sin(x * 0.033 + 1.4) * Math.cos(z * 0.029 - 0.8) * 2.2;
    var h3 = Math.sin((x + z) * 0.065) * 0.75;
    var radial = Math.sqrt(x * x + z * z);
    var rim = Math.max(0, (radial - 520) * 0.12);
    return h1 + h2 + h3 + rim;
  }

  G.buildWorld = function (scene, renderer) {
    var world = {};
    var WR = window.WorldRealism;

    // 1. Realistic Shader Sky + PMREM Environment Reflections + 3-Point Shadowed Lighting + ACES Filmic
    var skyInfo = WR.createRealisticSkyAndLighting(scene, renderer, {
      sunPosition: [120, 95, 60],
      exposure: 1.05,
      shadowMapSize: 1024,
      shadowFrustum: 95,
    });
    world.skyInfo = skyInfo;
    world.sun = skyInfo.sunLight;
    world.sunOffset = new THREE.Vector3(120, 95, 60);
    world.rim = skyInfo.rimLight;
    if (!world.rim.target) {
      world.rim.target = new THREE.Object3D();
      scene.add(world.rim.target);
    }
    world.rimOffset = new THREE.Vector3(-80, 40, -90);

    // 2. Track spline & O(1) distance field lookup grid
    var track = (world.track = computeTrackData());
    var pts = track.pts,
      tan = track.tan,
      side = track.side,
      cum = track.cum,
      totalLen = track.totalLen,
      S = track.S;

    var minX = 1e9,
      maxX = -1e9,
      minZ = 1e9,
      maxZ = -1e9;
    for (var k = 0; k < S; k++) {
      var p = pts[k];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    world.bounds = {
      minX: minX - 30,
      maxX: maxX + 30,
      minZ: minZ - 30,
      maxZ: maxZ + 30,
    };

    var DF_SIZE = 200;
    var DF_EXTENT = 1100;
    var DF_HALF = DF_EXTENT * 0.5;
    var distGrid = new Float32Array(DF_SIZE * DF_SIZE);
    for (var gz = 0; gz < DF_SIZE; gz++) {
      var wz0 = ((gz + 0.5) / DF_SIZE - 0.5) * DF_EXTENT;
      for (var gx = 0; gx < DF_SIZE; gx++) {
        var wx0 = ((gx + 0.5) / DF_SIZE - 0.5) * DF_EXTENT;
        var bestD2 = 1e12;
        for (var si = 0; si < S; si += 4) {
          var dx = pts[si].x - wx0;
          var dz = pts[si].z - wz0;
          var d2 = dx * dx + dz * dz;
          if (d2 < bestD2) bestD2 = d2;
        }
        distGrid[gz * DF_SIZE + gx] = Math.sqrt(bestD2);
      }
    }

    function fastTrackDist(x, z) {
      var fx = ((x + DF_HALF) / DF_EXTENT) * DF_SIZE;
      var fz = ((z + DF_HALF) / DF_EXTENT) * DF_SIZE;
      var ix = fx < 0 ? 0 : fx >= DF_SIZE - 1 ? DF_SIZE - 1 : fx | 0;
      var iz = fz < 0 ? 0 : fz >= DF_SIZE - 1 ? DF_SIZE - 1 : fz | 0;
      return distGrid[iz * DF_SIZE + ix];
    }

    var LAKE_X = -79.0,
      LAKE_Z = -514.0,
      LAKE_RX = 85.0,
      LAKE_RZ = 85.0;

    function lakeNormDist2(x, z) {
      var dx = (x - LAKE_X) / LAKE_RX;
      var dz = (z - LAKE_Z) / LAKE_RZ;
      return dx * dx + dz * dz;
    }

    function isInLake(x, z) {
      return (
        lakeNormDist2(x, z) < 0.92 && fastTrackDist(x, z) > ROAD_HALF + 8.0
      );
    }

    function isOnTrack(x, z) {
      return fastTrackDist(x, z) < ROAD_HALF + 3.8;
    }

    function getTerrainHeight(x, z) {
      var d = fastTrackDist(x, z);
      var flatEdge = ROAD_HALF + 5.0;
      var blendSpan = 30.0;
      var roadH = roadElev(x, z);
      if (d <= flatEdge) return roadH;
      var t = Math.min(1.0, (d - flatEdge) / blendSpan);
      var smooth = t * t * (3.0 - 2.0 * t);
      var baseH = roadH + Math.max(0.0, multiOctaveHeight(x, z)) * smooth;
      var ld2 = lakeNormDist2(x, z);
      if (ld2 < 1.35 && d > ROAD_HALF + 6.5) {
        var lakeFactor = Math.max(0.0, 1.0 - ld2 / 1.35);
        var basin = lakeFactor * lakeFactor * (3.0 - 2.0 * lakeFactor);
        return baseH * (1.0 - basin) - 1.35 * basin;
      }
      return baseH;
    }

    world.isOnTrack = isOnTrack;
    world.getTerrainHeight = getTerrainHeight;

    // 3. Sculpted Ribbon Road + Kerbs using Sobel normal-mapped PBR materials
    function stripGeo(inner, outer, y, vScale) {
      var pos = new Float32Array((S + 1) * 2 * 3);
      var uv = new Float32Array((S + 1) * 2 * 2);
      var idx = [];
      for (var i = 0; i <= S; i++) {
        var j = i % S,
          P = pts[j],
          Sd = side[j];
        var yj = (track.elev[j] || 0) + y;
        var v = (i < S ? cum[i] : totalLen) / vScale;
        pos.set(
          [
            P.x + Sd.x * inner,
            yj,
            P.z + Sd.z * inner,
            P.x + Sd.x * outer,
            yj,
            P.z + Sd.z * outer,
          ],
          i * 6,
        );
        uv.set([0, v, 1, v], i * 4);
        if (i < S) {
          var r = i * 2;
          idx.push(r, r + 1, r + 2, r + 1, r + 3, r + 2);
        }
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    var asphaltMat = WR.createProceduralPBRMaterial("asphalt", {
      size: 256,
      repeatX: 1,
      repeatY: 1,
      roadMarkings: true,
      roughness: 0.86,
      envMapIntensity: 0.4,
    });
    G.roughTex = asphaltMat.roughnessMap;

    var roadMesh = new THREE.Mesh(
      stripGeo(-ROAD_HALF, ROAD_HALF, 0.02, 14),
      asphaltMat,
    );
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    var kerbMat = WR.createProceduralPBRMaterial("kerb", {
      size: 256,
      repeatX: 1,
      repeatY: 1,
      roughness: 0.76,
      envMapIntensity: 0.35,
    });
    var curbL = new THREE.Mesh(
      stripGeo(-ROAD_HALF - 1.4, -ROAD_HALF, 0.035, 6),
      kerbMat,
    );
    var curbR = new THREE.Mesh(
      stripGeo(ROAD_HALF, ROAD_HALF + 1.4, 0.035, 6),
      kerbMat,
    );
    curbL.receiveShadow = curbR.receiveShadow = true;
    scene.add(curbL);
    scene.add(curbR);

    // 4. Multi-octave displaced terrain mesh with track spline flattening
    var terrainMat = WR.createProceduralPBRMaterial("grass", {
      size: 256,
      repeatX: 52,
      repeatY: 52,
      roughness: 0.92,
      envMapIntensity: 0.22,
    });
    terrainMat.color.setRGB(0.32, 0.56, 0.24);
    var rockMat = WR.createProceduralPBRMaterial("rock", {
      size: 256,
      repeatX: 18,
      repeatY: 18,
      roughness: 0.88,
      envMapIntensity: 0.3,
    });

    var texLoader = new THREE.TextureLoader();
    // Real Polyhaven 1K PBR asphalt_02 textures on road
    texLoader.load(
      "/studio/assets/polyhaven/asphalt_02/asphalt_02_diff_1k.jpg",
      function (diffTex) {
        diffTex.wrapS = diffTex.wrapT = THREE.RepeatWrapping;
        diffTex.repeat.set(1, 1);
        diffTex.anisotropy = 8;
        if (THREE.sRGBEncoding !== undefined)
          diffTex.encoding = THREE.sRGBEncoding;
        asphaltMat.map = diffTex;
        asphaltMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );
    texLoader.load(
      "/studio/assets/polyhaven/asphalt_02/asphalt_02_nor_gl_1k.jpg",
      function (norTex) {
        norTex.wrapS = norTex.wrapT = THREE.RepeatWrapping;
        norTex.repeat.set(1, 1);
        norTex.anisotropy = 8;
        asphaltMat.normalMap = norTex;
        asphaltMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );

    // Real Polyhaven 1K PBR forrest_ground_01 textures on terrain
    texLoader.load(
      "/studio/assets/polyhaven/forrest_ground_01/forrest_ground_01_diff_1k.jpg",
      function (diffTex) {
        diffTex.wrapS = diffTex.wrapT = THREE.RepeatWrapping;
        diffTex.repeat.set(64, 64);
        diffTex.anisotropy = 8;
        if (THREE.sRGBEncoding !== undefined)
          diffTex.encoding = THREE.sRGBEncoding;
        terrainMat.map = diffTex;
        terrainMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );
    texLoader.load(
      "/studio/assets/polyhaven/forrest_ground_01/forrest_ground_01_nor_gl_1k.jpg",
      function (norTex) {
        norTex.wrapS = norTex.wrapT = THREE.RepeatWrapping;
        norTex.repeat.set(64, 64);
        norTex.anisotropy = 8;
        terrainMat.normalMap = norTex;
        terrainMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );

    texLoader.load(
      "/studio/assets/polyhaven/aerial_rocks_02/aerial_rocks_02_diff_1k.jpg",
      function (diffTex) {
        diffTex.wrapS = diffTex.wrapT = THREE.RepeatWrapping;
        diffTex.repeat.set(20, 20);
        if (THREE.sRGBEncoding !== undefined)
          diffTex.encoding = THREE.sRGBEncoding;
        rockMat.map = diffTex;
        rockMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );
    texLoader.load(
      "/studio/assets/polyhaven/aerial_rocks_02/aerial_rocks_02_nor_gl_1k.jpg",
      function (norTex) {
        norTex.wrapS = norTex.wrapT = THREE.RepeatWrapping;
        norTex.repeat.set(20, 20);
        rockMat.normalMap = norTex;
        rockMat.needsUpdate = true;
      },
      undefined,
      function () {},
    );

    (function buildDisplacedTerrain() {
      var gridN = 64; // 64x64 (perf: 1/4 the verts of 128x128); road ribbon hides the seam
      var extent = 1300;
      var vCount = (gridN + 1) * (gridN + 1);
      var positions = new Float32Array(vCount * 3);
      var uvs = new Float32Array(vCount * 2);
      var indices = [];

      for (var gz2 = 0; gz2 <= gridN; gz2++) {
        var vz = gz2 / gridN;
        var wz = (vz - 0.5) * extent;
        for (var gx2 = 0; gx2 <= gridN; gx2++) {
          var vx = gx2 / gridN;
          var wx = (vx - 0.5) * extent;
          var idx = gz2 * (gridN + 1) + gx2;
          var wy = getTerrainHeight(wx, wz) - 0.05;
          positions[idx * 3] = wx;
          positions[idx * 3 + 1] = wy;
          positions[idx * 3 + 2] = wz;
          uvs[idx * 2] = vx;
          uvs[idx * 2 + 1] = vz;
        }
      }
      for (var rz = 0; rz < gridN; rz++) {
        for (var rx = 0; rx < gridN; rx++) {
          var a = rz * (gridN + 1) + rx;
          var b = a + 1;
          var c = a + (gridN + 1);
          var d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      var terrainGeo = new THREE.BufferGeometry();
      terrainGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      terrainGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      terrainGeo.setIndex(indices);
      terrainGeo.computeVertexNormals();

      var terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.receiveShadow = true;
      scene.add(terrainMesh);
    })();

    // 5. Chunked 3D Grass — 8 track sectors × 1,800 tufts = 14,400 3D wind-
    // swaying blades (perf cut from the 20k floor for 60fps). world.update()
    // renders only the player's nearest chunk + its two loop-neighbours (3
    // of 8 sectors, ~5,400 instances), so the other 5 chunks' wind vertex-
    // shader work drops out every frame while grass stays dense around the
    // car. Each chunk still uses the vendor 3D blade InstancedMesh +
    // onBeforeCompile wind shader via WorldRealism.
    var GRASS_CHUNKS = 8;
    var GRASS_PER_CHUNK = 1800; // 8 × 1800 = 14,400 (perf-tuned for 60fps)
    var grassSectorSize = Math.floor(S / GRASS_CHUNKS);
    var grassGroup = new THREE.Group();
    grassGroup.name = "GrassChunks";
    scene.add(grassGroup);
    var grassChunks = [];
    for (var gc = 0; gc < GRASS_CHUNKS; gc++) {
      var gStart = gc * grassSectorSize;
      var gEnd = gc === GRASS_CHUNKS - 1 ? S : gStart + grassSectorSize;
      var gMidIdx = ((Math.floor((gStart + gEnd) / 2) % S) + S) % S;
      var gMidP = pts[gMidIdx];
      var chunk = WR.create3DGrassField(grassGroup, {
        count: GRASS_PER_CHUNK,
        minCount: 1500, // opt-in: allow a sub-20k chunk (vendor default is 20k)
        radius: 160,
        spread: 700,
        bladeHeight: 0.72,
        bladeWidth: 0.18,
        excludeFn: function (x, z) {
          return isOnTrack(x, z) || isInLake(x, z);
        },
        heightFn: getTerrainHeight,
        sampleFn: (function (a, b) {
          var span = Math.max(1, b - a);
          return function (attempt, u1, u2) {
            // Confine this chunk's tufts to its track index range [a, b),
            // with a denser band near the start/finish village (first 30%
            // of attempts) so the grid still looks lush.
            var idx;
            if (attempt % 10 < 3) {
              var sub = Math.max(1, Math.floor(span * 0.6));
              idx = (a + Math.floor(u1 * sub)) % S;
            } else {
              idx = (a + Math.floor(u1 * span)) % S;
            }
            if (idx < 0) idx += S;
            var P = pts[idx],
              Sd = side[idx],
              Tn = tan[idx];
            var sideSign = attempt % 2 === 0 ? 1 : -1;
            var latDist = 8.0 + Math.pow(u2, 2.2) * 122.0;
            var alongJitter = (((attempt * 0.6180339887) % 1.0) - 0.5) * 7.0;
            var wx = P.x + Sd.x * (sideSign * latDist) + Tn.x * alongJitter;
            var wz = P.z + Sd.z * (sideSign * latDist) + Tn.z * alongJitter;
            return [wx, wz];
          };
        })(gStart, gEnd),
      });
      grassChunks.push({
        mesh: chunk.mesh,
        field: chunk,
        cx: gMidP.x,
        cz: gMidP.z,
      });
    }
    world.grassChunks = grassChunks;

    // Scenery registry: every placed GLB model + building gets pushed here so
    // world.update() can distance-cull objects >220m from the player (saves
    // their draw calls when the car is on the far side of the lap). The
    // start/finish village (buildings, coffee cart, seating, barrels,
    // lantern, drill) clusters near sample 0 and is ~300-600m away for most
    // of a lap — culling it removes dozens of multi-mesh GLB draw calls.
    var scenery = [];
    world.scenery = scenery;

    // 5b. Scenic Lakeside Water Body beside the opening straight & turn 1
    var waterSurface = null;
    if (typeof WR.createRealisticWater === "function") {
      waterSurface = WR.createRealisticWater(scene, {
        width: LAKE_RX * 2.0,
        depth: LAKE_RZ * 2.0,
        // 16x16 segments (was 32x32): 1/4 the water vertices + shadow-pass
        // verts; the wave motion is driven by the fragment shader so the
        // silhouette stays smooth.
        segmentsX: 16,
        segmentsZ: 16,
        position: [LAKE_X, 0.06, LAKE_Z],
        sunDirection: [120, 95, 60],
        deepColor: "#0a3246",
        skyColor: "#7ab8d6",
        waveHeight: 0.12,
        simpleFoam: true,
      });
      world.water = waterSurface;
    }

    // 5c. Realistic Multi-Material PBR Buildings along the Start/Finish Village
    if (typeof WR.createRealisticBuilding === "function") {
      var buildingDefs = [
        {
          idx: S - 38,
          lat: 23.5,
          width: 14,
          depth: 10,
          floors: 3,
          style: "brick",
          yawOffset: -Math.PI / 2,
        },
        {
          idx: S - 18,
          lat: -23.0,
          width: 12,
          depth: 9.5,
          floors: 2,
          style: "concrete",
          yawOffset: Math.PI / 2,
        },
        {
          idx: 6,
          lat: 24.0,
          width: 15,
          depth: 11,
          floors: 4,
          style: "concrete",
          yawOffset: -Math.PI / 2,
        },
        {
          idx: 30,
          lat: 25.5,
          width: 13,
          depth: 10,
          floors: 3,
          style: "brick",
          yawOffset: -Math.PI / 2,
        },
        {
          idx: 72,
          lat: 27.0,
          width: 12,
          depth: 9,
          floors: 2,
          style: "brick",
          yawOffset: -Math.PI / 2,
        },
      ];
      for (var bi = 0; bi < buildingDefs.length; bi++) {
        var bd = buildingDefs[bi];
        var bIdx = ((bd.idx % S) + S) % S;
        var bP = pts[bIdx],
          bSd = side[bIdx],
          bT = tan[bIdx];
        var bx = bP.x + bSd.x * bd.lat;
        var bz = bP.z + bSd.z * bd.lat;
        var by = Math.max(0, getTerrainHeight(bx, bz) - 0.15);
        var bGroup = WR.createRealisticBuilding(scene, {
          width: bd.width,
          depth: bd.depth,
          floors: bd.floors,
          style: bd.style,
          position: [bx, by, bz],
          rotationY: Math.atan2(bT.x, bT.z) + bd.yawOffset,
        });
        if (bGroup) {
          // Village buildings are multi-mesh assemblies (~30 meshes each).
          // Drop them from the shadow CAST pass (they still receive shadows):
          // when far they're outside the sun's 95m shadow frustum anyway, and
          // when near this skips the per-frame shadow-frustum test for all
          // their window/sill/hvac meshes.
          bGroup.traverse(function (n) {
            if (n && n.isMesh) n.castShadow = false;
          });
          scenery.push({ obj: bGroup, x: bx, z: bz });
        }
      }
    }

    // 6. Corner rubber-mark decals on asphalt
    (function rubberDecals() {
      function curveAt(i) {
        var a = tan[(i - 15 + S) % S],
          b = tan[(i + 15) % S];
        return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
      }
      var quads = [];
      var zones = [],
        i = 0;
      while (i < S) {
        if (curveAt(i) > 0.1) {
          var j = i;
          while (j < i + 150 && curveAt(((j % S) + S) % S) > 0.05) j += 7;
          zones.push([i, j]);
          i = j + 20;
        } else i += 6;
      }
      var perPair = zones.length
        ? Math.max(2, Math.min(8, Math.floor(32 / zones.length)))
        : 0;
      zones.forEach(function (z) {
        var span = Math.max(1, z[1] - z[0]);
        for (var k2 = 0; k2 < perPair && quads.length < 64; k2++) {
          var si =
            (((z[0] + Math.floor((span * (k2 + 0.5)) / perPair)) % S) + S) % S;
          quads.push([si, -2.3]);
          quads.push([si, 2.3]);
        }
      });
      if (!quads.length) return;
      var smudge = canvasTex(
        64,
        128,
        function (x, W, H) {
          x.clearRect(0, 0, W, H);
          for (var s = 0; s < 42; s++) {
            var gx = 6 + Math.random() * (W - 12);
            var gr = x.createLinearGradient(0, 0, 0, H);
            var a1 = 0.35 + Math.random() * 0.35,
              a2 = 0.35 + Math.random() * 0.35;
            gr.addColorStop(0, "rgba(10,10,10,0)");
            gr.addColorStop(0.25, "rgba(10,10,10," + a1.toFixed(2) + ")");
            gr.addColorStop(0.75, "rgba(10,10,10," + a2.toFixed(2) + ")");
            gr.addColorStop(1, "rgba(10,10,10,0)");
            x.fillStyle = gr;
            x.fillRect(gx, 0, 3 + Math.random() * 7, H);
          }
        },
        false,
      );
      var pos = new Float32Array(quads.length * 4 * 3);
      var uv = new Float32Array(quads.length * 4 * 2);
      var idx = [];
      for (var q = 0; q < quads.length; q++) {
        var P = pts[quads[q][0]],
          T = tan[quads[q][0]],
          Sd = side[quads[q][0]];
        var lat = quads[q][1];
        var yq = (track.elev[quads[q][0]] || 0) + 0.04;
        var cx = P.x + Sd.x * lat,
          cz = P.z + Sd.z * lat;
        var hx = Sd.x * 1.6,
          hz = Sd.z * 1.6,
          lx = T.x * 3.5,
          lz = T.z * 3.5;
        pos.set(
          [
            cx - hx - lx,
            yq,
            cz - hz - lz,
            cx + hx - lx,
            yq,
            cz + hz - lz,
            cx + hx + lx,
            yq,
            cz + hz + lz,
            cx - hx + lx,
            yq,
            cz - hz + lz,
          ],
          q * 12,
        );
        uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
        var r = q * 4;
        idx.push(r, r + 2, r + 1, r, r + 3, r + 2);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      var m = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color: 0x111111,
          map: smudge,
          transparent: true,
          opacity: 0.65,
          roughness: 0.35,
          metalness: 0,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          envMapIntensity: 0.4,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      m.renderOrder = 1;
      scene.add(m);
    })();

    // 7. Start line + Overhead Banner
    var T00 = tan[0],
      yaw0 = Math.atan2(T00.x, T00.z);
    var bannerTex = canvasTex(512, 64, function (x, W, H) {
      x.fillStyle = "#14181f";
      x.fillRect(0, 0, W, H);
      for (var q = 0; q < 32; q++) {
        x.fillStyle = q % 2 ? "#f2f2f2" : "#141414";
        x.fillRect(q * 16, 0, 16, 10);
        x.fillRect(q * 16, H - 10, 16, 10);
      }
      x.fillStyle = "#ffb300";
      x.font = "italic 900 34px Arial";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText("HORIZON SPRINT", W / 2, H / 2 + 1);
    });
    var gantry = new THREE.Group();
    gantry.position.copy(pts[0]);
    gantry.position.y = track.elev[0] || 0;
    gantry.rotation.y = yaw0;
    var banner = new THREE.Mesh(
      new THREE.PlaneGeometry((ROAD_HALF + 1.6) * 2, 1.35),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }),
    );
    banner.position.y = 6.2;
    gantry.add(banner);
    scene.add(gantry);

    var lineTex = canvasTex(128, 32, function (x, W, H) {
      for (var r = 0; r < 2; r++)
        for (var c = 0; c < 8; c++) {
          x.fillStyle = (r + c) % 2 ? "#111" : "#f5f5f5";
          x.fillRect(c * 16, r * 16, 16, 16);
        }
    });
    var startLine = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 2.2),
      new THREE.MeshBasicMaterial({ map: lineTex }),
    );
    startLine.rotation.x = -Math.PI / 2;
    var lh = new THREE.Group();
    lh.position.copy(pts[0]);
    lh.position.y = (track.elev[0] || 0) + 0.045;
    lh.rotation.y = yaw0;
    lh.add(startLine);
    scene.add(lh);

    // 8. Real .glb Trackside Scenery (Barriers, Streetlights, Trees, Palms, Rocks, Boulders, Buildings, Tents)
    function placeAlongTrack(proto, spotList, disableShadow) {
      for (var i = 0; i < spotList.length; i++) {
        var sp = spotList[i];
        var idx = ((sp.idx % S) + S) % S;
        var P = pts[idx],
          Sd = side[idx],
          T = tan[idx];
        var wx = P.x + Sd.x * sp.lat;
        var wz = P.z + Sd.z * sp.lat;
        var wy = getTerrainHeight(wx, wz);
        var inst = proto.clone(true);
        if (disableShadow) {
          inst.traverse(function (n) {
            if (n && n.isMesh) n.castShadow = false;
          });
        }
        if (sp.scale) inst.scale.multiplyScalar(sp.scale);
        inst.position.set(wx, wy, wz);
        var baseYaw = Math.atan2(T.x, T.z);
        inst.rotation.y = baseYaw + (sp.yawOffset || 0);
        scene.add(inst);
        scenery.push({ obj: inst, x: wx, z: wz });
      }
    }

    setTimeout(function () {
      // Polyhaven photogrammetry concrete road barriers: /studio/assets/polyhaven/concrete_road_barrier_02/concrete_road_barrier_02_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/concrete_road_barrier_02/concrete_road_barrier_02_1k.glb",
        function (barrierProto) {
          var barrierSpots = [];
          for (var i = 0; i < S; i += 24) {
            barrierSpots.push({
              idx: i,
              lat: -(ROAD_HALF + 2.4),
              yawOffset: Math.PI / 2,
            });
            barrierSpots.push({
              idx: i,
              lat: ROAD_HALF + 2.4,
              yawOffset: -Math.PI / 2,
            });
          }
          placeAlongTrack(barrierProto, barrierSpots, true);
        },
        { targetLength: 3.4, envMapIntensity: 1.15, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry street lamps: /studio/assets/polyhaven/street_lamp_01/street_lamp_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/street_lamp_01/street_lamp_01_1k.glb",
        function (lightProto) {
          var lightSpots = [
            {
              idx: 0,
              lat: -(ROAD_HALF + 2.0),
              yawOffset: Math.PI / 2,
              scale: 1.15,
            },
            {
              idx: 0,
              lat: ROAD_HALF + 2.0,
              yawOffset: -Math.PI / 2,
              scale: 1.15,
            },
          ];
          for (var i = 20; i < S; i += 45) {
            var sideSign = (i / 45) % 2 === 0 ? 1 : -1;
            lightSpots.push({
              idx: i,
              lat: sideSign * (ROAD_HALF + 3.6),
              yawOffset: sideSign > 0 ? -Math.PI / 2 : Math.PI / 2,
            });
          }
          placeAlongTrack(lightProto, lightSpots, false);
        },
        { targetLength: 6.8, envMapIntensity: 1.25 },
      ).catch(function () {});

      // Polyhaven photogrammetry lush broadleaf canopy trees: /studio/assets/polyhaven/lush_tree_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/lush_tree_1k.glb",
        function (treeProto) {
          var treeSpots = [
            { idx: S - 36, lat: -15, yawOffset: 0.4, scale: 1.15 },
            { idx: S - 24, lat: 15.5, yawOffset: 1.9, scale: 1.2 },
            { idx: S - 10, lat: -16, yawOffset: 3.1, scale: 1.1 },
            { idx: 8, lat: 16, yawOffset: 0.8, scale: 1.15 },
            { idx: 22, lat: -16.5, yawOffset: 2.4, scale: 1.25 },
            { idx: 36, lat: 17, yawOffset: 1.2, scale: 1.18 },
          ];
          for (var i = 55; i < S - 50; i += 45) {
            var sideSign = i % 90 === 0 ? 1 : -1;
            var dist = 15 + ((i * 37) % 16);
            var sc = 0.95 + ((i * 19) % 8) * 0.08;
            treeSpots.push({
              idx: i,
              lat: sideSign * dist,
              yawOffset: (i * 1.3) % 6.28,
              scale: sc,
            });
          }
          placeAlongTrack(treeProto, treeSpots, false);
        },
        { targetLength: 13.5, envMapIntensity: 1.15, castShadow: true },
      ).catch(function () {});

      // Polyhaven photogrammetry lush conifer pine trees: /studio/assets/polyhaven/pine_tree_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/pine_tree_1k.glb",
        function (pineProto) {
          var pineSpots = [
            { idx: S - 30, lat: 18.5, yawOffset: 0.7, scale: 1.12 },
            { idx: S - 16, lat: 17.5, yawOffset: 2.2, scale: 1.08 },
            { idx: 2, lat: -17.5, yawOffset: 1.5, scale: 1.15 },
            { idx: 16, lat: 18.0, yawOffset: 2.9, scale: 1.1 },
            { idx: 30, lat: -18.0, yawOffset: 0.5, scale: 1.18 },
          ];
          for (var i = 12; i < S; i += 38) {
            var sideSign = i % 76 < 38 ? -1 : 1;
            var dist = 15 + ((i * 23) % 16);
            pineSpots.push({
              idx: i,
              lat: sideSign * dist,
              yawOffset: (i * 0.9) % 6.28,
              scale: 0.96 + ((i * 11) % 5) * 0.08,
            });
          }
          placeAlongTrack(pineProto, pineSpots, false);
        },
        { targetLength: 13.8, envMapIntensity: 1.15, castShadow: true },
      ).catch(function () {});

      // Polyhaven photogrammetry shrubs: /studio/assets/polyhaven/shrub_03/shrub_03_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/shrub_03/shrub_03_1k.glb",
        function (shrubProto) {
          var shrubSpots = [];
          for (var i = 5; i < S; i += 16) {
            var sideSign = i % 32 < 16 ? 1 : -1;
            shrubSpots.push({
              idx: i,
              lat: sideSign * (10.5 + (i % 9)),
              yawOffset: (i * 1.7) % 6.28,
              scale: 0.95 + (i % 5) * 0.14,
            });
          }
          placeAlongTrack(shrubProto, shrubSpots, true);
        },
        { targetLength: 2.8, envMapIntensity: 1.1, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry ferns: /studio/assets/polyhaven/fern_02/fern_02_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/fern_02/fern_02_1k.glb",
        function (fernProto) {
          var fernSpots = [];
          for (var i = 9; i < S; i += 18) {
            var sideSign = i % 36 < 18 ? -1 : 1;
            fernSpots.push({
              idx: i,
              lat: sideSign * (9.5 + (i % 7)),
              yawOffset: (i * 2.1) % 6.28,
              scale: 1.0 + (i % 4) * 0.15,
            });
          }
          placeAlongTrack(fernProto, fernSpots, true);
        },
        { targetLength: 1.9, envMapIntensity: 1.1, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry Namaqualand boulder clusters: /studio/assets/polyhaven/namaqualand_boulders_01/namaqualand_boulders_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/namaqualand_boulders_01/namaqualand_boulders_01_1k.glb",
        function (boulderClusterProto) {
          var clusterSpots = [];
          for (var i = 15; i < S; i += 36) {
            var sideSign = i % 72 < 36 ? 1 : -1;
            clusterSpots.push({
              idx: i,
              lat: sideSign * (20 + (i % 16)),
              yawOffset: i * 0.7,
              scale: 1.0 + (i % 4) * 0.25,
            });
          }
          placeAlongTrack(boulderClusterProto, clusterSpots, true);
        },
        { targetLength: 7.5, envMapIntensity: 1.1, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry boulders: /studio/assets/polyhaven/boulder_01/boulder_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/boulder_01/boulder_01_1k.glb",
        function (boulderProto) {
          var boulderSpots = [];
          for (var i = 28; i < S; i += 45) {
            var sideSign = i % 90 < 45 ? -1 : 1;
            boulderSpots.push({
              idx: i,
              lat: sideSign * (24 + (i % 14)),
              yawOffset: i * 1.1,
              scale: 1.1 + (i % 3) * 0.3,
            });
          }
          placeAlongTrack(boulderProto, boulderSpots, true);
        },
        { targetLength: 6.4, envMapIntensity: 1.1, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry CoffeeCart_01 near Start/Finish Village: /studio/assets/polyhaven/CoffeeCart_01/CoffeeCart_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/CoffeeCart_01/CoffeeCart_01_1k.glb",
        function (cartProto) {
          placeAlongTrack(
            cartProto,
            [
              { idx: S - 28, lat: 14.5, yawOffset: -Math.PI / 2, scale: 1.0 },
              { idx: 12, lat: 14.8, yawOffset: -Math.PI / 2, scale: 1.0 },
            ],
            false,
          );
        },
        { targetLength: 2.6, envMapIntensity: 1.25, castShadow: true },
      ).catch(function () {});

      // Polyhaven photogrammetry modular_street_seating near Start/Finish Village & Lakeside: /studio/assets/polyhaven/modular_street_seating/modular_street_seating_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/modular_street_seating/modular_street_seating_1k.glb",
        function (seatProto) {
          placeAlongTrack(
            seatProto,
            [
              { idx: S - 32, lat: 15.2, yawOffset: -Math.PI / 2, scale: 1.0 },
              { idx: S - 12, lat: -15.0, yawOffset: Math.PI / 2, scale: 1.0 },
              { idx: 18, lat: -14.5, yawOffset: Math.PI / 2, scale: 1.0 },
            ],
            false,
          );
        },
        { targetLength: 3.2, envMapIntensity: 1.2, castShadow: true },
      ).catch(function () {});

      // Polyhaven photogrammetry Barrel_01 clusters in Pit/Start Village: /studio/assets/polyhaven/Barrel_01/Barrel_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/Barrel_01/Barrel_01_1k.glb",
        function (barrelProto) {
          placeAlongTrack(
            barrelProto,
            [
              { idx: S - 22, lat: 13.5, yawOffset: 0.3, scale: 1.0 },
              { idx: S - 21, lat: 14.2, yawOffset: 1.4, scale: 0.96 },
              { idx: 4, lat: -13.8, yawOffset: 0.8, scale: 1.0 },
              { idx: 5, lat: -14.5, yawOffset: 2.1, scale: 1.02 },
            ],
            true,
          );
        },
        { targetLength: 0.95, envMapIntensity: 1.25, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry Lantern_01 & Drill_01 Pit Details: /studio/assets/polyhaven/Lantern_01/Lantern_01_1k.glb & /studio/assets/polyhaven/Drill_01/Drill_01_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/Lantern_01/Lantern_01_1k.glb",
        function (lanternProto) {
          placeAlongTrack(
            lanternProto,
            [
              { idx: S - 26, lat: 13.2, yawOffset: 0.5, scale: 1.0 },
              { idx: 10, lat: 13.4, yawOffset: 1.2, scale: 1.0 },
            ],
            true,
          );
        },
        { targetLength: 0.55, envMapIntensity: 1.3, castShadow: false },
      ).catch(function () {});

      WR.loadGlbModel(
        "/studio/assets/polyhaven/Drill_01/Drill_01_1k.glb",
        function (drillProto) {
          placeAlongTrack(
            drillProto,
            [{ idx: S - 20, lat: 13.0, yawOffset: 0.9, scale: 1.0 }],
            true,
          );
        },
        { targetLength: 0.42, envMapIntensity: 1.3, castShadow: false },
      ).catch(function () {});
    }, 50);

    // 9. High-altitude clouds (soft canvas sprites)
    var cloudTex = canvasTex(
      128,
      128,
      function (x, W, H) {
        x.clearRect(0, 0, W, H);
        for (var n = 0; n < 14; n++) {
          var gx = 24 + Math.random() * 80,
            gy = 44 + Math.random() * 40,
            gr = 14 + Math.random() * 22;
          var g = x.createRadialGradient(gx, gy, 2, gx, gy, gr);
          g.addColorStop(0, "rgba(255,255,255,0.55)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          x.fillStyle = g;
          x.beginPath();
          x.arc(gx, gy, gr, 0, 7);
          x.fill();
        }
      },
      false,
    );
    var clouds = [];
    for (var ci2 = 0; ci2 < 16; ci2++) {
      var sm = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        fog: false,
      });
      var sp = new THREE.Sprite(sm);
      var ca = Math.random() * Math.PI * 2,
        cr2 = 280 + Math.random() * 420;
      sp.position.set(
        Math.cos(ca) * cr2,
        120 + Math.random() * 90,
        Math.sin(ca) * cr2,
      );
      var ssc = 90 + Math.random() * 90;
      sp.scale.set(ssc, ssc * 0.45, 1);
      scene.add(sp);
      clouds.push(sp);
    }

    // ---------- queries ----------
    var _o = { idx: 0, lateral: 0 };
    world.progress = function (x, z, lastIdx) {
      var best = 0,
        bd = Infinity,
        i,
        d2;
      if (lastIdx === undefined || lastIdx < 0) {
        for (i = 0; i < S; i += 2) {
          var dx = pts[i].x - x,
            dz = pts[i].z - z;
          d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            bd = d2;
            best = i;
          }
        }
        for (i = -2; i <= 2; i++) {
          var j = (best + i + S) % S;
          var ex = pts[j].x - x,
            ez = pts[j].z - z;
          d2 = ex * ex + ez * ez;
          if (d2 < bd) {
            bd = d2;
            best = j;
          }
        }
      } else {
        for (i = -28; i <= 28; i++) {
          var jj = (lastIdx + i + S) % S;
          var fx = pts[jj].x - x,
            fz = pts[jj].z - z;
          d2 = fx * fx + fz * fz;
          if (d2 < bd) {
            bd = d2;
            best = jj;
          }
        }
      }
      var P = pts[best],
        Sd = side[best];
      _o.idx = best;
      _o.lateral = (x - P.x) * Sd.x + (z - P.z) * Sd.z;
      return _o;
    };

    world.startPose = function (slot) {
      var row = Math.floor(slot / 2),
        col = slot % 2;
      var idx = (((S - 46 - row * 11) % S) + S) % S;
      var P = pts[idx],
        Sd = side[idx],
        T = tan[idx];
      var lat = col === 0 ? -2.4 : 2.4;
      return {
        x: P.x + Sd.x * lat,
        z: P.z + Sd.z * lat,
        angle: Math.atan2(T.x, T.z),
        idx: idx,
      };
    };

    world.update = function (dt, time, playerPos) {
      var px = playerPos ? playerPos.x : 0;
      var pz = playerPos ? playerPos.z : 0;
      var CULL2 = 150 * 150; // ~150m scenery distance-cull radius (perf cut from 220m)

      // Grass chunk distance culling: always render the player's nearest
      // chunk + its two loop-neighbours (no pop-in around the car), plus any
      // other chunk whose centre is within ~220m. Wind uTime advances on
      // every chunk so culled chunks resume mid-wave, not frozen.
      if (grassChunks.length) {
        var bestK = 0,
          bestD = Infinity;
        for (var ci = 0; ci < grassChunks.length; ci++) {
          var ddx = grassChunks[ci].cx - px,
            ddz = grassChunks[ci].cz - pz;
          var dd = ddx * ddx + ddz * ddz;
          if (dd < bestD) {
            bestD = dd;
            bestK = ci;
          }
        }
        var KC = grassChunks.length;
        for (var k = 0; k < KC; k++) {
          var ch = grassChunks[k];
          // Only the nearest chunk + its two loop-neighbours render (3 of 8),
          // so grass beyond ~2 sectors is skipped entirely each frame. Wind
          // uTime still advances on every chunk so culled ones resume mid-wave.
          ch.mesh.visible =
            k === bestK ||
            k === (bestK - 1 + KC) % KC ||
            k === (bestK + 1) % KC;
          if (ch.field && typeof ch.field.update === "function") {
            ch.field.update(dt, playerPos);
          }
        }
      }

      // Scenery distance culling: hide every trackside GLB / building farther
      // than ~220m from the player.
      if (scenery.length) {
        for (var si = 0; si < scenery.length; si++) {
          var s = scenery[si];
          var sx = s.x - px,
            sz = s.z - pz;
          s.obj.visible = sx * sx + sz * sz < CULL2;
        }
      }

      if (waterSurface && typeof waterSurface.update === "function") {
        waterSurface.update(dt);
      }
      for (var i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * 1.6;
        if (clouds[i].position.x > 750) clouds[i].position.x = -750;
      }
    };

    world.setQuality = function (q) {
      var sun = world.sun;
      if (!sun) return;
      if (q === 0) {
        sun.castShadow = false;
        return;
      }
      sun.castShadow = true;
      // Shadow map capped at 1024px for perf (was 2048 at HIGH). 1024 is
      // plenty for a single follow-light over a 95m frustum around the car.
      var sz = 1024;
      if (sun.shadow && sun.shadow.mapSize && sun.shadow.mapSize.x !== sz) {
        sun.shadow.mapSize.set(sz, sz);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
    };

    return world;
  };

  // Expose window.Track API for compatibility
  window.Track = {
    buildTrack: G.buildWorld,
    sampleTrack: function (worldOrTrack, idx) {
      var T =
        worldOrTrack && worldOrTrack.track ? worldOrTrack.track : worldOrTrack;
      if (!T || !T.pts) T = computeTrackData();
      var i = ((Math.floor(idx || 0) % T.S) + T.S) % T.S;
      return {
        point: T.pts[i],
        tangent: T.tan[i],
        side: T.side[i],
        index: i,
      };
    },
    closestTrackPoint: function (worldOrTrack, x, z, lastIdx) {
      if (worldOrTrack && typeof worldOrTrack.progress === "function") {
        return worldOrTrack.progress(x, z, lastIdx);
      }
      var T =
        worldOrTrack && worldOrTrack.pts ? worldOrTrack : computeTrackData();
      var best = 0,
        bd = Infinity;
      for (var i = 0; i < T.S; i++) {
        var dx = T.pts[i].x - x,
          dz = T.pts[i].z - z;
        var d2 = dx * dx + dz * dz;
        if (d2 < bd) {
          bd = d2;
          best = i;
        }
      }
      var P = T.pts[best],
        Sd = T.side[best];
      return {
        idx: best,
        lateral: (x - P.x) * Sd.x + (z - P.z) * Sd.z,
      };
    },
  };
})();
