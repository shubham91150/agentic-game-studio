/* Horizon Sprint — player.js
 * Real GLTF (.glb) sports car & rival vehicles via WorldRealism.loadGlbModel
 * + arcade-sim physics (shared by player & AI). */
(function () {
  "use strict";
  window.G = window.G || {};
  var G = window.G;

  var PLAYER_MODEL_URL = "/studio/assets/polyhaven/supercar_highpoly.glb";
  var AI_MODEL_URLS = [
    "/studio/assets/polyhaven/supercar_highpoly.glb",
    "/studio/assets/polyhaven/ToyCar.glb",
    "/studio/assets/polyhaven/supercar_highpoly.glb",
  ];
  var CB_COLORS = ["0,114,178", "230,159,0", "240,228,66"];

  function angWrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  G.angWrap = angWrap;

  var FLAMETEX = null;
  function ensureFlameTex() {
    if (FLAMETEX) return FLAMETEX;
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var x = c.getContext("2d");
    var g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(120,220,255,0.9)");
    g.addColorStop(1, "rgba(40,120,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    FLAMETEX = new THREE.CanvasTexture(c);
    return FLAMETEX;
  }

  var ROUNDEL = {};
  function roundelTex(num) {
    if (ROUNDEL[num]) return ROUNDEL[num];
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var x = c.getContext("2d");
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = "#f4f4f4";
    x.beginPath();
    x.arc(64, 64, 58, 0, 7);
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "#141414";
    x.stroke();
    x.fillStyle = "#141414";
    x.font = "italic 900 64px Arial";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(String(num), 64, 68);
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    ROUNDEL[num] = t;
    return t;
  }

  G.createCarMesh = function (rgbStr, num, modelUrl) {
    ensureFlameTex();
    var paint = new THREE.MeshStandardMaterial({
      color: "rgb(" + (rgbStr || "210,31,38") + ")",
      roughness: 0.2,
      metalness: 0.75,
      envMapIntensity: 1.5,
    });
    if (G.roughTex) paint.roughnessMap = G.roughTex;

    var tailMat = new THREE.MeshStandardMaterial({
      color: 0x550000,
      emissive: 0xff1a1a,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.2,
    });

    var grp = new THREE.Group();
    var steers = [];
    var spinners = [];
    var flames = [];

    [-0.45, 0.45].forEach(function (fx) {
      var sm = new THREE.SpriteMaterial({
        map: FLAMETEX,
        transparent: true,
        depthWrite: false,
      });
      var s = new THREE.Sprite(sm);
      s.position.set(fx, 0.42, -2.35);
      s.scale.set(0.7, 1.0, 1);
      s.visible = false;
      grp.add(s);
      flames.push(s);
    });

    var chosenUrl = modelUrl || PLAYER_MODEL_URL;
    if (
      window.WorldRealism &&
      typeof window.WorldRealism.loadGlbModel === "function"
    ) {
      window.WorldRealism.loadGlbModel(
        chosenUrl,
        function (modelRoot) {
          var wheelNodes = [];
          modelRoot.traverse(function (node) {
            if (!node) return;
            var nm = (node.name || "").toLowerCase();
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              if (nm === "body" || nm === "spoiler") {
                node.material = paint;
              } else if (nm === "toycar" && node.material) {
                var tcMat = node.material.clone();
                if (rgbStr) {
                  var parts = String(rgbStr).split(",");
                  if (parts.length === 3) {
                    var r = Math.min(
                      1.3,
                      (parseFloat(parts[0]) / 255) * 1.05 + 0.15,
                    );
                    var g = Math.min(
                      1.3,
                      (parseFloat(parts[1]) / 255) * 1.05 + 0.15,
                    );
                    var b = Math.min(
                      1.3,
                      (parseFloat(parts[2]) / 255) * 1.05 + 0.15,
                    );
                    tcMat.color.setRGB(r, g, b);
                  }
                }
                tcMat.envMapIntensity = 1.65;
                node.material = tcMat;
              }
              if (nm.indexOf("wheel-") === 0) {
                wheelNodes.push(node);
              }
            }
          });

          for (var wi = 0; wi < wheelNodes.length; wi++) {
            var wNode = wheelNodes[wi];
            var wName = (wNode.name || "").toLowerCase();
            if (wName.indexOf("front") !== -1 && wNode.parent) {
              var steerPivot = new THREE.Group();
              steerPivot.position.copy(wNode.position);
              steerPivot.rotation.copy(wNode.rotation);
              steerPivot.scale.copy(wNode.scale);
              wNode.parent.add(steerPivot);
              wNode.position.set(0, 0, 0);
              wNode.rotation.set(0, 0, 0);
              wNode.scale.set(1, 1, 1);
              steerPivot.add(wNode);
              steers.push(steerPivot);
              spinners.push(wNode);
            } else {
              spinners.push(wNode);
            }
          }

          grp.add(modelRoot);

          var box = new THREE.Box3().setFromObject(modelRoot);
          var topY = box.isEmpty() ? 1.35 : box.max.y + 0.01;
          var rd = new THREE.Mesh(
            new THREE.PlaneGeometry(0.72, 0.72),
            new THREE.MeshBasicMaterial({
              map: roundelTex(num || 7),
              transparent: true,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            }),
          );
          rd.rotation.x = -Math.PI / 2;
          rd.position.set(0, topY, 0.15);
          rd.renderOrder = 3;
          grp.add(rd);
        },
        {
          targetLength: 4.4,
          envMapIntensity: 1.5,
          castShadow: true,
          receiveShadow: true,
        },
      ).catch(function () {});
    }

    return {
      group: grp,
      position: grp.position,
      steers: steers,
      spinners: spinners,
      tailMat: tailMat,
      flames: flames,
      paint: paint,
    };
  };

  var aiCreateCount = 0;
  G.createCar = function (world, opts) {
    var o = opts || {};
    var modelUrl = o.modelUrl;
    if (!modelUrl) {
      if (o.isPlayer) {
        modelUrl = PLAYER_MODEL_URL;
      } else {
        modelUrl = AI_MODEL_URLS[aiCreateCount % AI_MODEL_URLS.length];
        aiCreateCount++;
      }
    }
    var mb = G.createCarMesh(o.color, o.num, modelUrl);
    var car = {
      name: o.name || "CAR",
      isPlayer: !!o.isPlayer,
      modelUrl: modelUrl,
      mesh: mb,
      group: mb.group,
      x: 0,
      y: 0,
      z: 0,
      angle: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      steerVis: 0,
      spinVis: 0,
      idx: -1,
      lateral: 0,
      lap: 1,
      nextGate: 1,
      finished: false,
      finishScore: 0,
      lapStart: 0,
      lastLap: null,
      bestLap: null,
      nitro: 60,
      nitroActive: false,
      drifting: false,
      offroad: false,
      scraping: false,
      wrongWay: false,
      wwAcc: 0,
      wwTimer: 0,
      prevIdx: -1,
      input: { throttle: 0, steer: 0, hand: false, nitro: false },
      sens: 1,
    };
    if (world && world.scene) {
      world.scene.add(car.group);
    }
    return car;
  };

  G.placeCarOnGrid = function (car, world, slot) {
    var pose = world.startPose(slot);
    car.x = pose.x;
    car.z = pose.z;
    car.y = world.getTerrainHeight ? world.getTerrainHeight(car.x, car.z) : 0;
    car.angle = pose.angle;
    car.vx = 0;
    car.vz = 0;
    car.speed = 0;
    car.idx = pose.idx;
    car.prevIdx = pose.idx;
    car.lateral = 0;
    car.lap = 1;
    car.nextGate = 1;
    car.finished = false;
    car.lastLap = null;
    car.bestLap = null;
    car.nitro = 60;
    car.wrongWay = false;
    car.wwAcc = 0;
    car.group.position.set(car.x, car.y, car.z);
    car.group.rotation.y = car.angle;
  };

  G.getHeadingVector = function (carOrAngle) {
    var a =
      typeof carOrAngle === "number"
        ? carOrAngle
        : carOrAngle && typeof carOrAngle.angle === "number"
          ? carOrAngle.angle
          : 0;
    return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  };

  G.paintAIs = function (ais, colorblind, aiDefs) {
    if (!Array.isArray(ais)) return;
    var defs = aiDefs || G.AI_DEFS || [];
    for (var i = 0; i < ais.length; i++) {
      var c = colorblind
        ? CB_COLORS[i % CB_COLORS.length]
        : defs[i % defs.length]
          ? defs[i % defs.length].color
          : "230,159,0";
      if (ais[i] && ais[i].mesh && ais[i].mesh.paint) {
        ais[i].mesh.paint.color.set("rgb(" + c + ")");
      }
    }
  };

  G.resolveCars = function (cars, onPlayerImpact) {
    if (!Array.isArray(cars)) return;
    for (var i = 0; i < cars.length; i++) {
      for (var j = i + 1; j < cars.length; j++) {
        var a = cars[i],
          b = cars[j];
        var dx = b.x - a.x,
          dz = b.z - a.z;
        var d2 = dx * dx + dz * dz;
        if (d2 > 8.4 || d2 < 1e-6) continue;
        var d = Math.sqrt(d2),
          nx = dx / d,
          nz = dz / d;
        var overlap = 2.9 - d;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;
        var rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          var imp = -rel * 0.55;
          a.vx -= nx * imp;
          a.vz -= nz * imp;
          b.vx += nx * imp;
          b.vz += nz * imp;
          a.speed *= 0.97;
          b.speed *= 0.97;
          if (
            (a.isPlayer || b.isPlayer) &&
            -rel > 6 &&
            typeof onPlayerImpact === "function"
          ) {
            onPlayerImpact(-rel);
          }
        }
      }
    }
  };

  // Returns event flags consumed by game.js (gate/lap). fx collects trauma.
  G.updateCar = function (car, dt, world, raceTime, fx) {
    var ev = 0; // 1=gate, 2=lap
    var inp = car.input;
    var T = world.track;
    var maxSp = 62,
      accel = 24;
    car.nitroActive = inp.nitro && car.nitro > 0 && car.speed > 5;
    if (car.nitroActive) {
      maxSp = 78;
      accel = 34;
      car.nitro = Math.max(0, car.nitro - 32 * dt);
    }
    if (inp.throttle > 0) {
      car.speed += accel * inp.throttle * dt;
      if (car.speed > maxSp)
        car.speed += (maxSp - car.speed) * Math.min(1, 3 * dt);
    } else if (inp.throttle < 0) {
      if (car.speed > 1) car.speed += 44 * inp.throttle * dt;
      else car.speed = Math.max(-12, car.speed + 14 * inp.throttle * dt);
    } else {
      car.speed -= car.speed * 0.28 * dt;
      if (Math.abs(car.speed) < 0.4) car.speed = 0;
    }
    car.speed -= car.speed * 0.12 * dt;

    var spd = Math.abs(car.speed),
      speed01 = Math.min(1, spd / 62);
    var dirSign = car.speed >= 0 ? 1 : -1;
    var steer = Math.max(-1, Math.min(1, inp.steer * car.sens));
    var yawBase = 2.5 - 1.35 * speed01;
    if (inp.hand) yawBase *= 1.7;
    car.angle += steer * yawBase * dirSign * dt * Math.min(1, spd / 6 + 0.25);

    var fx0 = Math.sin(car.angle),
      fz0 = Math.cos(car.angle);
    var grip = inp.hand ? 1.5 : 7.5;
    if (car.offroad) grip = Math.min(grip, 4.2);
    var k = Math.min(1, grip * dt);
    car.vx += (fx0 * car.speed - car.vx) * k;
    car.vz += (fz0 * car.speed - car.vz) * k;
    car.x += car.vx * dt;
    car.z += car.vz * dt;

    // track projection + barriers
    var pr = world.progress(car.x, car.z, car.idx);
    car.idx = pr.idx;
    car.offroad = Math.abs(pr.lateral) > T.roadHalf + 0.4;
    if (car.offroad && spd > 30)
      car.speed += (30 - car.speed) * Math.min(1, 2.2 * dt);
    car.scraping = false;
    if (Math.abs(pr.lateral) > T.barrierLateral) {
      var s = pr.lateral > 0 ? 1 : -1;
      var P = T.pts[car.idx],
        Sd = T.side[car.idx];
      car.x = P.x + Sd.x * s * T.barrierLateral;
      car.z = P.z + Sd.z * s * T.barrierLateral;
      var vn = car.vx * Sd.x + car.vz * Sd.z;
      car.vx -= Sd.x * vn * 1.4;
      car.vz -= Sd.z * vn * 1.4;
      pr = world.progress(car.x, car.z, car.idx);
      car.idx = pr.idx;
      car.speed *=
        1 - Math.min(0.9, 2.0 * dt) * Math.min(1, Math.abs(vn) / 10 + 0.25);
      car.scraping = true;
      if (Math.abs(vn) > 9 && fx)
        fx.trauma = Math.min(1, (fx.trauma || 0) + 0.45);
    }
    car.lateral = pr.lateral;

    // gates + laps
    var S = T.S;
    if (!car.finished) {
      var g = T.gates[car.nextGate];
      var dd = Math.abs(car.idx - g);
      dd = Math.min(dd, S - dd);
      if (dd < 20) {
        if (car.nextGate === 0) {
          var lt = raceTime - car.lapStart;
          car.lastLap = lt;
          if (!car.bestLap || lt < car.bestLap) car.bestLap = lt;
          car.lap++;
          ev = 2;
          if (car.lap > 3) {
            car.finished = true;
          } else car.nextGate = 1;
        } else {
          car.nextGate++;
          if (car.nextGate > 7) car.nextGate = 0;
          ev = 1;
        }
      }
    }

    // wrong way
    if (car.prevIdx >= 0) {
      var dIdx = car.idx - car.prevIdx;
      if (dIdx > S / 2) dIdx -= S;
      if (dIdx < -S / 2) dIdx += S;
      car.wwAcc += dIdx;
      car.wwTimer += dt;
      if (car.wwTimer > 1.0) {
        car.wrongWay = car.wwAcc < -4 && spd > 5;
        car.wwAcc = 0;
        car.wwTimer = 0;
      }
    }
    car.prevIdx = car.idx;

    // visuals
    car.steerVis += (steer - car.steerVis) * Math.min(1, 12 * dt);
    car.spinVis += (car.speed / 0.36) * dt;
    var mb = car.mesh,
      i;
    for (i = 0; i < mb.steers.length; i++)
      mb.steers[i].rotation.y = car.steerVis * 0.5;
    for (i = 0; i < mb.spinners.length; i++)
      mb.spinners[i].rotation.x = car.spinVis;
    mb.tailMat.emissiveIntensity = inp.throttle < 0 ? 2.2 : 0.7;
    car.drifting = inp.hand && spd > 14 && Math.abs(steer) > 0.2;
    var fl = car.nitroActive && spd > 5;
    for (i = 0; i < mb.flames.length; i++) {
      mb.flames[i].visible = fl;
      if (fl) {
        var fs = 0.8 + Math.random() * 0.5;
        mb.flames[i].scale.set(0.7 * fs, 1.1 * fs, 1);
      }
    }
    car.y = world.getTerrainHeight ? world.getTerrainHeight(car.x, car.z) : 0;
    car.group.position.set(car.x, car.y, car.z);
    car.group.rotation.y = car.angle;
    car.group.rotation.z = -car.steerVis * Math.min(1, spd / 40) * 0.06;
    return ev;
  };

  G.resetCarToTrack = function (car, world) {
    var T = world.track;
    var i = car.idx < 0 ? 0 : car.idx;
    var P = T.pts[i],
      Tn = T.tan[i];
    car.x = P.x;
    car.z = P.z;
    car.y = 0;
    car.angle = Math.atan2(Tn.x, Tn.z);
    car.vx = 0;
    car.vz = 0;
    car.speed = 0;
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.angle;
  };

  G.raceScore = function (car) {
    return (
      (car.finished ? 1e9 - (car.finishScore || 0) : 0) +
      car.lap * 1e6 +
      car.nextGate * 1e4 +
      car.idx
    );
  };

  window.CarPlayer = {
    createCar: G.createCar,
    createCarMesh: G.createCarMesh,
    placeCarOnGrid: G.placeCarOnGrid,
    updateCar: G.updateCar,
    resolveCars: G.resolveCars,
    getHeadingVector: G.getHeadingVector,
    paintAIs: G.paintAIs,
    resetCarToTrack: G.resetCarToTrack,
    raceScore: G.raceScore,
  };
})();
