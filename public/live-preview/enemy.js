/* Ashes of St. Vermilion — Mother Agatha enemy AI (Stage 2).
 * window.StV_Enemy = { create(scene, colliders, bounds, player) ->
 *   { update(dt,t,playerState), getState(), reset(), setAlert(level),
 *     onCaught(cb) } }
 * HFSM: superstate Active owns {PATROL, SUSPICIOUS, CHASE, SEARCH} with
 * shared per-tick senses/suspicion/steering/watchdog; CAUGHT is a pushed
 * one-way interrupt (fires onCaught once, then frozen until reset()).
 * Speeds (m/s, Normal): PATROL 2.0 / SUSPICIOUS 3.0 / CHASE 4.5 /
 * SEARCH 2.5 / CAUGHT 0. Catch: <=0.8m for 0.1s, distance-only.
 * Senses: sight 10m (14m torch-ON) frontal +-60 deg + 3m proximity sense;
 * hearing bands SILENT n<0.4 (0m), WALK 0.4..0.8 (4m, +10/s),
 * RUN >=0.8 (12m, +25/s); sight fill +40/s; decay -10/s PATROL,
 * -15/s SEARCH, none in SUSPICIOUS/CHASE. Thresholds 30/100.
 * Pathfinding: A* on a 0.5m 48x36 grid over expanded colliders (0.35m),
 * 8-connected, octile heuristic, no corner-cutting, string-pulled
 * smoothing; CHASE repaths at 2Hz. A BFS flood-fill preflight at boot
 * proves every route/spur/finale/key/door target reachable.
 * Model: ./assets/agatha.glb (rigged Blender nun: 20-bone Armature +
 * SkinnedMesh + baked Idle/Walk NLA clips, ~1.7m, faces +Z) driven by
 * THREE.AnimationMixer weight-blended by speed, with the legacy procedural
 * limb driver + canvas-sprite silhouette fallback. No lights here.
 * r128 global THREE. No module syntax. No per-frame allocations.
 */
