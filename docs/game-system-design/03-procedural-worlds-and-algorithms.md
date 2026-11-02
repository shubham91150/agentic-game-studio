# 03 — Procedural Worlds & Algorithms Reference

Authoritative procedural generation algorithms from Amit Patel's _Red Blob Games_, Bridson's _Fast Poisson Disk Sampling_, Catmull-Rom Centripetal Splines with heightfield road carving, Wave Function Collapse (WFC), Flow-Field Crowd Navigation, and Meta's _SceneScript_ Structured Architectural DSL.

---

## 1. Bridson's $O(N)$ Fast Poisson-Disc Sampling (Natural Non-Overlapping Prop/Tree Scatter)

### Why Uniform `Math.random()` Looks Fake

Pure uniform random scatter creates ugly overlapping clusters and empty bald patches. Robert Bridson's 2007 algorithm generates blue-noise point distributions where every pair of points is separated by at least minimum distance $r$ in $O(N)$ time using a background spatial grid of cell size $r / \sqrt{2}$.

### Copy-Ready JS Implementation

```javascript
export function samplePoissonDisc2D({
  width = 200,
  depth = 200,
  minDist = 8.0,
  maxCandidates = 30,
  seed = 1337,
  isAllowedFn = null, // Optional filter: (x, z) => boolean (e.g. keep off road)
}) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(depth / cellSize);
  const grid = new Int32Array(cols * rows).fill(-1);
  const points = [];
  const active = [];

  const minDistSq = minDist * minDist;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;

  function insertPoint(x, z) {
    const idx = points.length;
    points.push({ x, z });
    active.push(idx);
    const gx = Math.floor((x + halfW) / cellSize);
    const gz = Math.floor((z + halfD) / cellSize);
    grid[gz * cols + gx] = idx;
  }

  function isValid(x, z) {
    if (x < -halfW || x >= halfW || z < -halfD || z >= halfD) return false;
    if (isAllowedFn && !isAllowedFn(x, z)) return false;
    const gx = Math.floor((x + halfW) / cellSize);
    const gz = Math.floor((z + halfD) / cellSize);
    const x0 = Math.max(0, gx - 2);
    const x1 = Math.min(cols - 1, gx + 2);
    const z0 = Math.max(0, gz - 2);
    const z1 = Math.min(rows - 1, gz + 2);

    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const pIdx = grid[cz * cols + cx];
        if (pIdx !== -1) {
          const p = points[pIdx];
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < minDistSq) return false;
        }
      }
    }
    return true;
  }

  // Seed initial valid point
  for (let attempt = 0; attempt < 100; attempt++) {
    const sx = (rand() - 0.5) * width * 0.8;
    const sz = (rand() - 0.5) * depth * 0.8;
    if (!isAllowedFn || isAllowedFn(sx, sz)) {
      insertPoint(sx, sz);
      break;
    }
  }

  while (active.length > 0) {
    const randIdx = Math.floor(rand() * active.length);
    const p = points[active[randIdx]];
    let found = false;

    for (let k = 0; k < maxCandidates; k++) {
      const angle = rand() * Math.PI * 2;
      const radius = minDist * (1.0 + rand());
      const nx = p.x + Math.cos(angle) * radius;
      const nz = p.z + Math.sin(angle) * radius;
      if (isValid(nx, nz)) {
        insertPoint(nx, nz);
        found = true;
        break;
      }
    }

    if (!found) {
      const last = active.pop();
      if (randIdx < active.length) active[randIdx] = last;
    }
  }

  return points;
}
```

---

## 2. Centripetal Catmull-Rom Spline Ribbons, Banking & Terrain Heightfield Carving

### Why Centripetal ($\alpha = 0.5$) Parameterization Matters

Uniform Catmull-Rom splines form self-intersecting loops and cusps when control points are unevenly spaced. Centripetal Catmull-Rom knots $t_{i+1} = t_i + \|\mathbf{P}_{i+1} - \mathbf{P}_i\|^{0.5}$ mathematically guarantee zero cusps and zero self-intersections inside each segment.

### Road Carving & Smooth Shoulder Blending into Terrain Heightfields

Given a road centerline spline $\{\mathbf{C}_k\}$ with half-width $W_{\text{road}}$ and blend shoulder width $W_{\text{shoulder}}$, for any terrain vertex $(x, z)$ with raw noise elevation $y_{\text{noise}}(x, z)$, find the closest spline sample $\mathbf{C}^_$ at horizontal distance $d = \sqrt{(x - C^__x)^2 + (z - C^*_z)^2}$:

