/* Horizon Sprint — enemies.js
 * AI rival drivers: waypoint chase, curve speed control, rubber-banding,
 * avoidance + hairpin drifts. Uses the shared car physics from player.js. */
(function () {
  window.G = window.G || {};
  var G = window.G;

  G.AI_DEFS = [
    {
      name: "APEX",
      color: "255,122,26",
      lane: -2.6,
      skill: 0.97,
      num: 11,
      modelUrl: "/studio/assets/polyhaven/supercar_highpoly.glb",
    },
    {
      name: "BOLT",
      color: "23,195,178",
      lane: 2.6,
      skill: 0.94,
      num: 23,
      modelUrl: "/studio/assets/polyhaven/supercar_highpoly.glb",
    },
    {
      name: "VEX",
      color: "232,232,232",
      lane: 0.2,
      skill: 0.91,
      num: 5,
      modelUrl: "/studio/assets/polyhaven/ToyCar.glb",
    },
  ];

  G.createAI = function (world, def, slot) {
    var car = G.createCar(world, {
      color: def.color,
      name: def.name,
      isPlayer: false,
      num: def.num,
      modelUrl: def.modelUrl,
    });
    G.placeCarOnGrid(car, world, slot);
    car.ai = {
      lane: def.lane,
      skill: def.skill,
      avoid: 0,
      wob: Math.random() * 6.28,
    };
    return car;
  };

  // playerCar only for rubber-band reference; cars = all cars for avoidance.
  G.updateAI = function (car, dt, world, raceTime, playerCar, cars, fx) {
    var T = world.track,
      S = T.S;
    var ai = car.ai;
    var spd = Math.abs(car.speed);

    // lookahead target with lane offset
    var la = Math.floor(9 + spd * 0.42);
    var ti = (car.idx + la) % S;
    var lane = ai.lane + ai.avoid;
    lane = Math.max(-(T.roadHalf - 1.6), Math.min(T.roadHalf - 1.6, lane));
    var TP = T.pts[ti],
      TSd = T.side[ti];
    var tx = TP.x + TSd.x * lane,
      tz = TP.z + TSd.z * lane;
    var want = Math.atan2(tx - car.x, tz - car.z);
    var diff = G.angWrap(want - car.angle);
    car.input.steer = Math.max(-1, Math.min(1, diff * 2.4));

    // curve speed: angle between now-tangent and ahead-tangent
    var t0 = T.tan[car.idx],
      t1 = T.tan[(car.idx + 26) % S];
    var curve = Math.acos(Math.max(-1, Math.min(1, t0.x * t1.x + t0.z * t1.z)));
    var target = 60 * ai.skill * (1 - Math.min(1, curve * 2.6) * 0.58);

    // rubber band vs player (meters-ish via score delta)
    var gap = playerCar.lap * S + playerCar.idx - (car.lap * S + car.idx);
    target += Math.max(-6, Math.min(7, gap * 0.03));

    // avoidance: car ahead in my corridor?
    var wantAvoid = 0;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car) continue;
      var ox = o.x - car.x,
        oz = o.z - car.z;
      var dist = Math.sqrt(ox * ox + oz * oz);
      if (dist > 11 || dist < 0.5) continue;
      var oa = G.angWrap(Math.atan2(ox, oz) - car.angle);
      if (Math.abs(oa) < 0.42 && spd > 8) {
        var sideSign =
          ox * Math.cos(car.angle) - oz * Math.sin(car.angle) > 0 ? -1 : 1;
        wantAvoid = sideSign * 2.6;
        if (dist < 6) target = Math.min(target, Math.abs(o.speed) + 2);
        break;
      }
    }
    ai.avoid += (wantAvoid - ai.avoid) * Math.min(1, 3 * dt);

    // hairpin drift
    car.input.hand = Math.abs(diff) > 0.75 && spd > 26;
    if (car.input.hand) target = Math.min(target, 34);

    if (spd < target) car.input.throttle = 1;
    else if (spd > target + 5) car.input.throttle = -0.5;
    else car.input.throttle = 0.15;

    // AI nitro on straights when behind
    car.input.nitro = curve < 0.08 && gap > 40 && car.nitro > 40 && spd > 20;

    return G.updateCar(car, dt, world, raceTime, fx);
  };
})();
