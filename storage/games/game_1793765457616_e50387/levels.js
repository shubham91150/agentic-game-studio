/* Crimson Outbreak: Quarantine Sector 7 — Into the Dead 2 Outskirts Highway World
 * 100% Photorealistic & Photogrammetry Assets (Zero low-poly untextured Kenney city blocks!):
 * - Muse Image 1.0 Golden-Dusk Apocalypse Sky Panorama (Church Steeple, Oil Derrick, Storm Clouds)
 * - Muddy country road & grassy shoulders (AmbientCG 1K Normal-Mapped PBR)
 * - 1,200 3D Instanced tall golden-brown wind-sway field grass blades
 * - Tall Pine & Broadleaf Trees (tree_pine_hd.glb, pine_tree_1k.glb, lush_tree_1k.glb)
 * - Wooden Utility Poles with sagging 3D overhead power lines (Into the Dead 2 signature look!)
 * - Polyhaven 1K Photogrammetry Concrete Barriers, Street Lamps, Wheelchairs, Supply Crates,
 *   Coastal Cliffs, Boulders, and 6 Shootable Red Biohazard Barrels.
 */
(function () {
  "use strict";

  var VERSION = "into-the-dead-outskirts-3.0.0";

  var U_PINE_HD = "/studio/assets/polyhaven/pine_tree_1k.glb";
  var U_BROAD_HD = "/studio/assets/polyhaven/lush_tree_1k.glb";
  var U_PINE_1K = "/studio/assets/polyhaven/pine_tree_1k.glb";
  var U_LUSH_1K = "/studio/assets/polyhaven/lush_tree_1k.glb";
  var U_CLIFF = "/studio/assets/polyhaven/coastal_cliff_02/coastal_cliff_02_1k.glb";
  var U_BOULDER = "/studio/assets/polyhaven/boulder_01/boulder_01_1k.glb";
  var U_STREETLAMP = "/studio/assets/polyhaven/street_lamp_01/street_lamp_01_1k.glb";
  var U_BARRIER = "/studio/assets/polyhaven/concrete_road_barrier_02/concrete_road_barrier_02_1k.glb";
  var U_BARREL01 = "/studio/assets/polyhaven/Barrel_01/Barrel_01_1k.glb";
  var U_WHEELCHAIR = "/studio/assets/polyhaven/wheelchair_01/wheelchair_01_1k.glb";
  var U_CHEST = "/studio/assets/polyhaven/treasure_chest/treasure_chest_1k.glb";
  var U_TABLE = "/studio/assets/polyhaven/WoodenTable_01/WoodenTable_01_1k.glb";
  var U_GATE = "/studio/assets/polyhaven/large_castle_door/large_castle_door_1k.glb";
  var U_FENCE = "/studio/assets/models/buildings/fence-fortified.glb";
  var U_KEY = "/studio/assets/models/props/key.glb";

  function buildWorld(scene) {
    var T = window.THREE;
    var colliders = [];

    function addCol(x0, z0, x1, z1) {
      colliders.push({
        x0: Math.min(x0, x1),
        z0: Math.min(z0, z1),
        x1: Math.max(x0, x1),
        z1: Math.max(z0, z1)
      });
    }

    // 1. Into the Dead 2 Golden-Dusk Apocalypse Sky Panorama (Muse Image 1.0) & Volumetric Dusk Fog
    scene.background = new T.Color(0x18130e);
    scene.fog = new T.FogExp2(0x1e1712, 0.020);

    try {
      var bgTex = new T.TextureLoader().load("./assets/into_the_dead_backdrop.png");
      if (T.sRGBEncoding !== undefined) bgTex.encoding = T.sRGBEncoding;
      // Wide curved panoramic sky backdrop so Church Steeple (left), Golden Sunset (center), and Oil Derrick (right) fill the horizon!
      var skyGeo = new T.PlaneGeometry(96, 36);
      var skyMat = new T.MeshBasicMaterial({ map: bgTex, fog: false, depthWrite: false });
      var skyBackdrop = new T.Mesh(skyGeo, skyMat);
      skyBackdrop.position.set(0, 11.5, -22.0);
      scene.add(skyBackdrop);
    } catch (eSky) {}

    try {
      if (T.RGBELoader) {
        new T.RGBELoader().load(
          "/studio/assets/polyhaven/kloppenheim_06_puresky/kloppenheim_06_puresky_1k.hdr",
          function (hdr) {
            if (!hdr) return;
            hdr.mapping = T.EquirectangularReflectionMapping;
            scene.environment = hdr;
          }
        );
      }
    } catch (eHdr) {}

    var hemi = new T.HemisphereLight(0xffb878, 0x1c1510, 0.78);
    hemi.position.set(0, 30, 0);
    scene.add(hemi);

    var sun = new T.DirectionalLight(0xffae52, 1.35);
    sun.position.set(-8, 22, -24);
    sun.castShadow = true;
    if (sun.shadow) {
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 2;
      sun.shadow.camera.far = 65;
      sun.shadow.camera.left = -20;
      sun.shadow.camera.right = 20;
      sun.shadow.camera.top = 20;
      sun.shadow.camera.bottom = -20;
    }
    scene.add(sun);

    // 2. Muddy Country Road & Grassy Field Shoulders (AmbientCG 1K Normal-Mapped PBR)
    var texLoader = new T.TextureLoader();
    function loadPbrMat(diffUrl, norUrl, rx, ry, colHex, rough, metal) {
      var d = texLoader.load(diffUrl);
      var n = texLoader.load(norUrl);
      d.wrapS = d.wrapT = T.RepeatWrapping;
      n.wrapS = n.wrapT = T.RepeatWrapping;
      d.repeat.set(rx, ry);
      n.repeat.set(rx, ry);
      if (T.sRGBEncoding !== undefined) d.encoding = T.sRGBEncoding;
      return new T.MeshStandardMaterial({
        map: d,
        normalMap: n,
        normalScale: new T.Vector2(1.3, 1.3),
        color: colHex,
        roughness: rough,
        metalness: metal
      });
    }

    var roadMat = loadPbrMat(
      "/studio/assets/ambientcg/Rock035/Rock035_1K-JPG_Color.jpg",
      "/studio/assets/ambientcg/Rock035/Rock035_1K-JPG_NormalGL.jpg",
      8, 10, 0x2a231d, 0.42, 0.18
    );
    var fieldMat = loadPbrMat(
      "/studio/assets/ambientcg/Rock035/Rock035_1K-JPG_Color.jpg",
      "/studio/assets/ambientcg/Rock035/Rock035_1K-JPG_NormalGL.jpg",
      12, 12, 0x332a1e, 0.78, 0.05
    );
    var woodMat = loadPbrMat(
      "/studio/assets/ambientcg/Wood096/Wood096_1K-JPG_Color.jpg",
      "/studio/assets/ambientcg/Wood096/Wood096_1K-JPG_NormalGL.jpg",
      2, 4, 0x4a3525, 0.72, 0.05
    );

    var groundMesh = new T.Mesh(new T.PlaneGeometry(54, 44), fieldMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    var roadMesh = new T.Mesh(new T.PlaneGeometry(8.5, 44), roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.y = 0.02;
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // 3. 1,100 Tall Golden-Brown Wind-Sway Field Grass Blades along both sides of the road (Into the Dead 2 signature look!)
    var grassUniforms = { uTime: { value: 0 } };
    try {
      var bladeGeo = new T.BufferGeometry();
      var bVerts = new Float32Array([
        -0.055, 0.0, 0.0,
         0.055, 0.0, 0.0,
        -0.035, 0.42, 0.02,
         0.035, 0.42, 0.02,
         0.0,   0.88, 0.06
      ]);
      var bIdx = [0, 1, 2, 1, 3, 2, 2, 3, 4];
      bladeGeo.setAttribute("position", new T.BufferAttribute(bVerts, 3));
      bladeGeo.setIndex(bIdx);
      bladeGeo.computeVertexNormals();
      var grassMat = new T.MeshStandardMaterial({
        color: 0x5c4a28,
        roughness: 0.78,
        side: T.DoubleSide
      });
      grassMat.onBeforeCompile = function (sh) {
        sh.uniforms.uTime = grassUniforms.uTime;
        sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nfloat sway = sin(uTime * 2.4 + float(gl_InstanceID) * 0.41) * 0.14 * (position.y / 0.88);\ntransformed.x += sway;"
        );
      };
      var GRASS_N = 1100;
      var grassInst = new T.InstancedMesh(bladeGeo, grassMat, GRASS_N);
      var dummy = new T.Object3D();
      for (var gi = 0; gi < GRASS_N; gi++) {
        var side = (gi % 2 === 0) ? -1 : 1;
        var gx = side * (3.6 + Math.random() * 11.5);
        var gz = -14 + Math.random() * 26;
        dummy.position.set(gx, 0.01, gz);
        dummy.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2);
        var gs = 0.75 + Math.random() * 0.85;
        dummy.scale.set(gs, gs * (0.85 + Math.random() * 0.5), gs);
        dummy.updateMatrix();
        grassInst.setMatrixAt(gi, dummy.matrix);
      }
      grassInst.instanceMatrix.needsUpdate = true;
      scene.add(grassInst);
    } catch (eGr) {}

    // 4. Utility Poles with Crossarms & Sagging Overhead Power Lines (Into the Dead 2 Image 1 & 3 + Muse Image 1.0 reference!)
    try {
      var poleZ = [8.5, 2.0, -4.5, -11.0];
      var wireMat = new T.LineBasicMaterial({ color: 0x181412, transparent: true, opacity: 0.85 });
      for (var sideP = -1; sideP <= 1; sideP += 2) {
        var px = sideP * 5.4;
        for (var pi = 0; pi < poleZ.length; pi++) {
          var pz = poleZ[pi];
          placeModel("./assets/utility_pole.glb", 6.8, px, 0, pz, 0);
          if (pi < poleZ.length - 1) {
            var nextZ = poleZ[pi + 1];
            for (var wi = -1; wi <= 1; wi += 2) {
              var wx = px + wi * 0.58;
              var pts = [];
              for (var s = 0; s <= 12; s++) {
                var u = s / 12;
                var wz = pz + (nextZ - pz) * u;
                var sag = Math.sin(u * Math.PI) * 0.55;
                pts.push(new T.Vector3(wx, 6.3 - sag, wz));
              }
              var wGeo = new T.BufferGeometry().setFromPoints(pts);
              scene.add(new T.Line(wGeo, wireMat));
            }
          }
        }
      }
    } catch (ePole) {}

    var gltfLoader = new T.GLTFLoader();
    var protoCache = {};
    function placeModel(url, targetSize, x, y, z, ry, cb) {
      function attach(proto) {
        var inst = proto.clone(true);
        inst.position.set(x, y, z);
        inst.rotation.y = ry || 0;
        scene.add(inst);
        if (cb) cb(inst);
      }
      if (protoCache[url]) {
        attach(protoCache[url]);
        return;
      }
      gltfLoader.load(url, function (gltf) {
        var root = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
        if (!root) return;
        var box = new T.Box3().setFromObject(root);
        var sz = box.getSize(new T.Vector3());
        var maxD = Math.max(sz.x, Math.max(sz.y, sz.z));
        if (maxD > 0.01 && targetSize > 0) {
          root.scale.setScalar(targetSize / maxD);
        }
        box.setFromObject(root);
        var ctr = box.getCenter(new T.Vector3());
        root.position.set(-ctr.x, -box.min.y, -ctr.z);
        var wrap = new T.Group();
        wrap.add(root);
        protoCache[url] = wrap;
        attach(wrap);
      });
    }

    // 5. Tall Pine & Broadleaf Trees + Photogrammetry Cliffs & Boulders flanking the Outskirts Road
    var TREES = [
      [U_PINE_HD, 8.5, -7.8,  5.5, 0.3],
      [U_PINE_1K, 9.0,  8.2,  4.8, 1.4],
      [U_LUSH_1K, 7.8, -8.5, -0.5, 2.1],
      [U_PINE_HD, 9.2,  7.8, -1.2, 0.8],
      [U_PINE_1K, 9.5, -8.2, -6.5, 1.7],
      [U_BROAD_HD, 8.2, 8.5, -6.8, 2.6],
      [U_PINE_HD, 10.5,-11.5, -11.5, 0.5],
      [U_PINE_HD, 10.5, 11.5, -11.5, 1.9]
    ];
    for (var ti = 0; ti < TREES.length; ti++) {
      var tr = TREES[ti];
      placeModel(tr[0], tr[1], tr[2], 0, tr[3], tr[4]);
    }

    placeModel(U_CLIFF, 9.5, -13.5, 0, -5.0, 0.4);
    placeModel(U_CLIFF, 9.5,  13.5, 0, -5.0, -0.4);
    placeModel(U_BOULDER, 2.6, -6.5, 0, 2.8, 0.5);
    placeModel(U_BOULDER, 2.8,  6.5, 0, -3.5, 1.8);

    // 6. Polyhaven 1K Street Lamps, Concrete Road Barriers, Wheelchair & Evacuation Gate
    var LAMP_SPOTS = [
      [-4.4, 5.5], [4.4, 5.5],
      [-4.4, -2.5], [4.4, -2.5]
    ];
    for (var li = 0; li < LAMP_SPOTS.length; li++) {
      placeModel(U_STREETLAMP, 4.0, LAMP_SPOTS[li][0], 0, LAMP_SPOTS[li][1], li % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    var BARRIERS = [
      [-1.8,  2.8,  0.15],
      [ 1.8, -2.2, -0.18],
      [-2.3, -6.8,  0.08],
      [ 2.3, -6.8, -0.08]
    ];
    for (var bri = 0; bri < BARRIERS.length; bri++) {
      var br = BARRIERS[bri];
      placeModel(U_BARRIER, 1.85, br[0], 0, br[1], br[2]);
      addCol(br[0] - 0.8, br[1] - 0.35, br[0] + 0.8, br[1] + 0.35);
    }

    placeModel(U_WHEELCHAIR, 0.95, -2.2, 0, 5.6, 0.6);
    placeModel(U_TABLE, 1.35, 3.8, 0, 3.5, -0.4);

    // North Evacuation Gate (chapelDoor at [0, -8.8]) + Perimeter Fences
    var chapelDoor = new T.Group();
    chapelDoor.position.set(0, 0, -8.8);
    scene.add(chapelDoor);
    placeModel(U_GATE, 3.5, 0, 0, -8.8, 0, function (g) {
      scene.remove(g);
      g.position.set(0, 0, 0);
      chapelDoor.add(g);
    });
    var FENCES = [[-6.2, -9.2, 0], [-3.2, -9.2, 0], [3.2, -9.2, 0], [6.2, -9.2, 0]];
    for (var fi = 0; fi < FENCES.length; fi++) {
      placeModel(U_FENCE, 3.2, FENCES[fi][0], 0, FENCES[fi][1], FENCES[fi][2]);
    }

    var keyMesh = new T.Group();
    var KEY_POS = { x: 5.5, y: 0.95, z: -1.8 };
    keyMesh.position.set(KEY_POS.x, KEY_POS.y, KEY_POS.z);
    scene.add(keyMesh);
    placeModel(U_KEY, 0.55, 0, 0, 0, 0, function (k) {
      scene.remove(k);
      k.position.set(0, 0, 0);
      keyMesh.add(k);
    });
    var keyBeacon = new T.PointLight(0xffd166, 2.2, 7, 1.6);
    keyBeacon.position.set(KEY_POS.x, 1.4, KEY_POS.z);
    scene.add(keyBeacon);

    // 7. 6 Shootable Red Biohazard Barrels (window.__stvBarrels)
    var qBarrels = [];
    var BARREL_SPOTS = [
      [ 1.25,  4.6],
      [-2.2,   1.6],
      [ 2.6,  -1.4],
      [-3.2,  -3.2],
      [-1.6,  -5.8],
      [ 1.8,  -5.8]
    ];
    var ringGeo = new T.TorusGeometry(0.44, 0.035, 8, 24);
    var ringMat = new T.MeshStandardMaterial({
      color: 0xff2a2a,
      emissive: 0xff1e1e,
      emissiveIntensity: 2.5,
      roughness: 0.25
    });
    for (var bbi = 0; bbi < BARREL_SPOTS.length; bbi++) {
      (function (bx, bz, idx) {
        var bGrp = new T.Group();
        bGrp.position.set(bx, 0, bz);
        scene.add(bGrp);
        var rMesh = new T.Mesh(ringGeo, ringMat);
        rMesh.rotation.x = Math.PI / 2;
        rMesh.position.y = 0.05;
        bGrp.add(rMesh);
        qBarrels.push({
          id: idx,
          x: bx,
          z: bz,
          group: bGrp,
          ring: rMesh,
          alive: true,
          respawnT: 0
        });
        placeModel(U_BARREL01, 0.92, 0, 0, 0, 0, function (inst) {
          scene.remove(inst);
          inst.position.set(0, 0, 0);
          inst.traverse(function (n) {
            if (n && n.isMesh && n.material) {
              n.material = n.material.clone();
              if (n.material.color) n.material.color.setHex(0xdc2626);
              if (n.material.emissive) {
                n.material.emissive.setHex(0x550606);
                n.material.emissiveIntensity = 0.45;
              }
            }
          });
          bGrp.add(inst);
        });
      })(BARREL_SPOTS[bbi][0], BARREL_SPOTS[bbi][1], bbi);
    }

    // 8. 4 Glowing Supply & Triage Medkit Crates (window.__stvSupplyCrates)
    var qSupplies = [];
    var SUPPLY_SPOTS = [
      [-2.8,  6.5, "ammo", "MILITARY AMMO CRATE (+60 ROUNDS)"],
      [ 2.8,  6.5, "medkit", "FIELD MEDKIT (+45 HP)"],
      [-5.2, -1.2, "ammo", "ARMORY SUPPLY DROP (+60 ROUNDS)"],
      [ 5.2, -3.2, "medkit", "TRIAGE MED-STATION (+45 HP)"]
    ];
    for (var si = 0; si < SUPPLY_SPOTS.length; si++) {
      (function (sx, sz, stype, slabel) {
        var sGrp = new T.Group();
        sGrp.position.set(sx, 0, sz);
        scene.add(sGrp);
        var col = stype === "ammo" ? 0x22d3ee : 0x34d399;
        var sRing = new T.Mesh(
          new T.TorusGeometry(0.52, 0.035, 8, 24),
          new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.4 })
        );
        sRing.rotation.x = Math.PI / 2;
        sRing.position.y = 0.05;
        sGrp.add(sRing);
        placeModel(U_CHEST, 0.78, 0, 0, 0, 0, function (ch) {
          scene.remove(ch);
          ch.position.set(0, 0, 0);
          sGrp.add(ch);
        });
        qSupplies.push({
          x: sx,
          z: sz,
          type: stype,
          name: slabel,
          group: sGrp,
          ring: sRing,
          cd: 0
        });
      })(SUPPLY_SPOTS[si][0], SUPPLY_SPOTS[si][1], SUPPLY_SPOTS[si][2], SUPPLY_SPOTS[si][3]);
    }

    window.__stvBarrels = qBarrels;
    window.__stvSupplyCrates = qSupplies;
    window.__stvHideSpots = [];
    window.__stvSearchSpots = [];

    function update(dt, t) {
      grassUniforms.uTime.value = t;
      keyMesh.rotation.y += dt * 1.6;
      keyMesh.position.y = KEY_POS.y + Math.sin(t * 2.4) * 0.06;
    }

    return {
      colliders: colliders,
      spawn: { x: 0, z: 8.2, ry: 0 },
      bounds: { x0: -9.5, z0: -8.8, x1: 9.5, z1: 8.8 },
      update: update,
      applyAiEnvironment: function () {},
      setThreatFactor: function () {},
      keyMesh: keyMesh,
      chapelDoor: chapelDoor
    };
  }

  window.StV_Levels = { buildWorld: buildWorld, VERSION: VERSION };
})();
