# 02 — Vehicle & Character Physics Math Reference

Authoritative rigid-body vehicle dynamics (adapted from Marco Monster's _Car Physics for Games_, Pacejka's Magic Formula, and raycast suspension models) alongside 3D Character Controller math (adapted from _Quake III_ air-accelerate, _Celeste_ jump shaping, and capsule step-up/slope kinematics).

---

## Part I: Marco Monster's Car Physics for Games

### 1. Vehicle Geometry & Longitudinal Forces

Let a vehicle have mass $m$ (e.g., $1350\text{ kg}$), wheelbase $L = b + c$ (where $b$ is distance from CG to front axle and $c$ is distance from CG to rear axle), track width $w$, CG height $h$, and yaw moment of inertia $I_{zz} \approx \frac{1}{12} m (L^2 + w^2)$.

In the vehicle's local frame (forward $+z$ or $+x$, lateral $+y$ or $+x$), longitudinal net force is:

$$F_{\text{long}} = F_{\text{traction}} - F_{\text{brake}} - F_{\text{drag}} - F_{\text{rr}} - m g \sin(\theta_{\text{pitch}})$$

- **Aerodynamic Drag** (quadratic in speed $v$):
  $$F_{\text{drag}} = \frac{1}{2} \rho C_d A \, v |v| = C_{\text{drag}} \, v |v| \quad (C_{\text{drag}} \approx 0.4257\text{ N}\cdot\text{s}^2/\text{m}^2)$$
- **Rolling Resistance** (linear in speed, ~30× $C_{\text{drag}}$ at low speed; equals drag around $100\text{ km/h} \approx 27.8\text{ m/s}$):
  $$F_{\text{rr}} = C_{\text{rr}} \, v \quad (C_{\text{rr}} \approx 12.8\text{ N}\cdot\text{s}/\text{m})$$

---

### 2. Longitudinal & Lateral Weight Transfer

During acceleration $a_{\text{long}}$ and cornering acceleration $a_{\text{lat}}$, inertia pitches and rolls the chassis, shifting normal load $W$ across the axles:

$$\Delta W_{\text{long}} = \frac{h}{L} \, m \, a_{\text{long}}, \qquad \Delta W_{\text{lat}} = \frac{h}{w} \, m \, a_{\text{lat}}$$

Static vs. dynamic axle loads:
$$W_{\text{front}} = \frac{c}{L} m g - \frac{h}{L} m a_{\text{long}}, \qquad W_{\text{rear}} = \frac{b}{L} m g + \frac{h}{L} m a_{\text{long}}$$

Maximum traction or lateral grip on any tire is bounded by its Friction Circle:

$$\sqrt{F_{x,\text{tire}}^2 + F_{y,\text{tire}}^2} \le \mu \, W_{\text{tire}}$$

Under heavy braking ($a_{\text{long}} < 0$), $W_{\text{front}}$ increases and $W_{\text{rear}}$ drops—explaining why trail-braking into a corner increases front turn-in bite while unloading the rear axle into oversteer.

---

### 3. Engine Torque Curve, Gear Ratios & Wheel RPM

Wheel angular velocity $\omega_w = v_{\text{long}} / R_w$ (where $R_w \approx 0.33\text{ m}$) maps to engine RPM via gear ratio $g_k$ and final drive differential ratio $G_{\text{diff}}$:

$$\text{RPM} = \text{clamp}\!\left(\frac{v_{\text{long}}}{R_w} \cdot g_k \cdot G_{\text{diff}} \cdot \frac{60}{2\pi},\; \text{RPM}_{\text{idle}},\; \text{RPM}_{\text{redline}}\right)$$

Drive torque delivered to the rear/all wheels with drivetrain efficiency $\eta \approx 0.82$:

$$T_{\text{drive}} = T_{\text{engine}}(\text{RPM}) \cdot g_k \cdot G_{\text{diff}} \cdot \eta, \qquad F_{\text{traction}} = \frac{T_{\text{drive}}}{R_w}$$

Typical 6-speed sports car ratios:

- $g_1 = 3.16,\; g_2 = 2.05,\; g_3 = 1.48,\; g_4 = 1.16,\; g_5 = 0.94,\; g_6 = 0.78,\; g_R = -2.90,\; G_{\text{diff}} = 3.42$.

---

### 4. Ackermann Steering Geometry