(function () {
  "use strict";

  /* Pre-warm DRACOLoader so draco_decoder.wasm + worker are ready before
   * Agatha's .glb is requested — shaves the wasm fetch off the 30s model
   * load budget. Safe no-op if DRACOLoader isn't vendored. */
  if (window.THREE && window.THREE.DRACOLoader && !window.THREE._agathaDraco) {
    try {
      var d = new window.THREE.DRACOLoader();
      d.setDecoderPath("/studio/vendor/");
      d.setDecoderConfig({ type: "js" });
      window.THREE._agathaDraco = d;
    } catch (e) {
      /* draco optional */
    }
  }

  /* ---------- verbatim tuning (arch Sections 2-4, Normal) ---------- */
  var SPD_PATROL = 2.0;
  var SPD_SUSP = 3.0;
  var SPD_CHASE = 4.5;
  var SPD_SEARCH = 2.5;
  var CATCH_R = 0.8;
  var CATCH_T = 0.1;
  var SIGHT_OFF = 10;
  var SIGHT_ON = 14;
  var HEAR_RUN = 12;
  var HEAR_WALK = 4;
  var FILL_SIGHT = 40;
  var FILL_RUN = 25;
  var FILL_WALK = 10;
  var DECAY_PATROL = 10;
  var DECAY_SEARCH = 15;
  var TH_DISTURB = 30;
  var TH_CONFIRM = 100;
  var FOV_HALF = Math.PI / 3;
  var PROX_R = 3;
  var PROX_T = 0.3;
  var HIDE_R = 1.2;
  var HIDE_SIGHT_R = 2.0;

  var DIFF = {
    Easy: { spd: 0.85, hear: 0.8, sight: 0.8 },
    Normal: { spd: 1.0, hear: 1.0, sight: 1.0 },
    Hard: { spd: 1.1, hear: 1.25, sight: 1.2 },
  };

  /* Cyclic patrol route R1..R24 (arch Section 2, verified off wall AABBs). */
  var ROUTE = [
    [0, -7.5],
    [10.5, -7.5],
    [10.5, -4.0],
    [9, -2],
    [5, -2],
    [6.0, -0.5],
    [5, -2],
    [5, 2],
    [10.5, 3.5],
    [0, 3.5],
    [0, 5],
    [0, 7],
    [-3, 6.8],
    [0, 7],
    [0, 5],
    [0, 3.5],
    [-5, 3.5],
    [-5, 2],
    [-5, -2],
    [-6.0, -4.5],
    [-5, -2],
    [-9, -2],
    [-10.5, -4.0],
    [-10.5, -7.5],
  ];
  var DWELL_IDX = { 5: 1, 12: 1, 19: 1 };
  var S1 = [
    [8, 5],
    [8.5, 7.0],
    [8, 5],
  ];
  var S2 = [
    [-10.5, 3.5],
    [-8, 5],
    [-8.5, 7.0],
    [-8, 5],
    [-10.5, 3.5],
  ];
  var S3 = [[-10.5, -1.5]];
  var FINALE_F = [9.0, -7.5];
  var H_PTS = [
    [-7.7, -4.6],
    [7.5, 0.6],
    [-11.2, 0.5],
    [10.2, 6.9],
    [-2.8, 8.1],
    [-5.9, 8.0],
  ];
  /* Classroom B footprint (beats B2): east room between divider and x=+9. */
  var CB = { x0: 1, z0: -6, x1: 9, z1: 2 };
  /* Live AI Director room targets (lowercase keys): order.targetRoom maps
   * here; all centers sit on open floor (BFS-verified corridor/room cells),
   * so goto() always finds a path and ROUTE/spurs are never broken. */
  var ROOM_CENTERS = {
    "entrance hall": [0, 7],
    "classroom a": [-5, -2],
    "classroom b": [5, -2],
    "north corridor": [0, -7.5],
    "south corridor": [0, 3.5],
    "west store": [-8, 7],
    "east store": [8, 7],
    "chapel approach": [0, -8],
  };

  var STATE_ALERT = {
    PATROL: 0.15,
    SUSPICIOUS: 0.55,
    SEARCH: 0.7,
    CHASE: 1.0,
    CAUGHT: 1.0,
  };

  var GW = 48;
  var GH = 36;
  var GN = GW * GH;
  var CELL = 0.5;
  var OX = -12;
  var OZ = -9;
  var BODY_R = 0.35;
  var ARRIVE_R = 0.4;
  var AGATHA_URL = "./assets/bloodfang_zombie.glb";

  function clampNum(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  window.StV_Enemy = {
    create: function (scene, colliders, bounds, player) {
      if (!scene) return null;
      colliders = colliders || [];
      bounds = bounds || { x0: -12, z0: -9, x1: 12, z1: 9 };

      var ncol = colliders.length;
      var mult = DIFF.Normal;
      var diffName = "Normal";
      var diffPoll = 0;

      /* ---------- state ---------- */
      var st = "PATROL";
      var ax = 0;
      var az = -7.5;
      var yaw = Math.PI / 2;
      var suspicion = 0;
      var stateT = 0;
      var routeIdx = 0;
      var spurCycle = 0;
      var spurPts = null;
      var spurI = 0;
      var dwellT = 0;
      var dwellYaw = 0;
      var stimX = 0;
      var stimZ = 0;
      var hasStim = false;
      var scanning = false;
      var scanBase = 0;
      var scanPhase = 0;
      var lastSeenX = 0;
      var lastSeenZ = 0;
      var hasSeen = false;
      var searchLegs = null;
      var searchI = 0;
      var legPause = 0;
      var sightDwell = 0;
      var proxDwell = 0;
      var runDwell = 0;
      var walkDwell = 0;
      var losLost = 0;
      var noSenseT = 0;
      var hideCrouchT = 0;
      var catchT = 0;
      var repathT = 0;
      var pathFailT = 0;
      var b1done = false;
      var b2done = false;
      var prevInB = false;
      var finaleDone = false;
      var caughtCb = null;
      var caughtFired = false;
      var lastDist = 99;
      var lastHidden = false;
      var bobPhase = 0;
      var stepAcc = 0;
      var sideX = 0;
      var sideZ = 0;
      var sideT = 0;
      var stuckX = 0;
      var stuckZ = 0;
      var stuckT = 0;
      var tier = "pending";
      var dbgTick = 0;
      var headScanYaw = 0;
      var prevAx = ax;
      var prevAz = az;
      var walkPhase = 0;
      var walkBlend = 0;
      var mixer = null;
      var mixerOk = false;
      var idleAction = null;
      var walkAction = null;
      var runAction = null;
      var hitAction = null;
      var deadAction = null;
      var alphaHP = 220;
      var alphaMaxHP = 220;
      var hitStaggerT = 0;
      var deadDownT = 0;
      var headBone = null;
      var scanQ = null;
      var scanAxisY = null;
      var legLNode = null;
      var legRNode = null;
      var armLNode = null;
      var armRNode = null;
      var torsoNode = null;
      var headNode = null;
      var legLY0 = 0.8;
      var legRY0 = 0.8;
      var torsoY0 = 0.88;
      var headY0 = 1.4;

      /* ---------- collision + grid ---------- */
      function segHitsAABB(x0, z0, x1, z1, rx0, rz0, rx1, rz1) {
        if (x0 >= rx0 && x0 <= rx1 && z0 >= rz0 && z0 <= rz1) return true;
        if (x1 >= rx0 && x1 <= rx1 && z1 >= rz0 && z1 <= rz1) return true;
        var dx = x1 - x0;
        var dz = z1 - z0;
        var tmin = 0;
        var tmax = 1;
        var t1, t2;
        if (Math.abs(dx) < 1e-9) {
          if (x0 < rx0 || x0 > rx1) return false;
        } else {
          t1 = (rx0 - x0) / dx;
          t2 = (rx1 - x0) / dx;
          if (t1 > t2) {
            var tt = t1;
            t1 = t2;
            t2 = tt;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return false;
        }
        if (Math.abs(dz) < 1e-9) {
          if (z0 < rz0 || z0 > rz1) return false;
        } else {
          t1 = (rz0 - z0) / dz;
          t2 = (rz1 - z0) / dz;
          if (t1 > t2) {
            var tt2 = t1;
            t1 = t2;
            t2 = tt2;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return false;
        }
        return true;
      }

      function segBlocked(x0, z0, x1, z1, expand) {
        for (var k = 0; k < ncol; k++) {
          var c = colliders[k];
          if (
            segHitsAABB(
              x0,
              z0,
              x1,
              z1,
              c.x0 - expand,
              c.z0 - expand,
              c.x1 + expand,
              c.z1 + expand,
            )
          ) {
            return true;
          }
        }
        return false;
      }

      var blocked = new Uint8Array(GN);
      (function buildGrid() {
        var i, j, k;
        for (j = 0; j < GH; j++) {
          for (i = 0; i < GW; i++) {
            var cx = OX + (i + 0.5) * CELL;
            var cz = OZ + (j + 0.5) * CELL;
            var b = 0;
            for (k = 0; k < ncol; k++) {
              var c = colliders[k];
              if (
                cx >= c.x0 - BODY_R &&
                cx <= c.x1 + BODY_R &&
                cz >= c.z0 - BODY_R &&
                cz <= c.z1 + BODY_R
              ) {
                b = 1;
                break;
              }
            }
            blocked[j * GW + i] = b;
          }
        }
      })();

      function cellOf(x, z) {
        var i = Math.floor((x - OX) / CELL);
        var j = Math.floor((z - OZ) / CELL);
        if (i < 0) i = 0;
        if (i >= GW) i = GW - 1;
        if (j < 0) j = 0;
        if (j >= GH) j = GH - 1;
        return j * GW + i;
      }

      function cellXZ(c, out) {
        var i = c % GW;
        var j = (c - i) / GW;
        out.x = OX + (i + 0.5) * CELL;
        out.z = OZ + (j + 0.5) * CELL;
        return out;
      }

      function nearestFree(c) {
        if (!blocked[c]) return c;
        var ci = c % GW;
        var cj = (c - ci) / GW;
        var r, di, dj;
        for (r = 1; r <= 4; r++) {
          for (dj = -r; dj <= r; dj++) {
            for (di = -r; di <= r; di++) {
              if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
              var ii = ci + di;
              var jj = cj + dj;
              if (ii < 0 || ii >= GW || jj < 0 || jj >= GH) continue;
              var cc = jj * GW + ii;
              if (!blocked[cc]) return cc;
            }
          }
        }
        return -1;
      }

      /* ---------- A* (preallocated, no per-call garbage) ---------- */
      var aG = new Float32Array(GN);
      var aPar = new Int32Array(GN);
      var aStamp = new Int32Array(GN);
      var aDone = new Int32Array(GN);
      var aGen = 0;
      /* Heap fits every push: expansions <= GN cells x 8 neighbors. */
      var aHeap = new Int32Array(GN * 8 + 16);
      var aHeapF = new Float32Array(GN * 8 + 16);
      var aHeapLen = 0;
      var tmpXZ = { x: 0, z: 0 };

      function heapPush(c, f) {
        var n = ++aHeapLen;
        aHeap[n] = c;
        aHeapF[n] = f;
        while (n > 1) {
          var p = n >> 1;
          if (aHeapF[p] <= aHeapF[n]) break;
          var tc = aHeap[p];
          aHeap[p] = aHeap[n];
          aHeap[n] = tc;
          var tf = aHeapF[p];
          aHeapF[p] = aHeapF[n];
          aHeapF[n] = tf;
          n = p;
        }
      }

      function heapPop() {
        var top = aHeap[1];
        aHeap[1] = aHeap[aHeapLen];
        aHeapF[1] = aHeapF[aHeapLen];
        aHeapLen--;
        var n = 1;
        for (;;) {
          var l = n + n;
          var r = l + 1;
          var m = n;
          if (l <= aHeapLen && aHeapF[l] < aHeapF[m]) m = l;
          if (r <= aHeapLen && aHeapF[r] < aHeapF[m]) m = r;
          if (m === n) break;
          var tc = aHeap[m];
          aHeap[m] = aHeap[n];
          aHeap[n] = tc;
          var tf = aHeapF[m];
          aHeapF[m] = aHeapF[n];
          aHeapF[n] = tf;
          n = m;
        }
        return top;
      }

      function octH(c, goal) {
        var dx = Math.abs((c % GW) - (goal % GW));
        var dz = Math.abs(
          (((c - (c % GW)) / GW) | 0) - (((goal - (goal % GW)) / GW) | 0),
        );
        var mn = dx < dz ? dx : dz;
        var mx = dx < dz ? dz : dx;
        return mx + 0.4142 * mn;
      }

      var pathX = new Float32Array(512);
      var pathZ = new Float32Array(512);
      var pathN = 0;
      var pathI = 0;

      function findPath(sx, sz, tx, tz) {
        pathN = 0;
        pathI = 0;
        var start = cellOf(sx, sz);
        var goal = nearestFree(cellOf(tx, tz));
        if (goal < 0 || blocked[start]) {
          start = nearestFree(start);
          if (start < 0 || goal < 0) return 0;
        }
        if (start === goal) {
          cellXZ(goal, tmpXZ);
          pathX[0] = tmpXZ.x;
          pathZ[0] = tmpXZ.z;
          pathN = 1;
          return 1;
        }
        aGen++;
        aHeapLen = 0;
        var exp = 0;
        aG[start] = 0;
        aPar[start] = -1;
        aStamp[start] = aGen;
        heapPush(start, octH(start, goal));
        var found = false;
        while (aHeapLen > 0 && exp < GN) {
          var cur = heapPop();
          if (aDone[cur] === aGen) continue;
          aDone[cur] = aGen;
          if (cur === goal) {
            found = true;
            break;
          }
          exp++;
          var ci = cur % GW;
          var cj = (cur - ci) / GW;
          var di, dj;
          for (dj = -1; dj <= 1; dj++) {
            for (di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              var ni = ci + di;
              var nj = cj + dj;
              if (ni < 0 || ni >= GW || nj < 0 || nj >= GH) continue;
              var nc = nj * GW + ni;
              if (blocked[nc]) continue;
              if (di && dj) {
                if (blocked[cj * GW + ni] || blocked[nj * GW + ci]) continue;
              }
              var step = di && dj ? 1.4142 : 1;
              var ng = aG[cur] + step;
              if (aStamp[nc] !== aGen || ng < aG[nc]) {
                aStamp[nc] = aGen;
                aG[nc] = ng;
                aPar[nc] = cur;
                heapPush(nc, ng + octH(nc, goal));
              }
            }
          }
        }
        if (!found) return 0;
        /* Reconstruct goal<-start into scratch, then string-pull the
         * forward order against expanded colliders. */
        var rev = aHeap;
        var rn = 0;
        var cc = goal;
        while (cc >= 0 && rn < GN) {
          rev[rn++] = cc;
          cc = aPar[cc];
        }
        var w = 0;
        if (rn > 200) {
          /* Long haul: emit raw cells, skip the quadratic smoother. */
          var k;
          for (k = rn - 1; k >= 0 && w < 511; k--) {
            cellXZ(rev[k], tmpXZ);
            pathX[w] = tmpXZ.x;
            pathZ[w] = tmpXZ.z;
            w++;
          }
          pathN = w;
          return w;
        }
        var ax0 = sx;
        var az0 = sz;
        var fi = rn - 1;
        while (fi >= 0 && w < 511) {
          var far = fi;
          var p;
          for (p = 0; p <= fi; p++) {
            cellXZ(rev[p], tmpXZ);
            if (!segBlocked(ax0, az0, tmpXZ.x, tmpXZ.z, BODY_R)) {
              far = p;
              cellXZ(rev[far], tmpXZ);
              break;
            }
          }
          cellXZ(rev[far], tmpXZ);
          pathX[w] = tmpXZ.x;
          pathZ[w] = tmpXZ.z;
          w++;
          ax0 = tmpXZ.x;
          az0 = tmpXZ.z;
          fi = far - 1;
        }
        pathN = w;
        return w;
      }

      /* BFS flood-fill preflight: every scripted target must be reachable
       * from spawn over the expanded grid; result is logged once. */
      (function bfsPreflight() {
        var targets = [];
        var i;
        for (i = 0; i < ROUTE.length; i++) targets.push(ROUTE[i]);
        for (i = 0; i < S1.length; i++) targets.push(S1[i]);
        for (i = 0; i < S2.length; i++) targets.push(S2[i]);
        for (i = 0; i < S3.length; i++) targets.push(S3[i]);
        targets.push(FINALE_F);
        targets.push([6.5, -3.5]);
        targets.push([0, -8.0]);
        var seen = new Uint8Array(GN);
        var q = new Int32Array(GN);
        var qh = 0;
        var qt = 0;
        var s0 = nearestFree(cellOf(0, -7.5));
        if (s0 >= 0) {
          seen[s0] = 1;
          q[qt++] = s0;
        }
        while (qh < qt) {
          var cur = q[qh++];
          var ci = cur % GW;
          var cj = (cur - ci) / GW;
          var nb = [
            ci > 0 ? cur - 1 : -1,
            ci < GW - 1 ? cur + 1 : -1,
            cj > 0 ? cur - GW : -1,
            cj < GH - 1 ? cur + GW : -1,
          ];
          for (var k = 0; k < 4; k++) {
            var nc = nb[k];
            if (nc >= 0 && !blocked[nc] && !seen[nc]) {
              seen[nc] = 1;
              q[qt++] = nc;
            }
          }
        }
        var miss = [];
        for (i = 0; i < targets.length; i++) {
          var c = cellOf(targets[i][0], targets[i][1]);
          if (!seen[c]) miss.push(targets[i][0] + "," + targets[i][1]);
        }
        try {
          window.__stvBfs = {
            ok: miss.length === 0,
            total: targets.length,
            missing: miss,
          };
          if (miss.length) {
            console.warn(
              "[stv] bfs preflight MISS " +
                miss.length +
                "/" +
                targets.length +
                ": " +
                miss.join(" "),
            );
          } else {
            console.log(
              "[stv] bfs preflight ok " +
                targets.length +
                "/" +
                targets.length +
                " reachable",
            );
          }
        } catch (err) {
          /* log-only */
        }
      })();

      /* ---------- senses (shared Active tick work) ---------- */
      var sense = {
        see: false,
        los: false,
        prox: false,
        in5: false,
        runHeard: false,
        walkHeard: false,
        hidden: false,
        dist: 99,
      };

      function nearestH(x, z) {
        var best = 1e9;
        var bi = 0;
        for (var i = 0; i < H_PTS.length; i++) {
          var dx = x - H_PTS[i][0];
          var dz = z - H_PTS[i][1];
          var d = dx * dx + dz * dz;
          if (d < best) {
            best = d;
            bi = i;
          }
        }
        return { d: Math.sqrt(best), i: bi };
      }

      function evalSenses(px, pz, noise, torchOn, crouch, psHidden) {
        var dx = px - ax;
        var dz = pz - az;
        var dist = Math.sqrt(dx * dx + dz * dz);
        // Cabinet hiding (HN2 interact) conceals regardless of crouch/noise.
        var hidden = !!psHidden ||
          (!!crouch && noise < 0.4 && nearestH(px, pz).d <= HIDE_R);
        var range = (torchOn ? SIGHT_ON : SIGHT_OFF) * mult.sight;
        var s = sense;
        s.dist = dist;
        s.hidden = hidden;
        s.runHeard = false;
        s.walkHeard = false;
        s.see = false;
        s.los = false;
        s.prox = false;
        s.in5 = dist <= 5;
        /* Hearing is radius-only; walls still protect via misdirection
         * because SUSPICIOUS walks to the heard cell. */
        if (noise >= 0.8) {
          s.runHeard = dist <= HEAR_RUN * mult.hear;
        } else if (noise >= 0.4) {
          s.walkHeard = dist <= HEAR_WALK * mult.hear;
        }
        if (hidden && dist > HIDE_SIGHT_R) {
          lastDist = dist;
          lastHidden = hidden;
          return s;
        }
        /* Chest height is 1.2 standing / 0.7 crouch, but the occlusion
         * test is the arch-verbatim 2D segment vs unexpanded colliders. */
        var clear = !segBlocked(ax, az, px, pz, 0);
        s.los = clear;
        if (!clear) {
          lastDist = dist;
          lastHidden = hidden;
          return s;
        }
        if (hidden && dist <= HIDE_SIGHT_R) {
          /* Hidden inside 2m: only the catch radius still applies. */
          lastDist = dist;
          lastHidden = hidden;
          return s;
        }
        s.prox = dist <= PROX_R;
        if (dist > range && !s.prox) {
          lastDist = dist;
          lastHidden = hidden;
          return s;
        }
        var want = Math.atan2(dx, dz);
        var inCone = Math.abs(angDiff(want, yaw)) <= FOV_HALF;
        s.see = (dist <= range && inCone) || s.prox;
        lastDist = dist;
        lastHidden = hidden;
        return s;
      }

      function failMove(tx, tz) {
        pathN = 0;
        pathI = 0;
        pathFailT = 1.0;
        stimX = tx;
        stimZ = tz;
      }

      function goto(tx, tz) {
        if (findPath(ax, az, tx, tz) < 1) failMove(tx, tz);
      }

      function speedFor(state) {
        if (state === "PATROL") return SPD_PATROL * mult.spd;
        if (state === "SUSPICIOUS") return SPD_SUSP * mult.spd;
        if (state === "CHASE") return SPD_CHASE * mult.spd;
        if (state === "SEARCH") return SPD_SEARCH * mult.spd;
        return 0;
      }

      function enter(state, px, pz) {
        st = state;
        stateT = 0;
        scanning = false;
        legPause = 0;
        repathT = 0;
        if (state === "CHASE") {
          suspicion = TH_CONFIRM;
          goto(px, pz);
        } else if (state === "SUSPICIOUS") {
          goto(stimX, stimZ);
        } else if (state === "SEARCH") {
          buildSearchLegs();
          if (searchLegs && searchLegs.length) {
            goto(searchLegs[0][0], searchLegs[0][1]);
          }
        } else if (state === "CAUGHT") {
          pathN = 0;
          pathI = 0;
          if (!caughtFired) {
            caughtFired = true;
            if (caughtCb) {
              try {
                caughtCb();
              } catch (err) {
                /* game-side */
              }
            }
          }
        }
      }

      function buildSearchLegs() {
        var lx = hasSeen ? lastSeenX : stimX;
        var lz = hasSeen ? lastSeenZ : stimZ;
        var scored = [];
        for (var i = 0; i < H_PTS.length; i++) {
          var dx = H_PTS[i][0] - lx;
          var dz = H_PTS[i][1] - lz;
          var d = Math.sqrt(dx * dx + dz * dz);
          if (d <= 6) scored.push([d, i]);
        }
        scored.sort(function (a, b) {
          return a[0] - b[0];
        });
        searchLegs = [[lx, lz]];
        for (var k = 0; k < scored.length && k < 2; k++) {
          searchLegs.push(H_PTS[scored[k][1]]);
        }
        searchI = 0;
      }

      /* Follow the smoothed path; returns true while legs remain.
       * Advances across arrived waypoints in the SAME tick so Agatha never
       * stutters for 1 frame every 0.5m along the corridor. */
      function followPath(dt, speed) {
        var tx = 0;
        var tz = 0;
        var dx = 0;
        var dz = 0;
        var d = 0;
        while (pathI < pathN) {
          tx = pathX[pathI];
          tz = pathZ[pathI];
          if (sideT > 0) {
            tx += sideX;
            tz += sideZ;
          }
          dx = tx - ax;
          dz = tz - az;
          d = Math.sqrt(dx * dx + dz * dz);
          if (d > ARRIVE_R) break;
          pathI++;
        }
        if (sideT > 0) sideT -= dt;
        if (pathI >= pathN) return false;
        var step = speed * dt;
        if (step > d) step = d;
        ax += (dx / d) * step;
        az += (dz / d) * step;
        ax = clampNum(ax, bounds.x0 + BODY_R, bounds.x1 - BODY_R);
        az = clampNum(az, bounds.z0 + BODY_R, bounds.z1 - BODY_R);
        var want = Math.atan2(dx, dz);
        yaw += angDiff(want, yaw) * Math.min(1, 7.5 * dt);
        return true;
      }

      /* Spur detour on ARRIVAL: S1 at R9 (idx 8, resume R10), S2 between
       * R16->R17 (on arrival idx 15, resume idx 16), S3 at R23 (idx 22,
       * resume R24). Spur k runs when (cycle+k)%2==0. Returns true when a
       * detour starts (caller must not advance the route). */
      function maybeSpur() {
        if (spurPts) return false;
        var k = 0;
        var pts = null;
        if (routeIdx === 8) {
          k = 1;
          pts = S1;
        } else if (routeIdx === 15) {
          k = 2;
          pts = S2;
        } else if (routeIdx === 22) {
          k = 3;
          pts = S3;
        } else return false;
        if ((spurCycle + k) % 2 !== 0) return false;
        spurPts = pts;
        spurI = 0;
        goto(pts[0][0], pts[0][1]);
        return true;
      }

      function advanceRoute() {
        if (spurPts) {
          spurI++;
          if (spurI < spurPts.length) {
            goto(spurPts[spurI][0], spurPts[spurI][1]);
            return;
          }
          spurPts = null;
          spurI = 0;
        }
        routeIdx++;
        if (routeIdx >= ROUTE.length) {
          routeIdx = 0;
          spurCycle++;
        }
        goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
      }

      function readDifficulty() {
        try {
          var S = window.StV_Save;
          if (S && S.load) {
            var d = S.load().difficulty;
            if (d === "Easy" || d === "Normal" || d === "Hard") {
              diffName = d;
              mult = DIFF[d];
              return;
            }
          }
        } catch (err) {
          /* keep current */
        }
      }

      function heardNow() {
        return sense.runHeard || sense.walkHeard;
      }

      /* Scripted horror beats, enemy-side half (game.js plays the
       * audio/VFX/UI half and routes escalations through setAlert). */
      function director(t, px, pz, keyHeld, inB) {
        if (!b1done) {
          if (t >= 35 && t < 60 && st === "PATROL" && lastDist > 8) {
            routeIdx = 9;
            spurPts = null;
            goto(ROUTE[9][0], ROUTE[9][1]);
            b1done = true;
          } else if (t >= 60) {
            b1done = true;
          }
        }
        if (!b2done) {
          var entered = inB && !prevInB;
          if (
            (entered || (t >= 80 && inB)) &&
            (st === "PATROL" || st === "SUSPICIOUS")
          ) {
            suspicion = Math.max(suspicion, 60);
            stimX = px;
            stimZ = pz;
            hasStim = true;
            routeIdx = 4;
            spurPts = null;
            goto(ROUTE[4][0], ROUTE[4][1]);
            b2done = true;
          } else if (entered) {
            b2done = true;
          }
        }
        prevInB = !!inB;
        if (keyHeld && !finaleDone) {
          finaleDone = true;
          suspicion = TH_CONFIRM;
          hasStim = true;
          stimX = px;
          stimZ = pz;
          /* Gated F: teleport only when the player cannot see F. */
          if (!segBlocked(px, pz, FINALE_F[0], FINALE_F[1], 0)) {
            /* Player watches F: walk in from the current spot. */
          } else {
            ax = FINALE_F[0];
            az = FINALE_F[1];
            pathN = 0;
            pathI = 0;
          }
        }
      }

      function update(dt, t, playerState) {
        if (!(dt > 0)) return;
        if (dt > 0.05) dt = 0.05;
        if (!(t > 0)) t = 0;

        var px = 0;
        var pz = 8.5;
        var noise = 0;
        var torchOn = true;
        var crouch = false;
        var keyHeld = false;
        var inB = false;
        var psHidden = false;
        if (playerState) {
          if (typeof playerState.x === "number") px = playerState.x;
          if (typeof playerState.z === "number") pz = playerState.z;
          if (typeof playerState.noise === "number") noise = playerState.noise;
          torchOn = !!playerState.torchOn;
          crouch = !!playerState.crouch;
          keyHeld = !!playerState.keyHeld;
          inB = !!playerState.inClassB;
          psHidden = !!playerState.hidden;
        } else if (player && player.pos) {
          try {
            var pp = player.pos();
            px = pp.x;
            pz = pp.z;
            if (typeof player.isHidden === "function") {
              psHidden = !!player.isHidden();
            }
          } catch (err) {
            /* spawn default stands */
          }
        }

        diffPoll += dt;
        if (diffPoll >= 1) {
          diffPoll = 0;
          readDifficulty();
        }

        if (deadDownT > 0) {
          deadDownT -= dt;
          if (mixerOk && mixer) {
            try { mixer.update(dt); } catch (eD) {}
          }
          if (deadDownT <= 0) {
            alphaHP = alphaMaxHP;
            if (deadAction) deadAction.stop();
            var rIdx = Math.floor(Math.random() * ROUTE.length);
            ax = ROUTE[rIdx][0];
            az = ROUTE[rIdx][1];
            st = "PATROL";
            suspicion = 0;
            group.position.set(ax, 0, az);
          }
          return;
        }
        if (hitStaggerT > 0) {
          hitStaggerT -= dt;
          animate(dt, 0);
          return;
        }
        if (st === "CAUGHT") {
          /* Frozen interrupt: face the player, keep the lantern alive. */
          var cdx = px - ax;
          var cdz = pz - az;
          if (cdx * cdx + cdz * cdz > 1e-6) {
            yaw += angDiff(Math.atan2(cdx, cdz), yaw) * Math.min(1, 8 * dt);
          }
          animate(dt, 0);
          return;
        }

        var s = evalSenses(px, pz, noise, torchOn, crouch, psHidden);
        var dist = s.dist;

        /* Suspicion meter: fills, then state decays. */
        if (s.see) {
          suspicion += FILL_SIGHT * dt;
          sightDwell += dt;
          lastSeenX = px;
          lastSeenZ = pz;
          hasSeen = true;
          losLost = 0;
        } else {
          sightDwell = 0;
          losLost += dt;
        }
        if (s.runHeard) {
          suspicion += FILL_RUN * mult.hear * dt;
          runDwell += dt;
        } else {
          runDwell = 0;
        }
        if (s.walkHeard) {
          suspicion += FILL_WALK * mult.hear * dt;
          walkDwell += dt;
        } else {
          walkDwell = 0;
        }
        if (s.prox && s.los && !s.hidden) proxDwell += dt;
        else proxDwell = 0;
        if (s.see || heardNow()) noSenseT = 0;
        else noSenseT += dt;
        if (s.hidden && dist > 8) hideCrouchT += dt;
        else hideCrouchT = 0;
        if (st === "PATROL") suspicion -= DECAY_PATROL * dt;
        else if (st === "SEARCH") suspicion -= DECAY_SEARCH * dt;
        if (suspicion < 0) suspicion = 0;
        if (suspicion > TH_CONFIRM) suspicion = TH_CONFIRM;
        stateT += dt;

        if (dist <= CATCH_R) catchT += dt;
        else catchT = 0;

        director(t, px, pz, keyHeld, inB);

        /* CAUGHT edges first, from any Active substate (T6/T9). */
        if (catchT >= CATCH_T) {
          enter("CAUGHT", px, pz);
          animate(dt, 0);
          return;
        }

        if (st === "PATROL") {
          if (s.in5 && s.see && sightDwell >= 0.3 && suspicion >= TH_CONFIRM) {
            enter("CHASE", px, pz); /* T2 */
          } else if (
            suspicion >= TH_DISTURB &&
            ((s.see && sightDwell >= 0.5) ||
              (s.runHeard && runDwell >= 0.5) ||
              (s.walkHeard && walkDwell >= 1.0))
          ) {
            stimX = px;
            stimZ = pz;
            hasStim = true;
            enter("SUSPICIOUS", px, pz); /* T1 */
          }
        } else if (st === "SUSPICIOUS") {
          if (
            (suspicion >= TH_CONFIRM && s.see && sightDwell >= 1.0) ||
            (s.prox && s.los && !s.hidden && proxDwell >= PROX_T)
          ) {
            suspicion = TH_CONFIRM;
            enter("CHASE", px, pz); /* T3 */
          } else if (stateT >= 3 && noSenseT >= 3 && suspicion <= 0) {
            enter("PATROL", px, pz); /* T4 */
            goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
          } else if (stateT >= 4) {
            /* Give-up edge: Wonder's table omits one and T4 cannot
             * fire without decay, so the 4s timer hands the stimulus
             * to SEARCH as last-known instead of stalling forever. */
            enter("SEARCH", px, pz);
          }
        } else if (st === "CHASE") {
          if ((losLost >= 3 && dist > 10) || (hideCrouchT >= 3 && dist > 8)) {
            enter("SEARCH", px, pz); /* T5 */
          }
        } else if (st === "SEARCH") {
          if (
            (s.see && sightDwell >= 0.5) ||
            (s.runHeard && runDwell >= 0.3 && suspicion >= 90)
          ) {
            /* T7; the 90 floor stands in for verbatim 100 because
             * SEARCH decay drains past literal 100 after one tick. */
            suspicion = TH_CONFIRM;
            enter("CHASE", px, pz);
          } else if (stateT >= 8 && !s.see && !heardNow() && suspicion <= 0) {
            enter("PATROL", px, pz); /* T8 */
            goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
          } else if (stateT >= 20) {
            enter("PATROL", px, pz); /* safety cap, same edge as T8 */
            goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
          }
        }

        /* ---------- per-state movement ---------- */
        if (pathFailT > 0) pathFailT -= dt;
        var speed = speedFor(st);
        if (st === "PATROL") {
          if (dwellT > 0) {
            dwellT -= dt;
            yaw = dwellYaw;
            headScanYaw = Math.sin(stateT * 2.4) * 0.48;
            if (dwellT <= 0) {
              headScanYaw = 0;
              advanceRoute();
            }
          } else if (pathFailT > 0) {
            /* Failed route cooling down (timer ticks globally). */
          } else if (!followPath(dt, speed)) {
            if (pathN === 0) {
              if (spurPts) goto(spurPts[spurI][0], spurPts[spurI][1]);
              else goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
            } else if (!spurPts && DWELL_IDX[routeIdx]) {
              dwellT = 0.6;
              dwellYaw = yaw;
            } else if (spurPts && spurI === spurPts.length - 1) {
              dwellT = 0.6;
              dwellYaw = yaw;
            } else if (!maybeSpur()) {
              advanceRoute();
            }
          } else {
            headScanYaw *= Math.max(0, 1 - dt * 6);
          }
        } else if (st === "SUSPICIOUS") {
          repathT -= dt;
          var moved = followPath(dt, speed);
          if (!moved) {
            /* Empty path = failed route: retry when the timer allows,
             * scan the stimulus while waiting. */
            if (pathN === 0 && pathFailT <= 0) goto(stimX, stimZ);
            if (!scanning) {
              scanning = true;
              scanBase = Math.atan2(stimX - ax, stimZ - az);
              scanPhase = 0;
            }
            scanPhase += dt * 1.8;
            yaw +=
              angDiff(scanBase + Math.sin(scanPhase) * 0.35, yaw) *
              Math.min(1, 4 * dt);
            headScanYaw = Math.sin(scanPhase) * 0.55;
          } else if (repathT <= 0) {
            headScanYaw *= Math.max(0, 1 - dt * 6);
            repathT = 1.0;
            goto(stimX, stimZ);
          } else {
            headScanYaw *= Math.max(0, 1 - dt * 6);
          }
        } else if (st === "CHASE") {
          headScanYaw *= Math.max(0, 1 - dt * 8);
          repathT -= dt;
          if (repathT <= 0) {
            repathT = 0.5;
            if (pathFailT <= 0) goto(px, pz);
          }
          followPath(dt, speed);
        } else if (st === "SEARCH") {
          /* Near-miss beat: pin the hunt to the player's hide. */
          if (
            t >= 125 &&
            s.hidden &&
            dist < 8 &&
            searchLegs &&
            searchLegs.length > 1
          ) {
            var nh = nearestH(px, pz);
            var want = H_PTS[nh.i];
            var cur = searchLegs[searchLegs.length - 1];
            if (cur[0] !== want[0] || cur[1] !== want[1]) {
              searchLegs[searchLegs.length - 1] = want;
              if (searchI >= searchLegs.length - 1) {
                goto(want[0], want[1]);
              }
            }
          }
          if (legPause > 0) {
            legPause -= dt;
            scanPhase += dt * 1.8;
            yaw +=
              angDiff(scanBase + Math.sin(scanPhase) * 0.3, yaw) *
              Math.min(1, 4 * dt);
            headScanYaw = Math.sin(scanPhase) * 0.55;
          } else if (!followPath(dt, speed)) {
            if (pathN === 0 && searchLegs && searchI < searchLegs.length) {
              if (pathFailT <= 0) {
                goto(searchLegs[searchI][0], searchLegs[searchI][1]);
              }
            } else {
              searchI++;
              if (searchLegs && searchI < searchLegs.length) {
                legPause = 1.2;
                scanBase = yaw;
                goto(searchLegs[searchI][0], searchLegs[searchI][1]);
              } else if (!scanning) {
                scanning = true;
                scanBase = yaw;
                scanPhase = 0;
              }
              if (scanning && !(searchLegs && searchI < searchLegs.length)) {
                scanPhase += dt * 1.8;
                yaw +=
                  angDiff(scanBase + Math.sin(scanPhase) * 0.35, yaw) *
                  Math.min(1, 4 * dt);
                headScanYaw = Math.sin(scanPhase) * 0.55;
              }
            }
          } else {
            headScanYaw *= Math.max(0, 1 - dt * 6);
          }
        }

        /* Stuck watchdog: <0.15m in 1.2s -> repath + sidestep. */
        stuckT += dt;
        if (stuckT >= 1.2) {
          var traveled = Math.sqrt(
            (ax - stuckX) * (ax - stuckX) + (az - stuckZ) * (az - stuckZ),
          );
          if (traveled < 0.15 && speed > 0 && dwellT <= 0 && legPause <= 0) {
            sideX = Math.random() < 0.5 ? -0.5 : 0.5;
            sideZ = 0;
            sideT = 0.6;
            pathI = pathN;
            if (st === "CHASE") goto(px, pz);
            else if (st === "SUSPICIOUS") goto(stimX, stimZ);
            else if (
              st === "SEARCH" &&
              searchLegs &&
              searchI < searchLegs.length
            ) {
              goto(searchLegs[searchI][0], searchLegs[searchI][1]);
            } else if (st === "PATROL") {
              goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
            }
          }
          stuckX = ax;
          stuckZ = az;
          stuckT = 0;
        }

        /* Nun footfall: heavy in CHASE, soft when hunting, none roaming. */
        if (
          speed > 0 &&
          (st === "CHASE" || st === "SUSPICIOUS" || st === "SEARCH")
        ) {
          stepAcc += speed * dt;
          var stride = st === "CHASE" ? 2.3 : 1.9;
          if (stepAcc >= stride) {
            stepAcc = 0;
            try {
              var A = window.StV_Audio;
              if (A && A.agathaStep) A.agathaStep(st === "CHASE", ax, az);
            } catch (err) {
              /* silent when audio is down */
            }
          }
        }

        /* Debug-only position export (2Hz, shape of getState untouched). */
        dbgTick++;
        if (dbgTick >= 30) {
          dbgTick = 0;
          try {
            window.__stvAgathaXZ = [
              Math.round(ax * 10) / 10,
              Math.round(az * 10) / 10,
            ];
          } catch (err) {
            /* debug-only */
          }
        }

        animate(dt, speed);
      }

      /* ---------- presentation: bob/sway + lantern swing ---------- */
      var group = new THREE.Group();
      var modelRoot = null;
      var lanternNode = null;
      var glowSprite = null;
      group.position.set(ax, 0, az);
      group.rotation.y = yaw;
      try {
        scene.add(group);
      } catch (err) {
        /* headless-safe */
      }

      function animate(dt, speed) {
        var stepDx = ax - prevAx;
        var stepDz = az - prevAz;
        prevAx = ax;
        prevAz = az;
        var movedDist = Math.sqrt(stepDx * stepDx + stepDz * stepDz);
        var actualSpd = dt > 0.0001 ? movedDist / dt : 0;
        var targetBlend =
          actualSpd > 0.08 ? Math.min(1.35, actualSpd / 2.1) : 0;
        walkBlend += (targetBlend - walkBlend) * Math.min(1, dt * 10);
        walkPhase += movedDist * 3.5;
        bobPhase += dt * (1.6 + actualSpd * 1.1);

        /* Mixer primary: weight-blend Idle<->Walk by speed, then let the
         * baked bones carry the stride. Procedural limbs stay parked. */
        var useMixer = !!mixerOk;
        if (useMixer) {
          try {
            var k = Math.max(0, Math.min(1, walkBlend));
            if (idleAction) idleAction.setEffectiveWeight(1 - k);
            if (st === "CHASE" && runAction) {
              if (walkAction) walkAction.setEffectiveWeight(0);
              runAction.setEffectiveWeight(k);
            } else {
              if (runAction) runAction.setEffectiveWeight(0);
              if (walkAction) walkAction.setEffectiveWeight(k);
            }
            mixer.update(dt);
          } catch (errMix) {
            useMixer = false;
          }
        }

        try {
          group.position.x = ax;
          group.position.z = az;
          group.rotation.y = yaw;

          var s = Math.sin(walkPhase);
          var c = Math.cos(walkPhase);

          /* Eerie head scan rides ON TOP of the baked clip pose (applied
           * after mixer.update, which rewrites bone transforms each tick).
           * Bones carry flipped rest quaternions, so the scan MUST
           * post-multiply a local-Y (bone long axis = head yaw) rotation
           * onto the quaternion — Euler-adding would tilt the wrong axis.
           * Temps are allocated once (no per-frame garbage). */
          if (useMixer && headBone) {
            try {
              if (!scanQ) {
                scanQ = new THREE.Quaternion();
                scanAxisY = new THREE.Vector3(0, 1, 0);
              }
              headBone.quaternion.multiply(
                scanQ.setFromAxisAngle(scanAxisY, headScanYaw),
              );
              group.position.y = 0;
              group.rotation.z = 0;
            } catch (errHB) {
              /* bone add-on never breaks the sim */
            }
          }

          if (useMixer) {
            /* Baked bones already posed; nothing else to drive. */
          } else if (legLNode && legRNode) {
            /* Articulated human bipedal walk: opposite leg stride + foot lift + contrapposto */
            group.position.y = 0;
            group.rotation.z = 0;
            legLNode.rotation.x = 0.42 * s * walkBlend;
            legRNode.rotation.x = -0.42 * s * walkBlend;
            legLNode.position.y = legLY0 + Math.max(0, c) * 0.04 * walkBlend;
            legRNode.position.y = legRY0 + Math.max(0, -c) * 0.04 * walkBlend;
            if (armLNode) {
              armLNode.rotation.x = -0.32 * s * walkBlend;
            }
            if (armRNode) {
              armRNode.rotation.x = 0.1 * s * walkBlend;
            }
            var bobY =
              Math.abs(s) * 0.024 * walkBlend +
              Math.sin(bobPhase) * 0.004 * (1 - walkBlend);
            if (torsoNode) {
              torsoNode.position.y = torsoY0 + bobY;
              torsoNode.rotation.x = 0.05 * walkBlend;
              torsoNode.rotation.y = 0.045 * s * walkBlend;
              torsoNode.rotation.z = 0.02 * s * walkBlend;
            }
            if (headNode) {
              headNode.position.y = headY0 + bobY;
              headNode.rotation.y = headScanYaw - 0.03 * s * walkBlend;
              headNode.rotation.x = -0.02 * walkBlend;
            }
          } else {
            /* Fallback for single-mesh or sprite tier */
            group.position.y =
              Math.abs(Math.sin(walkPhase)) * 0.035 * walkBlend;
            group.rotation.z = Math.sin(walkPhase) * 0.015 * walkBlend;
          }

          if (lanternNode) {
            lanternNode.rotation.x =
              Math.sin(walkPhase * 1.0) * 0.12 * walkBlend;
            lanternNode.rotation.z = Math.sin(bobPhase * 0.9 + 1) * 0.08;
          }
          if (glowSprite && glowSprite.material) {
            var fl = 0.85 + 0.15 * Math.sin(bobPhase * 3.1);
            glowSprite.material.opacity = fl;
          }
        } catch (err) {
          /* presentation never breaks the sim */
        }
      }

      function glowTexture() {
        var cv = document.createElement("canvas");
        cv.width = 64;
        cv.height = 64;
        var g = cv.getContext("2d");
        var grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, "rgba(255,220,160,1)");
        grad.addColorStop(0.35, "rgba(255,166,62,0.55)");
        grad.addColorStop(1, "rgba(255,150,50,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        var tex = new THREE.CanvasTexture(cv);
        return tex;
      }

      function attachGlow(parent, x, y, z, size) {
        try {
          var mat = new THREE.SpriteMaterial({
            map: glowTexture(),
            color: 0xffc06a,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          var sp = new THREE.Sprite(mat);
          sp.position.set(x, y, z);
          sp.scale.set(size, size, 1);
          parent.add(sp);
          if (!glowSprite) glowSprite = sp;
          return sp;
        } catch (err) {
          return null;
        }
      }

      function setTier(name) {
        tier = name;
        try {
          window.__stvAgathaTier = name;
        } catch (err) {
          /* debug-only */
        }
      }

      /* Tier-4 last resort: painted canvas silhouette on a sprite.
       * Sprites only here — the primitive budget stays at zero. */
      function buildSpriteFallback() {
        if (modelRoot) return;
        try {
          var cv = document.createElement("canvas");
          cv.width = 256;
          cv.height = 512;
          var g = cv.getContext("2d");
          g.clearRect(0, 0, 256, 512);
          /* Veil: tall dark hood tapering to the hem. */
          g.fillStyle = "#0b0b10";
          g.beginPath();
          g.moveTo(128, 18);
          g.bezierCurveTo(70, 60, 62, 180, 52, 300);
          g.lineTo(44, 500);
          g.lineTo(212, 500);
          g.lineTo(204, 300);
          g.bezierCurveTo(194, 180, 186, 60, 128, 18);
          g.fill();
          /* Hood rim light (teal) + hem folds. */
          g.strokeStyle = "rgba(110,170,200,0.5)";
          g.lineWidth = 5;
          g.beginPath();
          g.moveTo(128, 18);
          g.bezierCurveTo(70, 60, 62, 180, 52, 300);
          g.stroke();
          g.strokeStyle = "rgba(40,40,55,0.9)";
          g.lineWidth = 3;
          var f;
          for (f = 0; f < 5; f++) {
            g.beginPath();
            g.moveTo(80 + f * 24, 320);
            g.lineTo(76 + f * 26, 498);
            g.stroke();
          }
          /* Pale gaunt face inside the hood. */
          g.fillStyle = "#d8cbb2";
          g.beginPath();
          g.ellipse(128, 150, 30, 44, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#14100c";
          g.beginPath();
          g.ellipse(116, 142, 6, 9, 0, 0, Math.PI * 2);
          g.ellipse(140, 142, 6, 9, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = "#3a2c22";
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(118, 178);
          g.lineTo(138, 178);
          g.stroke();
          /* Amber lantern dot at her left hand. */
          var lg = g.createRadialGradient(52, 330, 2, 52, 330, 34);
          lg.addColorStop(0, "rgba(255,230,170,1)");
          lg.addColorStop(0.4, "rgba(255,166,62,0.8)");
          lg.addColorStop(1, "rgba(255,150,50,0)");
          g.fillStyle = lg;
          g.beginPath();
          g.arc(52, 330, 34, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#2a1a0c";
          g.fillRect(44, 300, 16, 8);
          var tex = new THREE.CanvasTexture(cv);
          var mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            fog: true,
            depthWrite: false,
          });
          var sp = new THREE.Sprite(mat);
          sp.scale.set(0.95, 1.9, 1);
          sp.position.set(0, 0.95, 0);
          group.add(sp);
          modelRoot = sp;
          attachGlow(group, -0.42, 1.06, 0.2, 0.8);
          setTier("sprite");
        } catch (err) {
          try {
            console.warn("[stv] agatha sprite fallback failed");
          } catch (e2) {
            /* x */
          }
        }
      }

      /* THREE.AnimationMixer rig driver: finds the baked Idle/Walk NLA
       * clips by name (case-insensitive substring; legacy *Action object
       * clips never match, so old .glb files safely keep the procedural
       * fallback) and plays both with speed-driven weights. */
      function setupMixer(root, animations) {
        mixer = null;
        mixerOk = false;
        idleAction = null;
        walkAction = null;
        try {
          if (!root || !window.THREE || !window.THREE.AnimationMixer) return;
          var clips = animations && animations.length ? animations : null;
          if (!clips) return;
          var idleClip = null;
          var walkClip = null;
          var runClip = null;
          var hitClip = null;
          var deadClip = null;
          var i;
          for (i = 0; i < clips.length; i++) {
            var nm = (clips[i] && clips[i].name ? clips[i].name : "")
              .toLowerCase();
            if (!idleClip && nm.indexOf("idle") >= 0) idleClip = clips[i];
            if (!walkClip && nm.indexOf("walk") >= 0) walkClip = clips[i];
            if (!runClip && nm.indexOf("run") >= 0) runClip = clips[i];
            if (!hitClip && nm.indexOf("hit") >= 0) hitClip = clips[i];
            if (!deadClip && nm.indexOf("dead front") >= 0) deadClip = clips[i];
            else if (!deadClip && nm.indexOf("dead") >= 0) deadClip = clips[i];
          }
          if (
            window.THREE.AnimationClip &&
            window.THREE.AnimationClip.findByName
          ) {
            if (!idleClip) {
              idleClip = window.THREE.AnimationClip.findByName(clips, "Idle");
            }
            if (!walkClip) {
              walkClip = window.THREE.AnimationClip.findByName(clips, "Walk");
            }
          }
          if (!idleClip && !walkClip) return;
          mixer = new window.THREE.AnimationMixer(root);
          if (idleClip) {
            idleAction = mixer.clipAction(idleClip);
            idleAction.setEffectiveWeight(1);
            idleAction.play();
          }
          if (walkClip) {
            walkAction = mixer.clipAction(walkClip);
            walkAction.setEffectiveWeight(0);
            walkAction.play();
          }
          if (runClip) {
            runAction = mixer.clipAction(runClip);
            runAction.setEffectiveWeight(0);
            runAction.play();
          }
          if (hitClip) {
            hitAction = mixer.clipAction(hitClip);
            hitAction.setLoop(window.THREE.LoopOnce, 1);
            hitAction.clampWhenFinished = true;
          }
          if (deadClip) {
            deadAction = mixer.clipAction(deadClip);
            deadAction.setLoop(window.THREE.LoopOnce, 1);
            deadAction.clampWhenFinished = true;
          }
          mixerOk = true;
        } catch (err) {
          mixer = null;
          mixerOk = false;
          idleAction = null;
          walkAction = null;
        }
      }

      function onModelOk(root, animations) {
        if (tier !== "pending" || !root) return;
        loadDone = true;
        try {
          modelRoot = root;
          /* Raw-loader path only: WorldRealism already normalizes. */
          if (!usedWR && window.THREE) {
            var box = new THREE.Box3().setFromObject(root);
            var size = new THREE.Vector3();
            box.getSize(size);
            var len = Math.max(size.x, Math.max(size.y, size.z));
            if (len > 0.01) {
              var k = 1.7 / len;
              root.scale.set(k, k, k);
            }
            box.setFromObject(root);
            root.position.y -= box.min.y;
          }
          group.add(root);
          try {
            root.traverse(function (o) {
              if (!o || !o.name) return;
              if (o.name === "LanternAnchor") lanternNode = o;
              else if (o.name === "Agatha_Leg_L") {
                legLNode = o;
                legLY0 = o.position.y;
              } else if (o.name === "Agatha_Leg_R") {
                legRNode = o;
                legRY0 = o.position.y;
              } else if (o.name === "Agatha_Arm_L") {
                armLNode = o;
              } else if (o.name === "Agatha_Arm_R") {
                armRNode = o;
              } else if (o.name === "Agatha_Torso") {
                torsoNode = o;
                torsoY0 = o.position.y;
              } else if (o.name === "Agatha_Head_Group") {
                headNode = o;
                headY0 = o.position.y;
              }
            });
          } catch (err) {
            lanternNode = null;
          }
          try {
            headBone =
              root && root.getObjectByName
                ? root.getObjectByName("head")
                : null;
          } catch (errHB) {
            headBone = null;
          }
          setupMixer(root, animations);
          if (lanternNode) {
            attachGlow(lanternNode, 0, 0.05, 0, 0.85);
          } else {
            attachGlow(group, -0.36, 1.05, 0.25, 0.85);
          }
          setTier("blender");
        } catch (err) {
          try {
            console.warn("[stv] agatha model attach failed, sprite next");
          } catch (e2) {
            /* x */
          }
          buildSpriteFallback();
        }
      }

      var usedWR = false;
      var loadDone = false;
      var loadTimer = 0;

      function onModelFail(err) {
        if (tier !== "pending") return;
        loadDone = true;
        try {
          console.warn(
            "[stv] agatha.glb failed (" +
              (err && err.message ? err.message : "load error") +
              "), sprite fallback",
          );
        } catch (e2) {
          /* x */
        }
        buildSpriteFallback();
      }

      (function loadModel() {
        setTier("pending");
        try {
          /* Draco support: BlenderKit/Kenney/Objaverse models often ship
           * KHR_draco_mesh_compression. Wire THREE.DRACOLoader onto both
           * the bare GLTFLoader and WorldRealism.loadGlbModel path so a
           * real artist-made Agatha .glb loads without a fallback. */
          var dracoReady = false;
          if (window.THREE && window.THREE.DRACOLoader) {
            try {
              var draco = new window.THREE.DRACOLoader();
              draco.setDecoderPath("/studio/vendor/");
              draco.setDecoderConfig({ type: "js" });
              window.THREE._agathaDraco = draco;
              dracoReady = true;
            } catch (e) {
              /* draco optional, sprite fallback wins */
            }
          }
          var WR = window.WorldRealism;
          /* For Agatha use the BARE GLTFLoader + DRACOLoader path directly
           * (bypassing WR's concurrency queue which stalls the hero model
           * behind ~7 prop .glb loads). The bare path has DRACOLoader wired
           * so KHR_draco_mesh_compression models decode, and onModelOk
           * handles the 1.7m normalize + ground itself. WR is the fallback
           * only when bare GLTFLoader is unavailable. */
          if (window.THREE && window.THREE.GLTFLoader) {
            var gl = new window.THREE.GLTFLoader();
            if (dracoReady && window.THREE._agathaDraco) {
              try {
                gl.setDRACOLoader(window.THREE._agathaDraco);
              } catch (e) {}
            }
            gl.load(
              AGATHA_URL,
              function (g) {
                onModelOk(g && (g.scene || g), g && g.animations);
              },
              undefined,
              onModelFail,
            );
          } else if (WR && typeof WR.loadGlbModel === "function") {
            usedWR = true;
            WR.loadGlbModel(AGATHA_URL, onModelOk, {
              targetLength: 1.7,
              onError: onModelFail,
              dracoLoader: window.THREE && window.THREE._agathaDraco,
            });
          } else {
            onModelFail(new Error("no loader present"));
            return;
          }
        } catch (err) {
          onModelFail(err);
          return;
        }
        /* 8s total budget: a late .glb loses to the sprite. */
        try {
          loadTimer = setTimeout(function () {
            loadTimer = 0;
            if (!loadDone) onModelFail(new Error("30s timeout"));
          }, 30000);
        } catch (err) {
          /* timers unavailable: loader pace wins */
        }
      })();

      readDifficulty();
      setTier(tier);

      /* ---------- public handle (arch Section 1, verbatim shape) ---------- */
      return {
        update: update,
        getGroup: function () { return group; },
        getPos: function () { return { x: ax, y: 0, z: az, dead: deadDownT > 0 }; },
        damage: function (dmg, isHead) {
          if (deadDownT > 0) return { killed: false, hp: 0 };
          alphaHP = Math.max(0, alphaHP - (dmg || 35));
          suspicion = TH_CONFIRM;
          if (st !== "CHASE") enter("CHASE", ax, az);
          if (alphaHP <= 0) {
            deadDownT = 5.5;
            catchT = 0;
            if (deadAction) {
              try {
                if (idleAction) idleAction.setEffectiveWeight(0);
                if (walkAction) walkAction.setEffectiveWeight(0);
                if (runAction) runAction.setEffectiveWeight(0);
                deadAction.reset().play();
              } catch (eK) {}
            }
            return { killed: true, hp: 0, boss: true };
          }
          hitStaggerT = isHead ? 0.55 : 0.28;
          if (hitAction) {
            try { hitAction.reset().play(); } catch (eH) {}
          }
          return { killed: false, hp: alphaHP, boss: true };
        },

        getState: function () {
          return {
            state: st,
            suspicion: Math.round(suspicion),
            dist: Math.round(lastDist * 10) / 10,
            alert01: STATE_ALERT[st] !== undefined ? STATE_ALERT[st] : 0.15,
          };
        },

        reset: function () {
          ax = ROUTE[0][0];
          az = ROUTE[0][1];
          yaw = Math.atan2(ROUTE[1][0] - ax, ROUTE[1][1] - az);
          st = "PATROL";
          suspicion = 0;
          stateT = 0;
          routeIdx = 0;
          spurCycle = 0;
          spurPts = null;
          spurI = 0;
          dwellT = 0;
          hasStim = false;
          stimX = ROUTE[0][0];
          stimZ = ROUTE[0][1];
          scanning = false;
          hasSeen = false;
          searchLegs = null;
          searchI = 0;
          legPause = 0;
          sightDwell = 0;
          proxDwell = 0;
          runDwell = 0;
          walkDwell = 0;
          losLost = 0;
          noSenseT = 0;
          hideCrouchT = 0;
          catchT = 0;
          repathT = 0;
          pathFailT = 0;
          b1done = false;
          b2done = false;
          prevInB = false;
          finaleDone = false;
          caughtFired = false;
          lastDist = 99;
          stepAcc = 0;
          sideT = 0;
          stuckX = ax;
          stuckZ = az;
          stuckT = 0;
          pathN = 0;
          pathI = 0;
          readDifficulty();
          goto(ROUTE[0][0], ROUTE[0][1]);
          animate(0.016, 0);
        },

        setAlert: function (level) {
          if (st === "CAUGHT") return;
          var lv = +level || 0;
          var px = 0;
          var pz = 8.5;
          try {
            if (player && player.pos) {
              var pp = player.pos();
              px = pp.x;
              pz = pp.z;
            }
          } catch (err) {
            /* stimulus defaults stand */
          }
          if (lv === 2) {
            /* Force CHASE + immediate repath; senses take over after.
             * The stimulus doubles as the SEARCH fallback target. */
            stimX = px;
            stimZ = pz;
            hasStim = true;
            enter("CHASE", px, pz);
          } else if (lv === 1) {
            /* Suspicious ping at the player's cell. */
            stimX = px;
            stimZ = pz;
            hasStim = true;
            suspicion = Math.max(suspicion, 35);
            if (st === "PATROL" || st === "SEARCH") {
              enter("SUSPICIOUS", px, pz);
            } else if (st === "SUSPICIOUS") {
              goto(stimX, stimZ);
            } else if (st === "CHASE") {
              goto(px, pz);
            }
          } else {
            /* Calm bias back toward PATROL. */
            suspicion = 0;
            if (st === "SUSPICIOUS") {
              st = "PATROL";
              stateT = 0;
              goto(ROUTE[routeIdx][0], ROUTE[routeIdx][1]);
            }
          }
        },

        onCaught: function (cb) {
          caughtCb = typeof cb === "function" ? cb : null;
        },

        /* Live AI Director brain hook: order =
         * { tactic, targetRoom, alertBoost, whisper }. Steers Agatha toward
         * the target room through the EXISTING stimulus/spur/SEARCH-leg
         * machinery (A* goto, no teleport), primes suspicion so CHASE still
         * triggers organically via senses, and fires a spatial whisper.
         * Safe no-op for unknown rooms (boost still applies) and CAUGHT. */
        applyDirectorOrder: function (order) {
          try {
            if (!order || st === "CAUGHT") return;
            var boost = +order.alertBoost || 0;
            var tx = null;
            var tz = null;
            if (typeof order.targetRoom === "string" && order.targetRoom) {
              var key = order.targetRoom
                .toLowerCase()
                .replace(/^\s+|\s+$/g, "");
              var c = ROOM_CENTERS[key];
              if (c) {
                tx = c[0];
                tz = c[1];
              }
            }
            if (tx !== null && (st === "PATROL" || st === "SEARCH")) {
              stimX = tx;
              stimZ = tz;
              hasStim = true;
              if (st === "PATROL") {
                /* Single-leg spur detour: advanceRoute() clears it on
                 * arrival and resumes ROUTE, so the patrol cycle survives.
                 * Never clobbers an active scripted spur (S1/S2/S3). */
                if (!spurPts) {
                  spurPts = [[tx, tz]];
                  spurI = 0;
                  dwellT = 0;
                  goto(tx, tz);
                }
              } else {
                /* SEARCH: retarget the hunt legs at the ordered room. */
                searchLegs = [[tx, tz]];
                searchI = 0;
                legPause = 0;
                scanning = false;
                goto(tx, tz);
              }
            }
            if (boost) {
              suspicion += boost;
              if (suspicion < 0) suspicion = 0;
              if (suspicion > TH_CONFIRM) suspicion = TH_CONFIRM;
            }
            try {
              var A = window.StV_Audio;
              if (A && typeof A.queueWhisper === "function") {
                var mood =
                  lastDist < 6 ? "chase" : lastDist < 12 ? "near" : "distant";
                A.queueWhisper(mood);
              }
            } catch (errW) {
              /* audio optional */
            }
          } catch (err) {
            /* a director order never breaks the sim */
          }
        },
      };
    },
  };
})();