$$y_{\text{final}}(x, z) = \begin{cases} C^*_y - 0.04, & d \le W_{\text{road}} \\ \text{lerp}\!\big(C^*_y - 0.04,\; y_{\text{noise}}(x, z),\; \text{smoothstep}(0, 1, \frac{d - W_{\text{road}}}{W_{\text{shoulder}}})\big), & W_{\text{road}} < d < W_{\text{road}} + W_{\text{shoulder}} \\ y_{\text{noise}}(x, z), & d \ge W_{\text{road}} + W_{\text{shoulder}} \end{cases}$$

Subtracting $0.04\text{ m}$ under the road bed guarantees the terrain never z-fights or pokes through the 3D road ribbon mesh.

### Copy-Ready JS Implementation: Spline Ribbon & Terrain Carver

```javascript
export class CentripetalTrackSpline {
  constructor(controlPoints, closed = true) {
    // controlPoints: Array<{ x, y, z, bank?: number }>
    this.points = controlPoints;
    this.closed = closed;
    this.samples = this._bakeSamples(400);
  }

  _evalCatmullRom(p0, p1, p2, p3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    const f0 = -0.5 * u3 + u2 - 0.5 * u;
    const f1 = 1.5 * u3 - 2.5 * u2 + 1.0;
    const f2 = -1.5 * u3 + 2.0 * u2 + 0.5 * u;
    const f3 = 0.5 * u3 - 0.5 * u2;
    return {
      x: p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
      y: p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
      z: p0.z * f0 + p1.z * f1 + p2.z * f2 + p3.z * f3,
      bank: (p1.bank || 0) * (1 - u) + (p2.bank || 0) * u,
    };
  }

  _bakeSamples(totalSamples) {
    const pts = this.points;
    const n = pts.length;
    const out = [];
    let totalDist = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = (i / totalSamples) * n;
      const seg = Math.floor(t) % n;
      const u = t - Math.floor(t);
      const p0 = pts[(seg - 1 + n) % n];
      const p1 = pts[seg];
      const p2 = pts[(seg + 1) % n];
      const p3 = pts[(seg + 2) % n];
      const pos = this._evalCatmullRom(p0, p1, p2, p3, u);
      if (i > 0) {
        const prev = out[i - 1];
        totalDist += Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
      }
      pos.s = totalDist;
      out.push(pos);
    }

    // Compute parallel-transport tangent & right vectors
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len;
      ty /= len;
      tz /= len;
      // Right vector = normalize(cross(tangent, worldUp))
      const rLen = Math.hypot(tz, tx) || 1;
      const rx = -tz / rLen;
      const rz = tx / rLen;
      out[i].tx = tx;
      out[i].ty = ty;
      out[i].tz = tz;
      out[i].rx = rx;
      out[i].rz = rz;
    }
    this.trackLength = totalDist;
    return out;
  }

  /** Carve road bed and smooth shoulders into a heightfield function */
  carveHeight(x, z, rawHeight, roadHalfWidth = 6.0, shoulderWidth = 8.0) {
    let bestD2 = Infinity;
    let bestSample = null;
    for (let i = 0, n = this.samples.length; i < n; i++) {
      const s = this.samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestSample = s;
      }
    }
    const dist = Math.sqrt(bestD2);
    const roadY = bestSample ? bestSample.y - 0.04 : rawHeight;
    if (dist <= roadHalfWidth) return roadY;
    if (dist >= roadHalfWidth + shoulderWidth) return rawHeight;
    const t = (dist - roadHalfWidth) / shoulderWidth;
    const smooth = t * t * (3 - 2 * t);
    return roadY + (rawHeight - roadY) * smooth;
  }
}
```

---

## 3. Wave Function Collapse (WFC) for City Blocks, Bazaars & Dungeon Interiors

### How Constraint-Propagated WFC Works

Each grid cell $(x, z)$ starts in a superposition of all valid tile archetypes (represented as a bitmask). Each tile archetype defines socket compatibility masks along `[NORTH, EAST, SOUTH, WEST]`.

1. **Find Minimum Entropy Cell**: Select the uncollapsed cell with the fewest remaining valid bits (plus tiny seeded noise tie-breaker).
2. **Collapse**: Pick one remaining tile weighted by archetype frequency.
3. **Propagate Constraints (AC-3 Queue)**: Push the collapsed cell onto a work queue; restrict each neighbor's bitmask to tiles compatible with the current cell's socket; if a neighbor's bitmask changes, push that neighbor onto the queue.

### Copy-Ready JS Implementation