When turning at steering angle $\delta$ around a turn center of radius $R$, the inner front wheel traces a tighter circle than the outer front wheel to prevent tire scrubbing:

$$\cot(\delta_{\text{outer}}) - \cot(\delta_{\text{inner}}) = \frac{w}{L}$$

Explicit inner and outer steering angles for nominal steer input $\delta$:

$$\delta_{\text{inner}} = \arctan\!\left(\frac{L}{L / \tan(\delta) - w/2}\right), \qquad \delta_{\text{outer}} = \arctan\!\left(\frac{L}{L / \tan(\delta) + w/2}\right)$$

At high speed, apply speed-sensitive steering attenuation so the car does not twitch on straights:

$$\delta_{\text{effective}} = \delta_{\text{input}} \cdot \delta_{\max} \cdot \frac{1}{1 + k_{\text{speed}} \cdot v_{\text{long}}^2}$$

---

### 5. Lateral Cornering Stiffness & Slip Angle ($\alpha$)

When a car has forward speed $v_x$, lateral slide speed $v_y$, and yaw rate $\omega$ ($\text{rad/s}$), the front and rear axles experience slip angles $\alpha_f, \alpha_r$ between where the wheel points and where it actually travels:

$$\alpha_{\text{front}} = \arctan\!\left(\frac{v_y + \omega \cdot b}{|v_x| + \epsilon}\right) - \delta \cdot \text{sgn}(v_x)$$

$$\alpha_{\text{rear}} = \arctan\!\left(\frac{v_y - \omega \cdot c}{|v_x| + \epsilon}\right)$$

For small slip angles ($|\alpha| < 8^\circ$), lateral force is proportional to cornering stiffness $C_\alpha$ ($\approx 5.0\text{ rad}^{-1}$ normalized by normal load), clamped to peak friction $\mu W$:

$$F_{y,\text{front}} = \text{clamp}(-C_{\alpha,f} \, \alpha_{\text{front}}, -\mu_f, \mu_f) \cdot W_{\text{front}}$$

$$F_{y,\text{rear}} = \text{clamp}(-C_{\alpha,r} \, \alpha_{\text{rear}}, -\mu_r, \mu_r) \cdot W_{\text{rear}}$$

Yaw torque about the center of gravity:

$$\tau_{\text{yaw}} = b \, F_{y,\text{front}} \cos(\delta) - c \, F_{y,\text{rear}}, \qquad \dot{\omega} = \frac{\tau_{\text{yaw}}}{I_{zz}}$$

Pulling the handbrake drops $\mu_r$ (e.g., from $1.15$ to $0.55$), saturating $F_{y,\text{rear}}$ and inducing a controllable drift yaw moment.

---

### 6. 4-Point Raycast Suspension Spring-Damper

Each wheel $i \in \{FL, FR, RL, RR\}$ casts a vertical ray of rest length $L_0$ downward from its chassis mount. If the ground hit distance is $d < L_0$, suspension compression is $x_i = L_0 - d$ and compression velocity is $\dot{x}_i = (x_i - x_{i,\text{prev}}) / \Delta t$:

$$F_{\text{susp},i} = \max\big(0,\; k_s \, x_i + c_d \, \dot{x}_i\big)$$

where spring stiffness $k_s = \frac{m g}{4 \, x_{\text{sag}}}$ (for static sag $x_{\text{sag}} \approx 0.08\text{ m}$) and critical damping $c_d = 2 \zeta \sqrt{k_s \, (m/4)}$ with damping ratio $\zeta \in [0.65, 0.85]$.

### Copy-Ready JS Implementation: Marco Monster Vehicle Dynamics

