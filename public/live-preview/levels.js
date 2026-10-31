/* Horizon Sprint — levels.js
 * World builder: closed Catmull-Rom circuit, WorldRealism shader sky + PMREM IBL,
 * Sobel normal-mapped PBR road/kerbs/terrain, 30,000+ 3D wind-swaying grass blades,
 * and real GLTF (.glb) trackside scenery (trees, palms, rocks, boulders, buildings,
 * tents, street lights, and concrete barriers). */
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

  var CTRL = [
    [0, -150],
    [80, -148],
    [140, -110],
    [160, -50],
    [120, -10],
    [130, 50],
    [90, 95],
    [100, 150],
    [30, 170],
    [-50, 150],
    [-120, 160],
    [-170, 110],
    [-150, 40],
    [-165, -30],
    [-120, -90],
    [-60, -120],
  ];
  var SAMPLES = 600,
    ROAD_HALF = 6;

  function computeTrackData() {
    var curve = new THREE.CatmullRomCurve3(
      CTRL.map(function (p) {
        return new THREE.Vector3(p[0], 0, p[1]);
      }),
      true,
      "catmullrom",
      0.5,
    );
    var raw = curve.getSpacedPoints(SAMPLES);
    raw.pop();
    var S = raw.length,
      pts = raw,
      tan = [],
      side = [],
      cum = [0];
    for (var i = 0; i < S; i++) {
      var a = pts[(i - 1 + S) % S],
        b = pts[(i + 1) % S];
      var t = new THREE.Vector3().subVectors(b, a).normalize();
      tan.push(t);
      side.push(new THREE.Vector3(-t.z, 0, t.x));
      if (i > 0) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
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
    var rim = Math.max(0, (radial - 220) * 0.095);
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

    var DF_SIZE = 180;
    var DF_EXTENT = 900;
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

    function isOnTrack(x, z) {
      return fastTrackDist(x, z) < ROAD_HALF + 3.8;
    }

    function getTerrainHeight(x, z) {
      var d = fastTrackDist(x, z);
      var flatEdge = ROAD_HALF + 5.0;
      var blendSpan = 28.0;
      if (d <= flatEdge) return 0.0;
      var t = Math.min(1.0, (d - flatEdge) / blendSpan);
      var smooth = t * t * (3.0 - 2.0 * t);
      return Math.max(0.0, multiOctaveHeight(x, z) * smooth);
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
        var v = (i < S ? cum[i] : totalLen) / vScale;
        pos.set(
          [
            P.x + Sd.x * inner,
            y,
            P.z + Sd.z * inner,
            P.x + Sd.x * outer,
            y,
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
      var gridN = 96;
      var extent = 900;
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

    // 5. 35,000 3-Blade Crossed Grass Tufts (105,000 3D Wind-Swaying Blades) via WorldRealism.create3DGrassField
    var grassField = WR.create3DGrassField(scene, {
      count: 35000,
      radius: 95,
      spread: 380,
      bladeHeight: 0.72,
      bladeWidth: 0.18,
      excludeFn: isOnTrack,
      heightFn: getTerrainHeight,
      sampleFn: function (attempt, u1, u2) {
        // Focus grass density near road verges and camera (distance 8m to 95m from track)
        var idx;
        if (attempt % 10 < 7) {
          // 70% concentrated along visible main straight & first corners (S-80 to +160)
          var span = 240;
          idx = (S - 80 + Math.floor(u1 * span)) % S;
        } else {
          idx = Math.floor(u1 * S) % S;
        }
        var P = pts[idx],
          Sd = side[idx],
          Tn = tan[idx];
        var sideSign = attempt % 2 === 0 ? 1 : -1;
        var latDist = 8.0 + Math.pow(u2, 2.35) * 87.0;
        var alongJitter = (((attempt * 0.6180339887) % 1.0) - 0.5) * 6.5;
        var wx = P.x + Sd.x * (sideSign * latDist) + Tn.x * alongJitter;
        var wz = P.z + Sd.z * (sideSign * latDist) + Tn.z * alongJitter;
        return [wx, wz];
      },
    });
    world.grassField = grassField;

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
        var cx = P.x + Sd.x * lat,
          cz = P.z + Sd.z * lat;
        var hx = Sd.x * 1.6,
          hz = Sd.z * 1.6,
          lx = T.x * 3.5,
          lz = T.z * 3.5;
        pos.set(
          [
            cx - hx - lx,
            0.04,
            cz - hz - lz,
            cx + hx - lx,
            0.04,
            cz + hz - lz,
            cx + hx + lx,
            0.04,
            cz + hz + lz,
            cx - hx + lx,
            0.04,
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
    lh.position.y = 0.045;
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

      // Polyhaven photogrammetry Jacaranda leafy trees: /studio/assets/polyhaven/jacaranda_tree/jacaranda_tree_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/jacaranda_tree/jacaranda_tree_1k.glb",
        function (treeProto) {
          treeProto.traverse(function (n) {
            if (n && n.isMesh && n.material) {
              var mats = Array.isArray(n.material) ? n.material : [n.material];
              for (var mi = 0; mi < mats.length; mi++) {
                if (
                  mats[mi] &&
                  (mats[mi].name || "").toLowerCase().indexOf("leaves") !== -1
                ) {
                  mats[mi].alphaTest = 0.45;
                  mats[mi].transparent = false;
                  mats[mi].depthWrite = true;
                  mats[mi].side = THREE.DoubleSide;
                  mats[mi].needsUpdate = true;
                }
              }
            }
          });
          var treeSpots = [
            { idx: S - 36, lat: -15, yawOffset: 0.4, scale: 1.15 },
            { idx: S - 24, lat: 15.5, yawOffset: 1.9, scale: 1.2 },
            { idx: S - 10, lat: -16, yawOffset: 3.1, scale: 1.1 },
            { idx: 8, lat: 16, yawOffset: 0.8, scale: 1.15 },
            { idx: 22, lat: -16.5, yawOffset: 2.4, scale: 1.25 },
          ];
          for (var i = 60; i < S - 60; i += 55) {
            var sideSign = i % 110 === 0 ? 1 : -1;
            var dist = 16 + ((i * 37) % 18);
            var sc = 0.9 + ((i * 19) % 8) * 0.08;
            treeSpots.push({
              idx: i,
              lat: sideSign * dist,
              yawOffset: (i * 1.3) % 6.28,
              scale: sc,
            });
          }
          placeAlongTrack(treeProto, treeSpots, true);
        },
        { targetLength: 11.5, envMapIntensity: 1.15, castShadow: false },
      ).catch(function () {});

      // Polyhaven photogrammetry Quiver trees: /studio/assets/polyhaven/quiver_tree_02/quiver_tree_02_1k.glb
      WR.loadGlbModel(
        "/studio/assets/polyhaven/quiver_tree_02/quiver_tree_02_1k.glb",
        function (quiverProto) {
          var quiverSpots = [];
          for (var i = 12; i < S; i += 40) {
            var sideSign = i % 80 < 40 ? -1 : 1;
            var dist = 14 + ((i * 23) % 16);
            quiverSpots.push({
              idx: i,
              lat: sideSign * dist,
              yawOffset: (i * 0.9) % 6.28,
              scale: 0.92 + ((i * 11) % 5) * 0.08,
            });
          }
          placeAlongTrack(quiverProto, quiverSpots, true);
        },
        { targetLength: 8.2, envMapIntensity: 1.15, castShadow: false },
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
    for (var ci2 = 0; ci2 < 12; ci2++) {
      var sm = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        fog: false,
      });
      var sp = new THREE.Sprite(sm);
      var ca = Math.random() * Math.PI * 2,
        cr2 = 200 + Math.random() * 320;
      sp.position.set(
        Math.cos(ca) * cr2,
        100 + Math.random() * 70,
        Math.sin(ca) * cr2,
      );
      var ssc = 70 + Math.random() * 70;
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
      if (grassField && typeof grassField.update === "function") {
        grassField.update(dt, playerPos);
      }
      for (var i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * 1.6;
        if (clouds[i].position.x > 550) clouds[i].position.x = -550;
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
      var sz = q === 1 ? 1024 : 2048;
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