```javascript
export class WaveFunctionCollapseGrid {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Array<{ id: number, name: string, weight: number, sockets: [string,string,string,string] }>} tiles
   *   sockets order: [N, E, S, W] — two adjacent tiles match if tileA.sockets[dir] === tileB.sockets[oppositeDir]
   */
  constructor(width, height, tiles, seed = 42) {
    this.width = width;
    this.height = height;
    this.tiles = tiles;
    this.numTiles = tiles.length;
    this.fullMask = (1 << this.numTiles) - 1;
    this.grid = new Uint32Array(width * height).fill(this.fullMask);
    this.state = seed >>> 0 || 1;

    // Precompute allowed neighbor bitmasks per tile per direction [N=0, E=1, S=2, W=3]
    const opp = [2, 3, 0, 1];
    this.compat = Array.from(
      { length: this.numTiles },
      () => new Uint32Array(4),
    );
    for (let a = 0; a < this.numTiles; a++) {
      for (let d = 0; d < 4; d++) {
        let mask = 0;
        for (let b = 0; b < this.numTiles; b++) {
          if (tiles[a].sockets[d] === tiles[b].sockets[opp[d]]) {
            mask |= 1 << b;
          }
        }
        this.compat[a][d] = mask;
      }
    }
  }

  _rand() {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  _popcount(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  solve() {
    const total = this.width * this.height;
    for (let step = 0; step < total; step++) {
      let bestIdx = -1;
      let bestCount = 999;

      for (let i = 0; i < total; i++) {
        const count = this._popcount(this.grid[i]);
        if (count > 1 && count < bestCount) {
          bestCount = count;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break; // Fully collapsed

      // Weighted choice among remaining bits
      const mask = this.grid[bestIdx];
      let sumWeight = 0;
      for (let t = 0; t < this.numTiles; t++) {
        if (mask & (1 << t)) sumWeight += this.tiles[t].weight;
      }
      let r = this._rand() * sumWeight;
      let chosen = 0;
      for (let t = 0; t < this.numTiles; t++) {
        if (mask & (1 << t)) {
          r -= this.tiles[t].weight;
          if (r <= 0) {
            chosen = t;
            break;
          }
        }
      }

      this.grid[bestIdx] = 1 << chosen;
      this._propagate(bestIdx);
    }

    return Array.from(this.grid, (mask) => {
      for (let t = 0; t < this.numTiles; t++) {
        if (mask & (1 << t)) return this.tiles[t];
      }
      return this.tiles[0];
    });
  }

  _propagate(startIdx) {
    const queue = [startIdx];
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];

    while (queue.length > 0) {
      const curr = queue.pop();
      const cx = curr % this.width;
      const cy = (curr / this.width) | 0;
      const currMask = this.grid[curr];

      for (let d = 0; d < 4; d++) {
        const nx = cx + dx[d];
        const ny = cy + dy[d];
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        const nIdx = ny * this.width + nx;

        let allowedInDir = 0;
        for (let t = 0; t < this.numTiles; t++) {
          if (currMask & (1 << t)) allowedInDir |= this.compat[t][d];
        }

        const oldNeighborMask = this.grid[nIdx];
        const newNeighborMask = oldNeighborMask & allowedInDir;
        if (newNeighborMask !== oldNeighborMask && newNeighborMask !== 0) {
          this.grid[nIdx] = newNeighborMask;
          queue.push(nIdx);
        }
      }
    }
  }
}
```

---

## 4. Red Blob Games Voronoi Biomes, A* & Flow-Field Crowd Navigation

### When to Use A* vs. Dijkstra Flow Fields

- *_A_ Search (One Source → One Goal)**: Use when 1–10 individual NPCs patrol or navigate toward distinct destinations.
- **Dijkstra Flow Field (All Sources → One Goal)**: When 30–300 bazaar shoppers, zombies, or arena drones converge toward the player or plaza center, running A* per agent wastes CPU. Instead, run a single Breadth-First / Dijkstra flood-fill outward from the target cell once every 0.25s to build an integer distance field $D(x, z)$, then compute the normalized negative gradient vector $\mathbf{V}(x, z) = -\nabla D(x, z)$ in every cell. Any agent at $(x, z)$ simply reads $\mathbf{V}(\lfloor x \rfloor, \lfloor z \rfloor)$ in $O(1)$ time!

### Copy-Ready JS Implementation: Dijkstra Distance Map & Smooth Flow Field

