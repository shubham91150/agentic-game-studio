/**
 * Three.js WebGL Runtime Generator
 *
 * Compiles a self-contained 3D game from the generated spec.
 * Everything visible is driven by the spec: biome palette, terrain
 * heights (worldData), physics numbers (speed/jump/gravity), objective,
 * and a collect-N-to-win loop with obstacles and world bounds.
 */

import { generateWebAudioSynthesizerJs } from "../audio/audiocraft_synth.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Three.js r128 vendored on the VM and INLINED into every generated game.
// Reason: phones on slow networks (and offline judges) cannot fetch the
// 600KB CDN build, which leaves a black canvas. A self-contained file
// always renders if WebGL exists; if WebGL itself is missing the game
// shows a readable error banner instead of black.
const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));
let THREE_BUNDLE = "";
try {
  THREE_BUNDLE = fs.readFileSync(
    path.join(__runtimeDir, "vendor", "three.min.js"),
    "utf8",
  );
} catch {
  THREE_BUNDLE = "";
}

const BIOME_PRESETS = {
  "cyber-orbital": {
    fog: "#09090b",
    terrain: "#16233a",
    terrainAccent: "#38bdf8",
    player: "#38bdf8",
    collectible: "#22d3ee",
    obstacle: "#475569",
    gridA: "#38bdf8",
    gridB: "#1e293b",
    sun: "#7dd3fc",
    amplitude: 1.2,
  },
  "subzero-glacier": {
    fog: "#0a1826",
    terrain: "#b9d6e8",
    terrainAccent: "#e0f2fe",
    player: "#f0f9ff",
    collectible: "#38bdf8",
    obstacle: "#64748b",
    gridA: "#bae6fd",
    gridB: "#7d9bb3",
    sun: "#e0f2fe",
    amplitude: 2.2,
  },
  "desert-canyon": {
    fog: "#1c1108",
    terrain: "#9a6a3f",
    terrainAccent: "#fbbf24",
    player: "#f59e0b",
    collectible: "#fde68a",
    obstacle: "#78716c",
    gridA: "#fbbf24",
    gridB: "#6b4a2a",
    sun: "#fcd34d",
    amplitude: 3.0,
  },
  "bioluminescent-canopy": {
    fog: "#07130c",
    terrain: "#1d4d33",
    terrainAccent: "#4ade80",
    player: "#86efac",
    collectible: "#a7f3d0",
    obstacle: "#365314",
    gridA: "#4ade80",
    gridB: "#1a3a26",
    sun: "#bbf7d0",
    amplitude: 1.8,
  },
};

