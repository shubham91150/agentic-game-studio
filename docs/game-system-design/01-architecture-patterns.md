# 01 — Game Architecture Patterns Reference

Authoritative engineering patterns adapted from Robert Nystrom's _Game Programming Patterns_ and Glenn Fiedler's _Fix Your Timestep_, tailored for high-performance browser 3D games (Three.js r128 + Rapier 3D / custom physics) running at a deterministic 60 Hz simulation rate with zero garbage-collection stalls.

---

## 1. Fixed-Timestep Accumulator Loop with Render Interpolation ($\alpha$)

### Why Variable Timestep Fails

Passing variable frame delta (`dt = (now - last) / 1000`) directly into physics or character controllers causes:

1. **Non-determinism**: Floating-point integration error varies with frame rate.
2. **Spring/Damper Instability**: Stiff vehicle suspension ($F = -kx - c\dot{x}$) explodes when `dt > 1 / 30`.
3. **Tunneling**: A temporary tab switch or GC hiccup produces `dt = 0.25s`, teleporting vehicles and characters through walls.

### Mathematical Formulation

Let $\Delta t_{\text{fixed}} = \frac{1}{60}\text{ s} \approx 0.016667\text{ s}$. Each display frame advances real elapsed time $\Delta t_{\text{real}}$ (clamped to $\le 0.25\text{ s}$ to prevent the _spiral of death_):

$$\text{accumulator} \leftarrow \text{accumulator} + \min(\Delta t_{\text{real}}, 0.25)$$

While $\text{accumulator} \ge \Delta t_{\text{fixed}}$, Snapshot previous transforms $\mathbf{x}_{\text{prev}} \leftarrow \mathbf{x}_{\text{curr}}$, step the simulation by $\Delta t_{\text{fixed}}$, and subtract $\Delta t_{\text{fixed}}$ from $\text{accumulator}$.

After the inner loop terminates, leftover lag lies in $[0, \Delta t_{\text{fixed}})$. The normalized render interpolation factor is:

$$\alpha = \frac{\text{accumulator}}{\Delta t_{\text{fixed}}} \in [0, 1)$$

Visual meshes render at the interpolated transform:

$$\mathbf{x}_{\text{render}} = \text{lerp}(\mathbf{x}_{\text{prev}}, \mathbf{x}_{\text{curr}}, \alpha), \qquad \mathbf{q}_{\text{render}} = \text{slerp}(\mathbf{q}_{\text{prev}}, \mathbf{q}_{\text{curr}}, \alpha)$$

### Copy-Ready JS Implementation

```javascript
export class FixedTimestepLoop {
  constructor({
    fixedDt = 1 / 60,
    maxSubSteps = 5,
    onInput,
    onFixedUpdate,
    onRender,
  }) {
    this.fixedDt = fixedDt;
    this.maxFrameTime = fixedDt * maxSubSteps; // 0.0833s cap prevents spiral of death
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.timeScale = 1.0; // Used for hit-stop / slow-motion without breaking fixedDt
    this.hitStopRemaining = 0;

    this.onInput = onInput || (() => {});
    this.onFixedUpdate = onFixedUpdate || (() => {});
    this.onRender = onRender || (() => {});
    this._tick = this._tick.bind(this);
  }

  triggerHitStop(durationRealSeconds = 0.07, slowScale = 0.05) {
    this.hitStopRemaining = Math.max(
      this.hitStopRemaining,
      durationRealSeconds,
    );
    this.timeScale = slowScale;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now() * 0.001;
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _tick(nowMs) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    const now = nowMs * 0.001;
    let rawDt = now - this.lastTime;
    this.lastTime = now;

    if (rawDt <= 0) return;
    if (rawDt > this.maxFrameTime) rawDt = this.maxFrameTime;

    // Real-time hit-stop decay (unaffected by timeScale)
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= rawDt;
      if (this.hitStopRemaining <= 0) {
        this.hitStopRemaining = 0;
        this.timeScale = 1.0;
      }
    }

    this.onInput(rawDt);
    this.accumulator += rawDt * this.timeScale;

    while (this.accumulator >= this.fixedDt) {
      this.onFixedUpdate(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }

    const alpha = this.accumulator / this.fixedDt;
    this.onRender(alpha, rawDt);
  }
}
```

