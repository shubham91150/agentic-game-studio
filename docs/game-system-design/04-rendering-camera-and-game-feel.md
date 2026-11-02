# 04 — Real-Time Rendering, Camera Systems & Game Feel ("Juice")

Authoritative reference for 3D camera kinematics, Squirrel Eiserloh / Mark Brown GMTK trauma-based 6-DOF camera shake, hit-stop frame freeze, FOV speed-warp, physically based rendering (PBR) energy conservation, tight directional shadow frustum fitting, and GPU draw-call / `InstancedMesh` culling budgets.

---

## 1. Spring-Damper Chase & Orbit Camera with Velocity Look-Ahead and Dutch Roll

### Why Simple `camera.position.lerp()` Fails

Naive frame-dependent `lerp(a, b, 0.1)` changes camera stiffness with refresh rate (60 Hz vs 144 Hz) and lags behind fast vehicles without anticipating corners. A critically damped second-order spring-damper (or exact frame-rate-independent exponential decay $1 - e^{-\lambda \Delta t}$) paired with **velocity look-ahead** and **cornering Dutch roll** delivers AAA racing and third-person action framing.

### Mathematical Model

Given target world position $\mathbf{p}$, forward unit vector $\mathbf{f}$, world velocity $\mathbf{v}$, and yaw rate $\omega$:

1. **Desired Camera Pivot**:
   $$\mathbf{c}_{\text{desired}} = \mathbf{p} - \mathbf{f} \cdot d_{\text{back}} + \mathbf{u}_{\text{up}} \cdot h_{\text{up}} + \mathbf{r}_{\text{right}} \cdot (\omega \cdot k_{\text{swing}})$$
2. **Velocity Look-Ahead Point**:
   $$\mathbf{l}_{\text{desired}} = \mathbf{p} + \mathbf{f} \cdot d_{\text{look}} + \mathbf{v} \cdot \tau_{\text{lead}} + \mathbf{u}_{\text{up}} \cdot h_{\text{look}}$$
3. **Critically Damped Spring Step** ($\omega_n$ natural frequency in $\text{rad/s}$):
   $$\mathbf{a}_c = \omega_n^2 (\mathbf{c}_{\text{desired}} - \mathbf{c}) - 2 \omega_n \mathbf{v}_c$$
4. **Cornering Dutch Roll ($\theta\_{\text{roll}}$)**:
   $$\theta_{\text{roll}} = \text{clamp}(-\omega \cdot k_{\text{roll}}, -\theta_{\max}, \theta_{\max})$$

---

## 2. Trauma-Based 6-DOF Camera Shake (Squirrel Eiserloh GDC / Mark Brown GMTK)

### Core Principles

1. **Additive Trauma ($T \in [0, 1]$)**: Impacts call `addTrauma(amount)`. Minor bumps add $0.15$; heavy collisions or explosions add $0.65$. Trauma decays linearly: $T \leftarrow \max(0, T - d_{\text{decay}} \Delta t)$.
2. **Nonlinear Shake Intensity ($S = T^2$ or $T^3$)**: Squaring or cubing trauma gives a smooth parabolic/cubic response—small trauma barely moves the lens, whereas $T \to 1.0$ delivers a violent punch that decays rapidly back to gentle motion.
3. **Smooth Continuous Noise (Never `Math.random()` per Frame)**: Drive translational $(dx, dy, dz)$ and rotational $(\text{pitch}, \text{yaw}, \text{roll})$ offsets via multi-frequency phase-shifted sinusoids / 1D Perlin noise evaluated at time $t \cdot f_{\text{shake}}$.
4. **Never Shake the Simulated Transform**: Apply shake offsets _after_ computing the clean camera position and look-at target so physics and aiming reticles never desync.

---

## 3. FOV Speed-Warp & Hit-Stop Frame Freeze

### Dynamic Speed FOV Warp

As vehicle or character speed $v$ rises toward $v_{\max}$ (plus optional nitro/dash boost $b \in [0, 1]$), widen vertical field of view from $\text{FOV}_{\text{base}} = 58^\circ$ up to $\text{FOV}_{\max} = 76^\circ$:

$$\text{FOV}_{\text{target}} = \text{FOV}_{\text{base}} + (\text{FOV}_{\max} - \text{FOV}_{\text{base}}) \cdot \text{clamp}\!\left(\left(\frac{v}{v_{\max}}\right)^{1.4} + 0.35 b,\; 0,\; 1\right)$$

Only call `camera.updateProjectionMatrix()` when $|\text{FOV} - \text{FOV}_{\text{prev}}| > 0.05^\circ$ to avoid redundant matrix uploads.

### Copy-Ready JS Implementation: Complete 3D Chase Camera + 6-DOF Trauma Shake + FOV Warp

