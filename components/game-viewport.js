"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const OBSTACLES = [
  [-8, -3, 1.25],
  [-4.5, 4.5, 0.95],
  [5.2, 4.1, 1.55],
  [8, -2.2, 1.15],
  [0.4, -7, 1.2],
  [-10, 7.3, 0.8],
  [9.5, 7.2, 0.9],
];

function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.28) * Math.cos(z * 0.24) * 0.16 +
    Math.sin(z * 0.42 + x * 0.18) * 0.07
  );
}

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(36, 26, 36, 28);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const height = terrainHeight(x, z);
    const shade = 0.28 + Math.min(0.5, Math.max(0, height + 0.25)) * 0.25;

    positions.setY(index, height);
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade * 1.015;
    colors[index * 3 + 2] = shade * 1.04;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.96,
    flatShading: true,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = "Moon terrain";
  terrain.receiveShadow = true;
  return terrain;
}

function createRover() {
  const rover = new THREE.Group();
  rover.name = "Lunar rover";

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x85888d,
    roughness: 0.72,
    metalness: 0.12,
    flatShading: true,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x292b30,
    roughness: 0.92,
    metalness: 0.06,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x737a7e,
    roughness: 0.38,
    metalness: 0.3,
  });

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.48, 1.26),
    hullMaterial,
  );
  chassis.position.y = 0.82;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  rover.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.36, 0.82),
    glassMaterial,
  );
  cabin.position.set(0, 1.23, -0.04);
  cabin.castShadow = true;
  rover.add(cabin);

  const sensor = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.22, 0.34),
    darkMaterial,
  );
  sensor.position.set(0, 1.51, -0.12);
  rover.add(sensor);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 0.55, 6),
    darkMaterial,
  );
  mast.position.set(-0.58, 1.32, 0.28);
  mast.rotation.z = -0.12;
  rover.add(mast);

  const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  const wheels = [];
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(side * 0.78, 0.39, end * 0.56);
      wheel.castShadow = true;
      rover.add(wheel);
      wheels.push(wheel);
    }
  }

  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(2.08, 0.12, 0.1),
    darkMaterial,
  );
  bumper.position.set(0, 0.7, 0.66);
  rover.add(bumper);

  return { rover, wheels };
}

function addBeacon(scene, x, z, index) {
  const beacon = new THREE.Group();
  beacon.name = `Signal beacon ${index + 1}`;
  beacon.position.set(x, terrainHeight(x, z), z);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x666c68,
    roughness: 0.86,
    flatShading: true,
  });
  const signalMaterial = new THREE.MeshStandardMaterial({
    color: 0x92ad98,
    roughness: 0.55,
    emissive: 0x26392b,
    emissiveIntensity: 0.35,
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, 0.16, 8),
    baseMaterial,
  );
  base.position.y = 0.08;
  base.castShadow = true;
  beacon.add(base);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 0.68, 7),
    baseMaterial,
  );
  stem.position.y = 0.47;
  stem.castShadow = true;
  beacon.add(stem);

  const signal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    signalMaterial,
  );
  signal.position.y = 0.87;
  signal.castShadow = true;
  beacon.add(signal);

  scene.add(beacon);
  return beacon;
}

function createSceneContents(scene) {
  scene.add(createTerrain());

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 40),
    new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.42;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(36, 36, 0x53565a, 0x36383c);
  grid.position.y = -0.015;
  grid.material.transparent = true;
  grid.material.opacity = 0.24;
  grid.material.depthWrite = false;
  scene.add(grid);

  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x5b5d62,
    roughness: 0.98,
    flatShading: true,
  });
  const rocks = OBSTACLES.map(([x, z, size], index) => {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      rockMaterial.clone(),
    );
    rock.name = `Rock ${index + 1}`;
    rock.position.set(x, terrainHeight(x, z) + size * 0.46, z);
    rock.rotation.set(index * 0.19, index * 0.43, index * 0.11);
    rock.scale.y = 0.68;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    return rock;
  });

  const { rover, wheels } = createRover();
  rover.position.set(0, terrainHeight(0, 0), 0);
  scene.add(rover);

  const beaconPositions = [
    [-6.3, 2.7],
    [4.4, -4.6],
    [7.3, 6.4],
    [-9.2, -7],
  ];
  const beacons = beaconPositions.map(([x, z], index) =>
    addBeacon(scene, x, z, index),
  );

  return { rover, wheels, beacons, rocks };
}