---

## 2. Hierarchical Finite State Machine (HFSM) & Pushdown Automaton

### Why Flat Booleans Fail

Flags like `isJumping`, `isDucking`, `isDashing`, `isPaused`, `isInDialogue` create $2^N$ invalid combinations (e.g., jumping while inside a shopkeeper dialogue modal). Combining **Hierarchical State Inheritance** (substates delegate unhandled inputs to superstates) with a **Pushdown Stack** (temporary states like `Paused`, `Dialogue`, or `HitStun` push onto the stack and pop back to the exact prior state) eliminates invalid state combinations.

### Copy-Ready JS Implementation

```javascript
export class HierarchicalStateMachine {
  constructor(owner) {
    this.owner = owner;
    this.states = new Map();
    this.stack = [];
  }

  /**
   * @param {string} name
   * @param {object} config - { parent?: string, enter?, exit?, update?, handleInput? }
   */
  register(name, config) {
    this.states.set(name, {
      name,
      parent: config.parent || null,
      enter: config.enter || (() => {}),
      exit: config.exit || (() => {}),
      update: config.update || (() => {}),
      handleInput: config.handleInput || (() => false),
    });
    return this;
  }

  get current() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /** Replace top state (standard transition) */
  changeState(name, payload) {
    const next = this.states.get(name);
    if (!next) throw new Error("Unknown state");
    if (this.current) {
      this.current.exit(this.owner, next.name);
      this.stack.pop();
    }
    this.stack.push(next);
    next.enter(this.owner, payload);
  }

  /** Push temporary interrupt state (e.g. Dialogue, Pause, HitStun) */
  pushState(name, payload) {
    const next = this.states.get(name);
    if (!next) throw new Error("Unknown state");
    this.stack.push(next);
    next.enter(this.owner, payload);
  }

  /** Pop interrupt state and resume previous state without re-triggering its enter() */
  popState() {
    if (this.stack.length <= 1) return null;
    const popped = this.stack.pop();
    popped.exit(this.owner, this.current.name);
    return popped;
  }

  /** Update walks from active substate up the parent hierarchy */
  update(dt) {
    let node = this.current;
    while (node) {
      node.update(this.owner, dt);
      node = node.parent ? this.states.get(node.parent) : null;
    }
  }

  /** Input walks up parent chain until a state returns true (consumed) */
  handleInput(action, value) {
    let node = this.current;
    while (node) {
      if (node.handleInput(this.owner, action, value) === true) {
        return true;
      }
      node = node.parent ? this.states.get(node.parent) : null;
    }
    return false;
  }
}
```

---

## 3. Data-Oriented Entity-Component-System (ECS) in Plain JS

### Architecture

Instead of deep OOP inheritance trees (`Vehicle extends MovableEntity extends Actor`), an ECS stores:

- **Entities**: Integer IDs (`0 .. maxEntities - 1`).
- **Components**: Structure-of-Arrays (SoA) `Float32Array` / `Int32Array` buffers or typed component stores indexed by entity ID for cache locality and zero GC churn.
- **Bitmask Signatures**: A 32-bit integer mask per entity (`entityMasks[id]`) enabling $O(1)$ archetype filtering (`(mask & requiredMask) === requiredMask`).

### Copy-Ready JS Implementation