```javascript
export class ChaseCameraSystem3D {
  constructor(camera, config = {}) {
    this.camera = camera;
    this.distBack = config.distBack || 7.2;
    this.heightUp = config.heightUp || 2.65;
    this.lookAheadDist = config.lookAheadDist || 6.0;
    this.lookHeight = config.lookHeight || 1.1;
    this.springOmega = config.springOmega || 14.0;
    this.baseFov = config.baseFov || 58;
    this.maxFov = config.maxFov || 75;
    this.maxSpeedRef = config.maxSpeedRef || 55;

    this.posX = 0;
    this.posY = 5;
    this.posZ = -10;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;

    this.lookX = 0;
    this.lookY = 1;
    this.lookZ = 0;
    this.dutchRoll = 0;

    // Trauma 6-DOF state
    this.trauma = 0;
    this.traumaDecay = 1.35;
    this.shakeTime = 0;
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, Math.max(0.0, this.trauma + amount));
  }

  snapToTarget(targetX, targetY, targetZ, yaw) {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    this.posX = targetX - sinY * this.distBack;
    this.posY = targetY + this.heightUp;
    this.posZ = targetZ - cosY * this.distBack;
    this.velX = this.velY = this.velZ = 0;
    this.lookX = targetX + sinY * this.lookAheadDist;
    this.lookY = targetY + this.lookHeight;
    this.lookZ = targetZ + cosY * this.lookAheadDist;
  }

  update(dt, target) {
    // target: { x, y, z, yaw, speed, yawRate, boostActive }
    const sinY = Math.sin(target.yaw);
    const cosY = Math.cos(target.yaw);
    const rightX = cosY;
    const rightZ = -sinY;

    const swing = Math.max(-1.2, Math.min(1.2, (target.yawRate || 0) * 0.35));
    const desX = target.x - sinY * this.distBack + rightX * swing;
    const desY = target.y + this.heightUp;
    const desZ = target.z - cosY * this.distBack + rightZ * swing;

    // Critically damped spring integration
    const w = this.springOmega;
    const ax = w * w * (desX - this.posX) - 2 * w * this.velX;
    const ay = w * w * (desY - this.posY) - 2 * w * this.velY;
    const az = w * w * (desZ - this.posZ) - 2 * w * this.velZ;

    this.velX += ax * dt;
    this.velY += ay * dt;
    this.velZ += az * dt;
    this.posX += this.velX * dt;
    this.posY += this.velY * dt;
    this.posZ += this.velZ * dt;

    // Smooth look-ahead target
    const speedLead = Math.min(8.0, Math.abs(target.speed || 0) * 0.14);
    const wantLookX = target.x + sinY * (this.lookAheadDist + speedLead);
    const wantLookY = target.y + this.lookHeight;
    const wantLookZ = target.z + cosY * (this.lookAheadDist + speedLead);
    const lookBlend = 1.0 - Math.exp(-16.0 * dt);
    this.lookX += (wantLookX - this.lookX) * lookBlend;
    this.lookY += (wantLookY - this.lookY) * lookBlend;
    this.lookZ += (wantLookZ - this.lookZ) * lookBlend;

    // 6-DOF Trauma Shake (visual offset only!)
    let shakeX = 0,
      shakeY = 0,
      shakeZ = 0;
    let shakePitch = 0,
      shakeYaw = 0,
      shakeRoll = 0;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
      const shake = this.trauma * this.trauma; // Quadratic curve
      this.shakeTime += dt * 34.0;
      const t = this.shakeTime;
      const n1 = Math.sin(t * 1.13) * 0.6 + Math.sin(t * 2.41) * 0.4;
      const n2 = Math.sin(t * 1.57 + 1.2) * 0.6 + Math.cos(t * 2.89) * 0.4;
      const n3 = Math.cos(t * 1.31 + 2.5) * 0.6 + Math.sin(t * 3.17) * 0.4;

      shakeX = 0.38 * shake * n1;
      shakeY = 0.32 * shake * n2;
      shakeZ = 0.25 * shake * n3;
      shakePitch = 0.035 * shake * n2;
      shakeYaw = 0.035 * shake * n1;
      shakeRoll = 0.065 * shake * n3;
    }

    // Apply position + lookAt + Dutch roll + rotational trauma
    this.camera.position.set(
      this.posX + shakeX,
      this.posY + shakeY,
      this.posZ + shakeZ,
    );
    this.camera.lookAt(this.lookX, this.lookY, this.lookZ);

    const targetDutch = Math.max(
      -0.055,
      Math.min(0.055, -(target.yawRate || 0) * 0.018),
    );
    this.dutchRoll += (targetDutch - this.dutchRoll) * lookBlend;
    this.camera.rotateZ(this.dutchRoll + shakeRoll);
    this.camera.rotateX(shakePitch);
    this.camera.rotateY(shakeYaw);

    // Dynamic FOV Speed-Warp
    const speedNorm = Math.min(
      1,
      Math.abs(target.speed || 0) / this.maxSpeedRef,
    );
    const boostAdd = target.boostActive ? 0.3 : 0.0;
    const targetFov =
      this.baseFov +
      (this.maxFov - this.baseFov) *
        Math.min(1, Math.pow(speedNorm, 1.35) + boostAdd);
    if (Math.abs(targetFov - this.camera.fov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8.0);
      this.camera.updateProjectionMatrix();
    }
  }
}
```