function estimateGeometryMemory(scene) {
  const geometries = new Set();
  let bytes = 0;

  scene.traverse((object) => {
    if (!object.geometry || geometries.has(object.geometry)) return;
    geometries.add(object.geometry);

    for (const attribute of Object.values(object.geometry.attributes)) {
      bytes += attribute.array?.byteLength ?? 0;
    }
    bytes += object.geometry.index?.array?.byteLength ?? 0;
  });

  return Math.max(0.1, Math.round((bytes / (1024 * 1024)) * 10) / 10);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export default function GameViewport({
  isPlaying = true,
  resetRevision = 0,
  moveInput = { x: 0, z: 0 },
  onStats,
  className = "",
}) {
  const mountRef = useRef(null);
  const roverRef = useRef(null);
  const controlsRef = useRef(null);
  const keysRef = useRef(new Set());
  const moveInputRef = useRef(moveInput);
  const isPlayingRef = useRef(isPlaying);
  const onStatsRef = useRef(onStats);
  const [webglError, setWebglError] = useState("");

  moveInputRef.current = moveInput;
  isPlayingRef.current = isPlaying;
  onStatsRef.current = onStats;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    let controls;
    let scene;
    let resizeObserver;
    let animationFrame = 0;
    let world;
    let resizeHandler;
    let keyDownHandler;
    let keyUpHandler;
    let clearKeysHandler;

    setWebglError("");

    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x09090b);
      scene.fog = new THREE.Fog(0x09090b, 24, 58);

      const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
      camera.position.set(10.5, 12.5, 17.5);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "game-canvas";
      mount.appendChild(renderer.domElement);

      const hemisphere = new THREE.HemisphereLight(0xd9dcdf, 0x282a2f, 1.85);
      scene.add(hemisphere);

      const keyLight = new THREE.DirectionalLight(0xf2f2ee, 2.15);
      keyLight.position.set(-8, 17, 10);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -20;
      keyLight.shadow.camera.right = 20;
      keyLight.shadow.camera.top = 20;
      keyLight.shadow.camera.bottom = -20;
      keyLight.shadow.bias = -0.0005;
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xc7cbd0, 0.42);
      fillLight.position.set(10, 6, -12);
      scene.add(fillLight);

      world = createSceneContents(scene);
      roverRef.current = world.rover;

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.enablePan = false;
      controls.minDistance = 8;
      controls.maxDistance = 34;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.target.set(0, 0.35, 0);
      controls.update();
      controlsRef.current = controls;

      resizeHandler = () => {
        if (!mount.clientWidth || !mount.clientHeight) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight, false);
      };

      resizeHandler();
      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(resizeHandler);
        resizeObserver.observe(mount);
      } else {
        window.addEventListener("resize", resizeHandler);
      }

      keyDownHandler = (event) => {
        if (isEditableTarget(event.target)) return;
        if (
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)
        ) {
          event.preventDefault();
          keysRef.current.add(event.code);
        }
      };
      keyUpHandler = (event) => keysRef.current.delete(event.code);
      clearKeysHandler = () => keysRef.current.clear();
      window.addEventListener("keydown", keyDownHandler);
      window.addEventListener("keyup", keyUpHandler);
      window.addEventListener("blur", clearKeysHandler);

      let previousFrame = 0;
      let previousStatsTime = performance.now();
      let frameCount = 0;
      const estimatedMemoryMB = estimateGeometryMemory(scene);

      const renderFrame = (now) => {
        animationFrame = window.requestAnimationFrame(renderFrame);
        if (now - previousFrame < 1000 / 60) return;

        const delta = previousFrame
          ? Math.min((now - previousFrame) / 1000, 0.05)
          : 1 / 60;
        previousFrame = now;

        controls.update();
        if (isPlayingRef.current) {
          const keys = keysRef.current;
          const externalMove = moveInputRef.current;
          const moveX =
            (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) -
            (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0) +
            (externalMove?.x ?? 0);
          const moveZ =
            (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) -
            (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) +
            (externalMove?.z ?? 0);
          const magnitude = Math.hypot(moveX, moveZ);

          if (magnitude > 0) {
            const directionX = moveX / magnitude;
            const directionZ = moveZ / magnitude;
            const nextX = THREE.MathUtils.clamp(
              world.rover.position.x + directionX * delta * 4.1,
              -13.8,
              13.8,
            );
            const nextZ = THREE.MathUtils.clamp(
              world.rover.position.z + directionZ * delta * 4.1,
              -9.1,
              9.1,
            );
            const blocked = OBSTACLES.some(
              ([x, z, size]) =>
                Math.hypot(nextX - x, nextZ - z) < size + 0.76,
            );

            if (!blocked) {
              world.rover.position.x = nextX;
              world.rover.position.z = nextZ;
            }
            world.rover.rotation.y = Math.atan2(directionX, directionZ);
            world.wheels.forEach((wheel) => {
              wheel.rotation.y += delta * 5;
            });
          }

          world.rover.position.y = terrainHeight(
            world.rover.position.x,
            world.rover.position.z,
          );
          world.beacons.forEach((beacon, index) => {
            beacon.rotation.y += delta * (0.22 + index * 0.035);
          });
        }

        renderer.render(scene, camera);
        frameCount += 1;

        if (now - previousStatsTime >= 600) {
          const fps = Math.min(
            60,
            Math.round((frameCount * 1000) / (now - previousStatsTime)),
          );
          onStatsRef.current?.({
            fps,
            drawCalls: renderer.info.render.calls,
            geometryMemoryMB: estimatedMemoryMB,
          });
          frameCount = 0;
          previousStatsTime = now;
        }
      };

      animationFrame = window.requestAnimationFrame(renderFrame);
    } catch {
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
      setWebglError(
        "WebGL could not start in this browser. Try a browser with hardware acceleration enabled.",
      );
      return undefined;
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      if (!resizeObserver && resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      if (keyDownHandler) window.removeEventListener("keydown", keyDownHandler);
      if (keyUpHandler) window.removeEventListener("keyup", keyUpHandler);
      if (clearKeysHandler) window.removeEventListener("blur", clearKeysHandler);
      controls?.dispose();
      controlsRef.current = null;
      roverRef.current = null;

      if (scene) {
        const geometries = new Set();
        const materials = new Set();
        scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => materials.add(material));
          } else if (object.material) {
            materials.add(object.material);
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }

      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (resetRevision === 0) return;
    controlsRef.current?.reset();
    keysRef.current.clear();
  }, [resetRevision]);

  return (
    <div
      ref={mountRef}
      className={`game-viewport ${className}`.trim()}
      role="region"
      aria-label="Interactive 3D game preview. Drag to orbit, use WASD or arrow keys to move the rover."
      tabIndex={0}
    >
      {webglError ? <p className="viewport-error">{webglError}</p> : null}
    </div>
  );
}