```javascript
export class VehicleDynamics3D {
  constructor(config = {}) {
    this.mass = config.mass || 1350;
    this.wheelbase = config.wheelbase || 2.65;
    this.cgToFront = config.cgToFront || 1.25; // b
    this.cgToRear = this.wheelbase - this.cgToFront; // c
    this.cgHeight = config.cgHeight || 0.52; // h
    this.trackWidth = config.trackWidth || 1.62; // w
    this.wheelRadius = config.wheelRadius || 0.33;
    this.inertiaYaw =
      config.inertiaYaw ||
      (1 / 12) * this.mass * (this.wheelbase ** 2 + this.trackWidth ** 2);

    this.cDrag = config.cDrag || 0.42;
    this.cRollRes = config.cRollRes || 12.8;
    this.cornerStiffFront = config.cornerStiffFront || 5.2;
    this.cornerStiffRear = config.cornerStiffRear || 5.4;
    this.gripFront = config.gripFront || 1.22;
    this.gripRear = config.gripRear || 1.25;
    this.maxSteerRad = config.maxSteerRad || 0.58; // ~33 deg

    this.gearRatios = [3.16, 2.05, 1.48, 1.16, 0.94, 0.78];
    this.finalDrive = 3.42;
    this.currentGear = 0;
    this.rpm = 1000;

    // State in world space
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    // Velocity in vehicle local frame (vx = forward, vy = lateral right)
    this.vx = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.longAccel = 0;
    this.latAccel = 0;
    this.slipRatioRear = 0;
  }

  sampleEngineTorque(rpm) {
    // Realistic sports-car torque curve peaking at 440 Nm @ 4600 RPM
    const norm = Math.max(0, Math.min(1, (rpm - 1000) / 6500));
    return 290 + 165 * Math.sin(norm * Math.PI * 0.88);
  }

  step(dt, input) {
    // input: { throttle: 0..1, brake: 0..1, steer: -1..1, handbrake: boolean }
    const speed = Math.hypot(this.vx, this.vy);

    // 1. Speed-sensitive steering + smooth steer actuator rate
    const speedFactor = 1.0 / (1.0 + 0.0014 * this.vx * this.vx);
    const targetSteer = input.steer * this.maxSteerRad * speedFactor;
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, dt * 10.0);

    // 2. Automatic transmission RPM & gear selection
    const gearRatio = this.gearRatios[this.currentGear];
    const wheelRadPerSec = Math.abs(this.vx) / this.wheelRadius;
    this.rpm = Math.max(
      1000,
      Math.min(
        7500,
        wheelRadPerSec * gearRatio * this.finalDrive * (60 / (2 * Math.PI)),
      ),
    );
    if (this.rpm > 6900 && this.currentGear < this.gearRatios.length - 1) {
      this.currentGear++;
    } else if (
      this.rpm < 2800 &&
      this.currentGear > 0 &&
      Math.abs(this.vx) > 2
    ) {
      this.currentGear--;
    }

    // 3. Dynamic weight transfer (W_front, W_rear)
    const g = 9.81;
    const wFrontStatic = (this.cgToRear / this.wheelbase) * this.mass * g;
    const wRearStatic = (this.cgToFront / this.wheelbase) * this.mass * g;
    const dW = (this.cgHeight / this.wheelbase) * this.mass * this.longAccel;
    const wFront = Math.max(1500, wFrontStatic - dW);
    const wRear = Math.max(1500, wRearStatic + dW);

    // 4. Longitudinal traction, braking, drag, and rolling resistance
    const maxEngineTorque = this.sampleEngineTorque(this.rpm);
    const driveForce =
      ((input.throttle * maxEngineTorque * gearRatio * this.finalDrive * 0.84) /
        this.wheelRadius) *
      (input.reverse ? -0.6 : 1.0);
    const brakeForce = -Math.sign(this.vx || 1) * input.brake * 14500;
    const fDrag = -this.cDrag * this.vx * Math.abs(this.vx);
    const fRoll = -this.cRollRes * this.vx;

    const maxRearTraction = this.gripRear * wRear;
    const clampedDrive = Math.max(
      -maxRearTraction,
      Math.min(maxRearTraction, driveForce),
    );
    const fLong = clampedDrive + brakeForce + fDrag + fRoll;

    // 5. Slip angles (alpha_front, alpha_rear) & lateral cornering forces
    const absVx = Math.max(2.2, Math.abs(this.vx));
    const signVx = this.vx >= 0 ? 1 : -1;
    const alphaFront =
      Math.atan2(this.vy + this.yawRate * this.cgToFront, absVx) -
      this.steerAngle * signVx;
    const alphaRear = Math.atan2(this.vy - this.yawRate * this.cgToRear, absVx);

    const rearGrip = input.handbrake ? this.gripRear * 0.48 : this.gripRear;
    const fyFront =
      Math.max(
        -this.gripFront,
        Math.min(this.gripFront, -this.cornerStiffFront * alphaFront),
      ) * wFront;
    const fyRear =
      Math.max(
        -rearGrip,
        Math.min(rearGrip, -this.cornerStiffRear * alphaRear),
      ) * wRear;

    // Zero out lateral creep at near-standstill
    const lowSpeedBlend = Math.min(1.0, speed / 1.5);
    const fLat = (fyFront * Math.cos(this.steerAngle) + fyRear) * lowSpeedBlend;
    const yawTorque =
      (this.cgToFront * fyFront * Math.cos(this.steerAngle) -
        this.cgToRear * fyRear) *
      lowSpeedBlend;

    // 6. Integrate local velocities and yaw rate
    this.longAccel = fLong / this.mass;
    this.latAccel = fLat / this.mass;

    this.vx += (this.longAccel + this.vy * this.yawRate) * dt;
    this.vy += (this.latAccel - this.vx * this.yawRate) * dt;
    this.yawRate += (yawTorque / this.inertiaYaw) * dt;

    // Extra damping at low speeds so vehicle parks cleanly
    if (speed < 2.0 && input.throttle === 0) {
      this.vx *= 0.92;
      this.vy *= 0.85;
      this.yawRate *= 0.85;
    }

    this.yaw += this.yawRate * dt;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);

    // Convert local (vx=forward, vy=right) to Three.js world (x, z)
    const worldVx = sinY * this.vx + cosY * this.vy;
    const worldVz = cosY * this.vx - sinY * this.vy;
    this.x += worldVx * dt;
    this.z += worldVz * dt;

    // Visual chassis pitch & body roll from weight transfer
    const targetPitch = Math.max(
      -0.06,
      Math.min(0.06, -this.longAccel * 0.0045),
    );
    const targetRoll = Math.max(-0.09, Math.min(0.09, this.latAccel * 0.0065));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 12);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 12);
    this.slipRatioRear = Math.min(1.0, Math.abs(alphaRear) / 0.35);
  }
}
```