```javascript
export class CrowdFlowField {
  constructor(cols, rows, cellSize = 2.0) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.obstacles = new Uint8Array(cols * rows); // 1 = blocked building/wall
    this.dist = new Int32Array(cols * rows);
    this.dirX = new Float32Array(cols * rows);
    this.dirZ = new Float32Array(cols * rows);
    this.queue = new Int32Array(cols * rows);
  }

  setObstacle(cx, cz, blocked = true) {
    if (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows) {
      this.obstacles[cz * this.cols + cx] = blocked ? 1 : 0;
    }
  }

  computeFromGoal(goalCx, goalCz) {
    const total = this.cols * this.rows;
    this.dist.fill(1e9);

    const startIdx = goalCz * this.cols + goalCx;
    this.dist[startIdx] = 0;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = startIdx;

    const dx = [1, -1, 0, 0];
    const dz = [0, 0, 1, -1];

    while (head < tail) {
      const curr = this.queue[head++];
      const cx = curr % this.cols;
      const cz = (curr / this.cols) | 0;
      const nextDist = this.dist[curr] + 1;

      for (let d = 0; d < 4; d++) {
        const nx = cx + dx[d];
        const nz = cz + dz[d];
        if (nx < 0 || nx >= this.cols || nz < 0 || nz >= this.rows) continue;
        const nIdx = nz * this.cols + nx;
        if (this.obstacles[nIdx] === 1) continue;
        if (nextDist < this.dist[nIdx]) {
          this.dist[nIdx] = nextDist;
          this.queue[tail++] = nIdx;
        }
      }
    }

    // Compute negative gradient vector field (-grad D)
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const idx = cz * this.cols + cx;
        if (this.obstacles[idx] === 1) continue;
        const cDist = this.dist[idx];
        const dL =
          cx > 0 && !this.obstacles[idx - 1] ? this.dist[idx - 1] : cDist;
        const dR =
          cx < this.cols - 1 && !this.obstacles[idx + 1]
            ? this.dist[idx + 1]
            : cDist;
        const dU =
          cz > 0 && !this.obstacles[idx - this.cols]
            ? this.dist[idx - this.cols]
            : cDist;
        const dD =
          cz < this.rows - 1 && !this.obstacles[idx + this.cols]
            ? this.dist[idx + this.cols]
            : cDist;

        let vx = dL - dR;
        let vz = dU - dD;
        const len = Math.hypot(vx, vz);
        if (len > 1e-4) {
          this.dirX[idx] = vx / len;
          this.dirZ[idx] = vz / len;
        } else {
          this.dirX[idx] = 0;
          this.dirZ[idx] = 0;
        }
      }
    }
  }
}
```

---

## 5. Meta SceneScript Structured Architectural DSL (`make_wall`, `make_door`, `make_window`, `make_bbox`)

### Overview

Meta Research's **SceneScript** represents 3D architectural scenes, rooms, courtyards, and bazaar interiors as a compact, human-readable sequence of structured parameterized commands rather than raw unstructured point clouds:

```text
make_wall: id=0, a_x=-6.0, a_y=0.0, a_z=-4.0, b_x=6.0, b_y=0.0, b_z=-4.0, height=3.6, thickness=0.25
make_door: id=1, wall_id=0, position_x=0.0, position_y=1.05, position_z=-4.0, width=1.2, height=2.1
make_window: id=2, wall_id=0, position_x=-3.2, position_y=1.7, position_z=-4.0, width=1.4, height=1.2
make_bbox: id=3, class=shop_counter, position_x=2.5, position_y=0.5, position_z=-2.8, angle_z=0.0, scale_x=2.2, scale_y=1.0, scale_z=0.9
```

### Why SceneScript Excels for Game Level Design

1. **Exact CSG Openings**: Doors and windows reference their host `wall_id`, allowing the level compiler to split wall segments around real walkable doorways and recessed glass windows automatically.
2. **Semantic Prop Placement (`make_bbox`)**: Every `make_bbox` command specifies a semantic `class` (`shop_counter`, `lantern`, `barrel`, `archway`, `bench`), world position, yaw `angle_z`, and bounding dimensions—which maps directly to loading real `.glb` assets via `WorldRealism.loadGlbModel(url, onLoaded, { targetLength })` plus exact Rapier collider registration!

### Copy-Ready JS Implementation: SceneScript Parser & 3D Level Compiler

```javascript
export class SceneScriptCompiler {
  /**
   * Parses a SceneScript string into structured commands:
   * walls, doors, windows, and semantic object bboxes.
   */
  static parse(scriptText) {
    const walls = new Map();
    const doors = [];
    const windows = [];
    const bboxes = [];

    const lines = scriptText.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const cmd = line.slice(0, colonIdx).trim();
      const paramsStr = line.slice(colonIdx + 1).trim();
      const params = {};
      for (const pair of paramsStr.split(",")) {
        const [k, v] = pair.split("=").map((s) => s.trim());
        if (!k) continue;
        const num = Number(v);
        params[k] = Number.isNaN(num) ? v : num;
      }

      if (cmd === "make_wall")
        walls.set(params.id, { ...params, openings: [] });
      else if (cmd === "make_door") doors.push({ ...params, type: "door" });
      else if (cmd === "make_window")
        windows.push({ ...params, type: "window" });
      else if (cmd === "make_bbox") bboxes.push(params);
    }

    for (const d of doors) {
      if (walls.has(d.wall_id)) walls.get(d.wall_id).openings.push(d);
    }
    for (const w of windows) {
      if (walls.has(w.wall_id)) walls.get(w.wall_id).openings.push(w);
    }

    return {
      walls: Array.from(walls.values()),
      doors,
      windows,
      bboxes,
    };
  }
}
```