export function generateThreeJsGameHtml(gameSpec, worldData, layout) {
  const biomeName = BIOME_PRESETS[gameSpec.world?.biome]
    ? gameSpec.world.biome
    : "cyber-orbital";
  const preset = BIOME_PRESETS[biomeName];
  const title = String(gameSpec.title || "Agentic 3D World").replace(/</g, "");
  const objective = String(
    gameSpec.objective || "Collect the energy orbs scattered across the world.",
  ).replace(/</g, "");
  const physics = gameSpec.mechanics?.physics || {};
  const speed = Math.min(24, Math.max(6, Number(physics.playerSpeed) || 14));
  const jump = Math.min(16, Math.max(6, Number(physics.jumpVelocity) || 9.5));
  const gravity = Math.abs(Number(physics.gravity) || -16);
  const audioJs = generateWebAudioSynthesizerJs();
  const heightmapJson = JSON.stringify(worldData?.heightmap || []);
  const layoutJson = JSON.stringify(layout || { obstacles: [], orbs: [] });
  const amplitude = preset.amplitude;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${preset.fog}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #canvas-container { width: 100%; height: 100%; position: absolute; left: 0; top: 0; }
    #hud {
      position: absolute; top: 16px; left: 16px; z-index: 10;
      color: #f8fafc; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px; background: rgba(9, 9, 11, 0.78); border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 10px 14px; border-radius: 8px; backdrop-filter: blur(8px);
      display: flex; gap: 16px; pointer-events: none; max-width: calc(100vw - 32px); flex-wrap: wrap;
    }
    .hud-stat { display: flex; flex-direction: column; }
    .hud-label { font-size: 10px; color: #a8b3bd; text-transform: uppercase; letter-spacing: 0.05em; }
    .hud-val { font-size: 16px; font-weight: 700; color: ${preset.collectible}; }
    #banner {
      position: absolute; inset: 0; z-index: 30; display: none;
      align-items: center; justify-content: center; flex-direction: column; gap: 12px;
      background: rgba(4, 6, 10, 0.72); color: #f8fafc; text-align: center; padding: 24px;
    }
    #banner h1 { font-size: 26px; letter-spacing: -0.02em; }
    #banner p { color: #cbd5e1; font-size: 14px; max-width: 420px; line-height: 1.6; }
    #banner button {
      font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.25); background: #f4f4f5; color: #09090b; cursor: pointer;
    }
    #mobile-controls {
      position: absolute; bottom: 24px; left: 24px; z-index: 20;
      width: 120px; height: 120px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15);
      display: none; touch-action: none;
    }
    #joystick-stick {
      position: absolute; left: 35px; top: 35px; width: 50px; height: 50px;
      border-radius: 50%; background: rgba(255,255,255,0.18); border: 1px solid ${preset.collectible};
      pointer-events: none;
    }
    #btn-mobile-jump {
      position: absolute; bottom: 36px; right: 28px; z-index: 20;
      width: 64px; height: 64px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.10); border: 1px solid ${preset.collectible}; color: #ffffff;
      font-weight: 700; font-size: 12px; display: none; align-items: center; justify-content: center;
      user-select: none; touch-action: none;
    }
    @media (pointer: coarse) {
      #mobile-controls { display: block; }
      #btn-mobile-jump { display: flex; }
    }
  </style>
  ${THREE_BUNDLE ? `<script>\n${THREE_BUNDLE}\n  </script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'}
</head>
<body>
  <div id="canvas-container"></div>
  <div id="hud">
    <div class="hud-stat"><span class="hud-label">${title}</span><span class="hud-val" style="font-size:13px;">${biomeName}</span></div>
    <div class="hud-stat"><span class="hud-label">Orbs</span><span class="hud-val" id="val-score">0 / 12</span></div>
    <div class="hud-stat"><span class="hud-label">Speed</span><span class="hud-val" id="val-speed">0.0</span></div>
    <div class="hud-stat"><span class="hud-label">Gravity</span><span class="hud-val">${gravity.toFixed(1)}</span></div>
  </div>
  <div id="banner">
    <h1 id="banner-title">World complete</h1>
    <p id="banner-text">${objective}</p>
    <button id="btn-again" type="button">Play again</button>
  </div>

  <div id="mobile-controls"><div id="joystick-stick"></div></div>
  <div id="btn-mobile-jump">JUMP</div>

  <script>
    (function() {
      ${audioJs}

      function showEngineError(msg) {
        var banner = document.getElementById('banner');
        document.getElementById('banner-text').textContent = msg;
        document.getElementById('banner-title').textContent = '3D engine unavailable';
        banner.style.display = 'flex';
        document.getElementById('btn-again').style.display = 'none';
      }

      if (typeof THREE === 'undefined') {
        showEngineError('The 3D engine library failed to load on this connection. Reconnect and reload the game.');
        return;
      }

      const SPEED = ${speed};
      const JUMP = ${jump};
      const GRAVITY = ${gravity};
      const HEIGHTMAP = ${heightmapJson};
      const LAYOUT = ${layoutJson};
      const AMPLITUDE = ${amplitude};
      const WORLD_BOUND = 72;
      const TARGET_ORBS = (LAYOUT.orbs || []).length || 12;

      const container = document.getElementById('canvas-container');
      const valScore = document.getElementById('val-score');
      const valSpeed = document.getElementById('val-speed');

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('${preset.fog}');
      scene.fog = new THREE.FogExp2('${preset.fog}', 0.012);

      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch (err) {
        showEngineError('WebGL could not start in this browser. Try Chrome with hardware acceleration enabled.');
        return;
      }
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const sunLight = new THREE.DirectionalLight('${preset.sun}', 1.25);
      sunLight.position.set(20, 40, 20);
      sunLight.castShadow = true;
      scene.add(sunLight);

      function groundHeight(x, z) {
        if (!HEIGHTMAP.length) return 0;
        const n = HEIGHTMAP.length;
        const gx = Math.min(n - 1, Math.max(0, Math.floor(((x + 80) / 160) * n)));
        const gz = Math.min(n - 1, Math.max(0, Math.floor(((z + 80) / 160) * n)));
        return (HEIGHTMAP[gz][gx] || 0) * AMPLITUDE * 0.35;
      }

      const terrainGeo = new THREE.PlaneGeometry(160, 160, 48, 48);
      terrainGeo.rotateX(-Math.PI / 2);
      const pos = terrainGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
      }
      terrainGeo.computeVertexNormals();
      const terrain = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({ color: '${preset.terrain}', roughness: 0.9, metalness: 0.15, flatShading: true })
      );
      terrain.receiveShadow = true;
      scene.add(terrain);

      const grid = new THREE.GridHelper(160, 40, '${preset.gridA}', '${preset.gridB}');
      grid.position.y = 0.05;
      grid.material.transparent = true;
      grid.material.opacity = 0.35;
      scene.add(grid);

      const playerGroup = new THREE.Group();
      const bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.8, 1.0),
        new THREE.MeshStandardMaterial({ color: '${preset.player}', roughness: 0.3, metalness: 0.7 })
      );
      bodyMesh.position.y = 0.9;
      bodyMesh.castShadow = true;
      playerGroup.add(bodyMesh);
      const coreMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.4, 0.3),
        new THREE.MeshBasicMaterial({ color: '${preset.collectible}' })
      );
      coreMesh.position.set(0, 1.2, 0.45);
      playerGroup.add(coreMesh);
      scene.add(playerGroup);

      // Obstacles (pylons) — solid, with collision. Positions come from the
      // shared layout that the QA gate verified.
      const obstacles = [];
      const obstacleGeo = new THREE.BoxGeometry(1.4, 3.2, 1.4);
      const obstacleMat = new THREE.MeshStandardMaterial({ color: '${preset.obstacle}', roughness: 0.6, metalness: 0.4 });
      (LAYOUT.obstacles || []).forEach(function (o) {
        const mesh = new THREE.Mesh(obstacleGeo, obstacleMat);
        mesh.position.set(o.x, groundHeight(o.x, o.z) + 1.6, o.z);
        mesh.castShadow = true;
        scene.add(mesh);
        obstacles.push({ x: o.x, z: o.z, r: o.r || 1.5 });
      });

      // Collectible orbs — collect all to win (no respawn)
      const collectibles = [];
      const colGeo = new THREE.OctahedronGeometry(0.65);
      const colMat = new THREE.MeshStandardMaterial({ color: '${preset.collectible}', roughness: 0.15, metalness: 0.8, emissive: '${preset.collectible}', emissiveIntensity: 0.25 });
      (LAYOUT.orbs || []).forEach(function (o) {
        const mesh = new THREE.Mesh(colGeo, colMat);
        mesh.position.set(o.x, groundHeight(o.x, o.z) + 1.4, o.z);
        mesh.castShadow = true;
        scene.add(mesh);
        collectibles.push(mesh);
      });

      const keys = {};
      window.addEventListener('keydown', e => keys[e.code] = true);
      window.addEventListener('keyup', e => keys[e.code] = false);

      const joystick = { x: 0, y: 0, active: false };
      const joyEl = document.getElementById('mobile-controls');
      const stickEl = document.getElementById('joystick-stick');
      let joyTouchId = null;
      joyEl.addEventListener('touchstart', e => {
        const t = e.changedTouches[0];
        joyTouchId = t.identifier;
        joystick.active = true;
      });
      window.addEventListener('touchmove', e => {
        if (!joystick.active) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === joyTouchId) {
            const rect = joyEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let dx = (t.clientX - cx) / (rect.width / 2);
            let dy = (t.clientY - cy) / (rect.height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1) { dx /= dist; dy /= dist; }
            joystick.x = dx;
            joystick.y = dy;
            stickEl.style.transform = 'translate(' + (dx * 25) + 'px, ' + (dy * 25) + 'px)';
          }
        }
      });
      const endJoy = () => {
        joystick.active = false;
        joystick.x = 0;
        joystick.y = 0;
        stickEl.style.transform = 'translate(0px, 0px)';
      };
      window.addEventListener('touchend', endJoy);
      window.addEventListener('touchcancel', endJoy);

      let mobileJump = false;
      const jumpBtn = document.getElementById('btn-mobile-jump');
      jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); mobileJump = true; });
      jumpBtn.addEventListener('touchend', () => mobileJump = false);

      let score = 0;
      let won = false;
      let velocityY = 0;
      let isGrounded = true;
      const banner = document.getElementById('banner');
      document.getElementById('btn-again').addEventListener('click', () => window.location.reload());

      const clock = new THREE.Clock();

      function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.05);

        let moveX = 0;
        let moveZ = 0;
        if (!won) {
          if (keys['KeyW'] || keys['ArrowUp']) moveZ -= 1;
          if (keys['KeyS'] || keys['ArrowDown']) moveZ += 1;
          if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
          if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;
          if (joystick.active) { moveX = joystick.x; moveZ = joystick.y; }
        }

        const len = Math.hypot(moveX, moveZ) || 1;
        const nx = playerGroup.position.x + (moveX / len) * SPEED * dt * (moveX || moveZ ? 1 : 0);
        const nz = playerGroup.position.z + (moveZ / len) * SPEED * dt * (moveX || moveZ ? 1 : 0);

        // World bounds + obstacle collision (circle sweep)
        const clampedX = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, nx));
        const clampedZ = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, nz));
        const blocked = obstacles.some(o => Math.hypot(clampedX - o.x, clampedZ - o.z) < o.r + 0.9);
        if (!blocked) {
          playerGroup.position.x = clampedX;
          playerGroup.position.z = clampedZ;
        }

        if ((keys['Space'] || mobileJump) && isGrounded && !won) {
          velocityY = JUMP;
          isGrounded = false;
          AudioEngine.playJump();
        }

        const floorY = groundHeight(playerGroup.position.x, playerGroup.position.z);
        if (!isGrounded) {
          velocityY -= GRAVITY * dt;
          playerGroup.position.y += velocityY * dt;
          if (playerGroup.position.y <= floorY) {
            playerGroup.position.y = floorY;
            velocityY = 0;
            isGrounded = true;
          }
        } else {
          playerGroup.position.y = floorY;
        }

        if (moveX !== 0 || moveZ !== 0) {
          playerGroup.rotation.y = Math.atan2(moveX, moveZ);
        }

        const targetCamPos = playerGroup.position.clone().add(new THREE.Vector3(0, 7, 12));
        camera.position.lerp(targetCamPos, 0.08);
        camera.lookAt(playerGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0)));

        for (let i = collectibles.length - 1; i >= 0; i--) {
          const col = collectibles[i];
          col.rotation.y += 1.5 * dt;
          col.rotation.x += 0.8 * dt;
          col.position.y = groundHeight(col.position.x, col.position.z) + 1.4 + Math.sin(clock.elapsedTime * 2 + i) * 0.15;
          if (!won && playerGroup.position.distanceTo(col.position) < 1.8) {
            scene.remove(col);
            collectibles.splice(i, 1);
            score += 1;
            valScore.textContent = score + ' / ' + TARGET_ORBS;
            AudioEngine.playCollect();
            if (score >= TARGET_ORBS) {
              won = true;
              document.getElementById('banner-text').textContent =
                'All ' + TARGET_ORBS + ' orbs collected. ' + '${objective}';
              banner.style.display = 'flex';
            }
          }
        }

        const currentSpeed = (moveX || moveZ) ? SPEED : 0;
        valSpeed.textContent = currentSpeed.toFixed(1);

        renderer.render(scene, camera);
      }

      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });

      animate();
    })();
  </script>
</body>
</html>`;
}