---

## Part II: 3D Character Controller Math (Quake / Celeste Style)

### 1. Derive Gravity & Jump Impulse from Desired Jump Height ($H$) and Time-to-Apex ($T_{\text{apex}}$)

Never guess arbitrary `gravity = -9.8` and `jumpForce = 5`. Instead, parameterize by designer-friendly spatial metrics—jump peak height $H$ (e.g., $2.4\text{ m}$) and time to reach peak $T_{\text{apex}}$ (e.g., $0.38\text{ s}$):

$$g_{\text{up}} = -\frac{2 H}{T_{\text{apex}}^2}, \qquad v_{\text{jump}} = \frac{2 H}{T_{\text{apex}}} = |g_{\text{up}}| \, T_{\text{apex}}$$

### 2. Asymmetric Three-Phase Jump Gravity (Ascent, Apex Hang-Time, Fast Fall)

1. **Ascending ($v_y > v\_{\text{apexThreshold}}$)**:
   - If jump button remains held: $g = g_{\text{up}}$.
   - If jump button released early (variable jump height): $g = 2.6 \, g_{\text{up}}$ (cuts jump short smoothly).
2. **Apex Hang-Time ($|v_y| \le v\_{\text{apexThreshold}}$)**:
   - Reduce gravity to $0.55 \, g_{\text{up}}$ and boost horizontal air acceleration by $1.25\times$ so the player can micro-adjust landing at the peak of the jump.
3. **Descending ($v_y < -v\_{\text{apexThreshold}}$)**:
   - Apply $g_{\text{down}} = 1.65 \, g_{\text{up}}$ capped at terminal velocity $v_{\text{term}} = -24\text{ m/s}$ for crisp landings.

### 3. Coyote Time & Jump Input Buffering

- **Coyote Time ($\tau\_{\text{coyote}} \approx 0.11\text{ s}$)**: After walking off a ledge without jumping, `coyoteTimer` counts down from $0.11\text{ s}$. Pressing Jump while `coyoteTimer > 0` executes a valid ground jump.
- **Jump Buffer ($\tau\_{\text{buffer}} \approx 0.12\text{ s}$)**: Pressing Jump slightly _before_ touching the ground sets `jumpBufferTimer = 0.12`. On the exact frame the capsule touches ground, if `jumpBufferTimer > 0`, the jump fires immediately.

### 4. Ground & Air Acceleration, Slope Projection, and Step-Up Climbing