---

## 4. PBR Material Energy Conservation & ACES Filmic Lighting Rules

1. **Mandatory Tone Mapping & PMREM IBL**:
   Always configure `renderer.toneMapping = THREE.ACESFilmicToneMapping`, `renderer.outputEncoding = THREE.sRGBEncoding`, and generate an environment cubemap via `THREE.PMREMGenerator` assigned to `scene.environment` (handled automatically by `WorldRealism.createRealisticSkyAndLighting(scene, renderer, options)`). Without `scene.environment`, metallic surfaces (`metalness > 0.5`) reflect black void and appear pitch-dark.
2. **Albedo Luminance Bounds (Energy Conservation)**:
   Never use pure `#000000` or pure `#ffffff` base colors in `MeshStandardMaterial`:
   - Fresh Asphalt: `#26282c`, `roughness: 0.86`, `metalness: 0.04`
   - Weathered Brick / Sandstone: `#b56345` or `#d6b485`, `roughness: 0.84`, `metalness: 0.03`
   - Car Clearcoat Paint: `roughness: 0.22`, `metalness: 0.65`, `envMapIntensity: 1.35`
   - Architectural Glass: `#1d3549`, `roughness: 0.10`, `metalness: 0.85`
3. **Strict Ban on `MeshLambertMaterial` & Primitive Fakes**:
   `MeshLambertMaterial` lacks specular microfacet BRDF (`GGX`) and fails `visual_qa_gate.js`. Always use `MeshStandardMaterial`, `WorldRealism.createProceduralPBRMaterial(kind, opts)`, or AmbientCG/Polyhaven PBR textures.

---

## 5. Directional Shadow Frustum Tight-Fitting Around Player

A single `DirectionalLight` with a static $\pm 500\text{ m}$ orthographic shadow frustum wastes $95\%$ of its $2048 \times 2048$ shadow map texels ($0.49\text{ m/texel}$), producing jagged, flickering shadow edges or invisible shadows.
Instead, size the shadow frustum tightly (`[-65, 65]` meters = $0.063\text{ m/texel}$) and **translate the sun light + target with the player every frame**, snapped to world-space texel increments to eliminate shadow-edge shimmering:

```javascript
export function updateTightPlayerShadowFrustum(
  sunLight,
  playerPos,
  sunOffsetVec,
  frustumHalfSize = 65,
  shadowMapRes = 2048,
) {
  // Snap center to shadow texel grid to prevent sub-texel swimming while moving
  const texelWorldSize = (frustumHalfSize * 2) / shadowMapRes;
  const snappedX = Math.round(playerPos.x / texelWorldSize) * texelWorldSize;
  const snappedZ = Math.round(playerPos.z / texelWorldSize) * texelWorldSize;

  sunLight.target.position.set(snappedX, playerPos.y, snappedZ);
  sunLight.target.updateMatrixWorld();

  sunLight.position.set(
    snappedX + sunOffsetVec.x,
    playerPos.y + sunOffsetVec.y,
    snappedZ + sunOffsetVec.z,
  );
}
```

---

## 6. Draw-Call Batching & `InstancedMesh` Culling Budgets

To hold a locked **60 FPS** ($\le 16.6\text{ ms/frame}$) in WebGL:

| Resource Metric                                         | Target Budget (Desktop/Mobile WebGL) | Hard Ceiling          | Implementation Strategy                                                                                                   |
| :------------------------------------------------------ | :----------------------------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **Draw Calls (`renderer.info.render.calls`)**           | $\le 120$ calls                      | $220$ calls           | Batch repeated props (trees, kerbs, lanterns, barriers, grass) into `THREE.InstancedMesh`                                 |
| **Active Triangles (`renderer.info.render.triangles`)** | $80\text{k} - 250\text{k}$           | $450\text{k}$         | Decimate dense `.glb` scans via `blender_cleanup.py`; cull distant chunks                                                 |
| **3D Grass Blades**                                     | $20,000 - 35,000$ blades             | $50,000$ blades       | Single `InstancedMesh` 5-vertex tapered blade with `onBeforeCompile` vertex wind sway (`WorldRealism.create3DGrassField`) |
| **Shadow-Casting Lights**                               | $1$ primary `DirectionalLight`       | $2$ lights            | Use emissive materials + baked AO or cheap unshadowed `PointLight` (max 4 active) for street lanterns                     |
| **Per-Frame Heap Allocations**                          | $0\text{ objects/frame}$             | $< 4\text{ KB/frame}$ | Reuse module-scope scratch `_vec3`, `_quat`, `_mat4` and `ZeroGCPool`                                                     |
