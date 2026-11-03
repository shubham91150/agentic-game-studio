/* 360° Interactive GLB Inspector for Mother Agatha (public/live-preview/assets/agatha.glb) */
(function () {
  "use strict";
  var canvas = document.getElementById("viewer");
  var statusEl = document.getElementById("status");
  var spinBtn = document.getElementById("btn-spin");
  if (!canvas || !window.THREE) return;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b0e);

  var camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.05,
    50,
  );
  var camYaw = 0;
  var camPitch = 0.08;
  var camDist = 2.45;
  var targetY = 0.88;
  var autoSpin = false;

  var hemi = new THREE.HemisphereLight(0xcbd5e1, 0x1e293b, 1.35);
  scene.add(hemi);

  var keyLight = new THREE.DirectionalLight(0xe2e8f0, 1.6);
  keyLight.position.set(2.2, 3.0, 2.5);
  scene.add(keyLight);

  var rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
  rimLight.position.set(-2.0, 2.2, -2.5);
  scene.add(rimLight);

  var lanternGlow = new THREE.PointLight(0xff9d3b, 2.4, 3.2, 1.8);
  lanternGlow.position.set(-0.26, 1.0, 0.25);
  scene.add(lanternGlow);

  var pivot = new THREE.Group();
  scene.add(pivot);

  var legL = null;
  var legR = null;
  var armL = null;
  var armR = null;
  var torso = null;
  var head = null;
  var legLY0 = 0.8;
  var legRY0 = 0.8;
  var torsoY0 = 0.88;
  var headY0 = 1.4;
  var walkOn = true;
  var walkPhase = 0;

  if (spinBtn) {
    spinBtn.textContent = "Walk Cycle: ON";
    spinBtn.addEventListener("click", function () {
      walkOn = !walkOn;
      spinBtn.textContent = walkOn ? "Walk Cycle: ON" : "Walk Cycle: OFF";
    });
  }

  var loader = new THREE.GLTFLoader();
  loader.load(
    "./assets/agatha.glb?v=" + Date.now(),
    function (gltf) {
      var root = gltf.scene || gltf.scenes[0];
      pivot.add(root);

      var meshCount = 0;
      var vertCount = 0;
      root.traverse(function (o) {
        if (!o) return;
        if (o.name === "Agatha_Leg_L") {
          legL = o;
          legLY0 = o.position.y;
        } else if (o.name === "Agatha_Leg_R") {
          legR = o;
          legRY0 = o.position.y;
        } else if (o.name === "Agatha_Arm_L") {
          armL = o;
        } else if (o.name === "Agatha_Arm_R") {
          armR = o;
        } else if (o.name === "Agatha_Torso") {
          torso = o;
          torsoY0 = o.position.y;
        } else if (o.name === "Agatha_Head_Group") {
          head = o;
          headY0 = o.position.y;
        }
        if (o.isMesh && o.geometry) {
          meshCount++;
          var pos = o.geometry.attributes && o.geometry.attributes.position;
          if (pos) vertCount += pos.count;
        }
      });
      if (statusEl) {
        statusEl.textContent =
          "Loaded agatha.glb · Human Lady Face + Red Glowing Eyes · " +
          meshCount +
          " articulated limbs · " +
          vertCount.toLocaleString() +
          " verts";
      }
    },
    undefined,
    function (err) {
      if (statusEl)
        statusEl.textContent =
          "Error loading agatha.glb: " +
          (err && err.message ? err.message : err);
    },
  );

  var dragging = false;
  var lastX = 0;
  var lastY = 0;
  canvas.addEventListener("pointerdown", function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camYaw -= dx * 0.01;
    camPitch = Math.max(-0.55, Math.min(0.65, camPitch + dy * 0.008));
  });
  canvas.addEventListener("pointerup", function () {
    dragging = false;
  });
  canvas.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      camDist = Math.max(0.75, Math.min(4.5, camDist + e.deltaY * 0.002));
    },
    { passive: false },
  );

  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  var lastT = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    var dt = Math.min(0.05, Math.max(0.001, (now - lastT) * 0.001));
    lastT = now;

    if (walkOn) {
      walkPhase += dt * 5.2;
      var s = Math.sin(walkPhase);
      var c = Math.cos(walkPhase);
      if (legL && legR) {
        legL.rotation.x = 0.42 * s;
        legR.rotation.x = -0.42 * s;
        legL.position.y = legLY0 + Math.max(0, c) * 0.04;
        legR.position.y = legRY0 + Math.max(0, -c) * 0.04;
      }
      if (armL) armL.rotation.x = -0.32 * s;
      if (armR) armR.rotation.x = 0.1 * s;
      var bob = Math.abs(s) * 0.024;
      if (torso) {
        torso.position.y = torsoY0 + bob;
        torso.rotation.x = 0.04;
        torso.rotation.y = 0.045 * s;
      }
      if (head) {
        head.position.y = headY0 + bob;
        head.rotation.y = -0.03 * s;
      }
    }

    if (autoSpin) camYaw += 0.006;
    camera.position.x = Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.z = Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.y = targetY + Math.sin(camPitch) * camDist;
    camera.lookAt(0, targetY, 0);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
})();