- **Slope Limit**: A surface normal $\mathbf{n}$ is walkable ground if $\mathbf{n} \cdot \mathbf{u}_{\text{up}} \ge \cos(\theta_{\max})$ (for $\theta_{\max} = 45^\circ$, $n_y \ge 0.7071$). Project desired velocity onto the slope plane:
  $$\mathbf{v}_{\text{slope}} = \mathbf{v} - (\mathbf{v} \cdot \mathbf{n})\mathbf{n}$$
- **Step-Up Climbing**: If horizontal movement hits a vertical riser of height $\Delta y \le h_{\text{step}}$ ($0.35\text{ m}$) whose upper surface has $n_y \ge \cos(\theta_{\max})$, smoothly elevate the character onto the step rather than halting momentum.

### Copy-Ready JS Implementation: 3D Character Controller

```javascript
export class CharacterController3D {
  constructor(config = {}) {
    this.jumpHeight = config.jumpHeight || 2.4;
    this.timeToApex = config.timeToApex || 0.38;
    this.gravityUp =
      (-2 * this.jumpHeight) / (this.timeToApex * this.timeToApex);
    this.jumpVelocity = Math.abs(this.gravityUp) * this.timeToApex;

    this.maxRunSpeed = config.maxRunSpeed || 8.5;
    this.groundAccel = config.groundAccel || 55.0;
    this.groundFriction = config.groundFriction || 42.0;
    this.airAccel = config.airAccel || 28.0;
    this.coyoteDuration = 0.11;
    this.jumpBufferDuration = 0.12;
    this.stepHeight = 0.35;
    this.minGroundNormalY = Math.cos((45 * Math.PI) / 180);

    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0;

    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
  }

  /**
   * @param {number} dt - Fixed timestep (1/60)
   * @param {object} input - { moveX: -1..1, moveZ: -1..1, jumpPressed: bool, jumpHeld: bool }
   * @param {(x: number, z: number) => number} sampleGroundHeight
   */
  step(dt, input, sampleGroundHeight) {
    // 1. Update timers
    if (this.isGrounded) {
      this.coyoteTimer = this.coyoteDuration;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    if (input.jumpPressed) {
      this.jumpBufferTimer = this.jumpBufferDuration;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    // 2. Horizontal acceleration & friction
    const wishLen = Math.hypot(input.moveX, input.moveZ);
    const dirX = wishLen > 1e-4 ? input.moveX / wishLen : 0;
    const dirZ = wishLen > 1e-4 ? input.moveZ / wishLen : 0;
    const targetVx = dirX * this.maxRunSpeed * Math.min(1, wishLen);
    const targetVz = dirZ * this.maxRunSpeed * Math.min(1, wishLen);

    const isNearApex = !this.isGrounded && Math.abs(this.vy) < 1.8;
    const accel = this.isGrounded
      ? wishLen > 0.01
        ? this.groundAccel
        : this.groundFriction
      : this.airAccel * (isNearApex ? 1.25 : 1.0);

    const dvX = targetVx - this.vx;
    const dvZ = targetVz - this.vz;
    const maxDelta = accel * dt;
    const dvMag = Math.hypot(dvX, dvZ);
    if (dvMag <= maxDelta || dvMag < 1e-5) {
      this.vx = targetVx;
      this.vz = targetVz;
    } else {
      this.vx += (dvX / dvMag) * maxDelta;
      this.vz += (dvZ / dvMag) * maxDelta;
    }

    if (wishLen > 0.05) {
      const targetYaw = Math.atan2(dirX, dirZ);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 14);
    }

    // 3. Execute Jump if buffered and within Coyote window
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.vy = this.jumpVelocity;
      this.isGrounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    }

    // 4. Three-phase asymmetric gravity
    let g = this.gravityUp;
    if (this.vy > 1.8) {
      g = input.jumpHeld ? this.gravityUp : this.gravityUp * 2.6;
    } else if (Math.abs(this.vy) <= 1.8 && !this.isGrounded) {
      g = this.gravityUp * 0.55; // Apex hang-time
    } else {
      g = this.gravityUp * 1.65; // Fast fall
    }
    this.vy = Math.max(-24.0, this.vy + g * dt);

    // 5. Integrate position & resolve ground / step-up
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;

    const floorY = sampleGroundHeight ? sampleGroundHeight(this.x, this.z) : 0;
    if (this.y <= floorY) {
      this.y = floorY;
      this.vy = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }
  }
}
```