```javascript
export const COMP = {
  TRANSFORM: 1 << 0,
  VELOCITY: 1 << 1,
  COLLIDER: 1 << 2,
  HEALTH: 1 << 3,
  AI_AGENT: 1 << 4,
  COLLECTIBLE: 1 << 5,
  VISUAL_MESH: 1 << 6,
};

export class TinyECS {
  constructor(maxEntities = 2048) {
    this.maxEntities = maxEntities;
    this.masks = new Uint32Array(maxEntities);
    this.freeIds = [];
    for (let i = maxEntities - 1; i >= 0; i--) this.freeIds.push(i);
    this.activeEntities = [];

    // Structure-of-Arrays (SoA) hot physics buffers
    this.posX = new Float32Array(maxEntities);
    this.posY = new Float32Array(maxEntities);
    this.posZ = new Float32Array(maxEntities);
    this.prevX = new Float32Array(maxEntities);
    this.prevY = new Float32Array(maxEntities);
    this.prevZ = new Float32Array(maxEntities);
    this.yaw = new Float32Array(maxEntities);
    this.prevYaw = new Float32Array(maxEntities);

    this.velX = new Float32Array(maxEntities);
    this.velY = new Float32Array(maxEntities);
    this.velZ = new Float32Array(maxEntities);
    this.radius = new Float32Array(maxEntities);

    // Cold object references (Three.js Object3D, AI blackboards)
    this.meshes = new Array(maxEntities).fill(null);
    this.meta = new Array(maxEntities).fill(null);
  }

  createEntity() {
    if (this.freeIds.length === 0) return -1;
    const id = this.freeIds.pop();
    this.masks[id] = 0;
    this.activeEntities.push(id);
    return id;
  }

  destroyEntity(id) {
    this.masks[id] = 0;
    this.meshes[id] = null;
    this.meta[id] = null;
    const idx = this.activeEntities.indexOf(id);
    if (idx !== -1) {
      const last = this.activeEntities.pop();
      if (idx < this.activeEntities.length) this.activeEntities[idx] = last;
    }
    this.freeIds.push(id);
  }

  addTransform(id, x, y, z, yaw = 0) {
    this.masks[id] |= COMP.TRANSFORM;
    this.posX[id] = this.prevX[id] = x;
    this.posY[id] = this.prevY[id] = y;
    this.posZ[id] = this.prevZ[id] = z;
    this.yaw[id] = this.prevYaw[id] = yaw;
  }

  addVelocity(id, vx = 0, vy = 0, vz = 0) {
    this.masks[id] |= COMP.VELOCITY;
    this.velX[id] = vx;
    this.velY[id] = vy;
    this.velZ[id] = vz;
  }

  /** Step kinematics and snapshot previous state for alpha interpolation */
  stepKinematics(dt) {
    const req = COMP.TRANSFORM | COMP.VELOCITY;
    const list = this.activeEntities;
    for (let i = 0, n = list.length; i < n; i++) {
      const id = list[i];
      if ((this.masks[id] & req) !== req) continue;
      this.prevX[id] = this.posX[id];
      this.prevY[id] = this.posY[id];
      this.prevZ[id] = this.posZ[id];
      this.prevYaw[id] = this.yaw[id];

      this.posX[id] += this.velX[id] * dt;
      this.posY[id] += this.velY[id] * dt;
      this.posZ[id] += this.velZ[id] * dt;
    }
  }

  /** Sync Three.js meshes using interpolated alpha */
  syncMeshes(alpha) {
    const req = COMP.TRANSFORM | COMP.VISUAL_MESH;
    const list = this.activeEntities;
    for (let i = 0, n = list.length; i < n; i++) {
      const id = list[i];
      if ((this.masks[id] & req) !== req) continue;
      const mesh = this.meshes[id];
      if (!mesh) continue;
      mesh.position.set(
        this.prevX[id] + (this.posX[id] - this.prevX[id]) * alpha,
        this.prevY[id] + (this.posY[id] - this.prevY[id]) * alpha,
        this.prevZ[id] + (this.posZ[id] - this.prevZ[id]) * alpha,
      );
      mesh.rotation.y =
        this.prevYaw[id] + (this.yaw[id] - this.prevYaw[id]) * alpha;
    }
  }
}
```

---

## 4. Zero-GC Typed Object Pool (Swap-and-Pop Active Set)

### Why `new` and `Array.splice()` Cause Frame Stutters

Allocating particles, projectiles, tire skid marks, or floating damage numbers during gameplay triggers V8's generational garbage collector, causing 8–25 ms frame spikes. Pre-allocating a fixed pool with a swap-and-pop active index array guarantees **zero heap allocations** after boot and $O(1)$ spawn/release.

### Copy-Ready JS Implementation

```javascript
export class ZeroGCPool {
  /**
   * @param {number} capacity
   * @param {() => object} factoryFn - Called capacity times at boot
   * @param {(item: object) => void} resetFn - Resets item state on acquire
   */
  constructor(capacity, factoryFn, resetFn) {
    this.capacity = capacity;
    this.resetFn = resetFn || (() => {});
    this.items = new Array(capacity);
    this.activeCount = 0;

    for (let i = 0; i < capacity; i++) {
      const item = factoryFn(i);
      item._poolIndex = i;
      this.items[i] = item;
    }
  }

  acquire() {
    if (this.activeCount >= this.capacity) {
      // Steal oldest active slot (index 0) if pool is saturated
      const recycled = this.items[0];
      this.resetFn(recycled);
      return recycled;
    }
    const item = this.items[this.activeCount];
    this.activeCount++;
    this.resetFn(item);
    return item;
  }

  release(item) {
    const idx = item._poolIndex;
    if (idx >= this.activeCount) return; // Already inactive

    const lastIdx = this.activeCount - 1;
    const lastItem = this.items[lastIdx];

    // Swap released item with the last active item in O(1)
    this.items[idx] = lastItem;
    lastItem._poolIndex = idx;

    this.items[lastIdx] = item;
    item._poolIndex = lastIdx;

    this.activeCount--;
  }

  forEachActive(callback, dt) {
    // Iterate backward so callback can safely call release(item)
    for (let i = this.activeCount - 1; i >= 0; i--) {
      callback(this.items[i], dt);
    }
  }
}
```

---

## 5. Spatial Hash Grid & BVH Broadphase Collision

### Spatial Hash Grid (2D XZ Plane for Open Zones, Crowds, and Arenas)

Comparing all pairs of $N$ entities takes $O(N^2)$ checks ($500^2 = 250,000$ checks/frame). Partitioning space into uniform cells of size $S$ (where $S \ge 2 \times r_{\max}$) reduces queries to $O(1)$ per neighbor cell. Using a 1D hashed integer key `((cx * 73856093) ^ (cz * 19349663))` and pre-allocated bucket arrays avoids per-frame string key allocations (`"${cx},${cz}"`).

### Copy-Ready JS Implementation

```javascript
export class SpatialHashGridXZ {
  constructor(cellSize = 8.0, tableSize = 1024) {
    this.invCellSize = 1.0 / cellSize;
    this.tableMask = tableSize - 1; // tableSize must be power of 2
    this.buckets = Array.from({ length: tableSize }, () => []);
    this.queryResult = [];
  }

  _hash(cx, cz) {
    const h = Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663);
    return h & this.tableMask;
  }

  clear() {
    for (let i = 0, n = this.buckets.length; i < n; i++) {
      this.buckets[i].length = 0;
    }
  }

  insert(entityId, x, z) {
    const cx = Math.floor(x * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);
    this.buckets[this._hash(cx, cz)].push(entityId);
  }

  /**
   * Returns reusable array of entityIds within radius of (x, z).
   * Zero allocations per query.
   */
  queryRadius(x, z, radius) {
    this.queryResult.length = 0;
    const minCx = Math.floor((x - radius) * this.invCellSize);
    const maxCx = Math.floor((x + radius) * this.invCellSize);
    const minCz = Math.floor((z - radius) * this.invCellSize);
    const maxCz = Math.floor((z + radius) * this.invCellSize);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[this._hash(cx, cz)];
        for (let i = 0, n = bucket.length; i < n; i++) {
          this.queryResult.push(bucket[i]);
        }
      }
    }
    return this.queryResult;
  }
}
```

### Static AABB Bounding Volume Hierarchy (BVH) for Track/Building Raycasts & Collisions

When worlds contain unevenly distributed static buildings or track walls of varying sizes, a top-down median-split AABB tree answers frustum, ray, and box-overlap queries in $O(\log N)$ time:

```javascript
export class StaticBVH {
  constructor(items) {
    // items: Array<{ id, minX, minY, minZ, maxX, maxY, maxZ }>
    this.root = this._build(items.slice(), 0);
  }

  _build(list, depth) {
    if (list.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    if (list.length <= 2) {
      return {
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        leaf: list,
        left: null,
        right: null,
      };
    }
    const axis = depth % 2 === 0 ? "x" : "z";
    list.sort((a, b) =>
      axis === "x"
        ? a.minX + a.maxX - (b.minX + b.maxX)
        : a.minZ + a.maxZ - (b.minZ + b.maxZ),
    );
    const mid = list.length >> 1;
    return {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      leaf: null,
      left: this._build(list.slice(0, mid), depth + 1),
      right: this._build(list.slice(mid), depth + 1),
    };
  }

  querySphere(x, y, z, r, out = []) {
    out.length = 0;
    this._queryNode(this.root, x, y, z, r, out);
    return out;
  }

  _queryNode(node, x, y, z, r, out) {
    if (!node) return;
    if (
      x + r < node.minX ||
      x - r > node.maxX ||
      y + r < node.minY ||
      y - r > node.maxY ||
      z + r < node.minZ ||
      z - r > node.maxZ
    ) {
      return;
    }
    if (node.leaf) {
      for (let i = 0; i < node.leaf.length; i++) out.push(node.leaf[i]);
      return;
    }
    this._queryNode(node.left, x, y, z, r, out);
    this._queryNode(node.right, x, y, z, r, out);
  }
}
```

---

## 6. Command Pattern for Input Abstraction, Replay Ghost & Undo

### Why Reify Inputs as Command Objects

Hardcoding `if (keys['KeyW']) player.z -= 1` inside update methods breaks key-rebinding, touch-joystick parity, ghost lap replays (in racing games), and puzzle undo stacks (in Sokoban/escape games).

### Copy-Ready JS Implementation

```javascript
export class InputCommandRecorder {
  constructor() {
    this.tick = 0;
    this.recordedFrames = []; // For racing ghost or deterministic replay
    this.undoStack = []; // For grid/puzzle turn undo
  }

  reset() {
    this.tick = 0;
    this.recordedFrames.length = 0;
    this.undoStack.length = 0;
  }

  /**
   * Bit-pack continuous + discrete controls into a compact frame record
   * steer, throttle, brake quantized to Int8 (-127..127); buttons in Uint8 bitmask
   */
  recordTick(steer, throttle, brake, buttonMask) {
    this.recordedFrames.push({
      tick: this.tick++,
      s: Math.round(steer * 127),
      t: Math.round(throttle * 127),
      b: Math.round(brake * 127),
      btn: buttonMask & 0xff,
    });
  }

  /** Execute a reversible discrete move (Sokoban / grid puzzle) */
  executeReversible(command) {
    command.execute();
    this.undoStack.push(command);
  }

  undoLast() {
    if (this.undoStack.length === 0) return false;
    const cmd = this.undoStack.pop();
    cmd.undo();
    return true;
  }
}
```

---

## 7. Event Bus / PubSub Decoupling with Deferred Queue

### Why Systems Must Never Import Each Other Directly

When a vehicle clips an apex kerb or a player collects a relic, physics should **not** call `Audio.playSfx()`, `HUD.addScore()`, `VFX.spawnSparks()`, and `Achievements.unlock()`. Instead, physics emits a single domain event (`"apex_clipped"` or `"relic_collected"`), and independent subscribers react without coupling.

```javascript
export class GameEventBus {
  constructor() {
    this.listeners = new Map();
    this.deferredQueue = [];
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  /** Immediate synchronous dispatch */
  emit(event, payload) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (let i = 0, n = arr.length; i < n; i++) {
      arr[i](payload);
    }
  }

  /** Enqueue during physics substep; flush once after physics step completes */
  enqueue(event, payload) {
    this.deferredQueue.push({ event, payload });
  }

  flush() {
    for (let i = 0; i < this.deferredQueue.length; i++) {
      const item = this.deferredQueue[i];
      this.emit(item.event, item.payload);
    }
    this.deferredQueue.length = 0;
  }
}
```
