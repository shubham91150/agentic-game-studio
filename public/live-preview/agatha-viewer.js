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
  var autoSpin = true;

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

  var loader = new THREE.GLTFLoader();
  loader.load(
    "./assets/agatha.glb?v=" + Date.now(),
    function (gltf) {
      var root = gltf.scene || gltf.scenes[0];
      var box = new THREE.Box3().setFromObject(root);
      var size = new THREE.Vector3();
      box.getSize(size);
      var h = Math.max(0.01, size.y);
      var scale = 1.72 / h;
      root.scale.set(scale, scale, scale);
      box.setFromObject(root);
      var center = new THREE.Vector3();
      box.getCenter(center);
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
      pivot.add(root);

      var meshCount = 0;
      var vertCount = 0;
      root.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          meshCount++;
          var pos = o.geometry.attributes && o.geometry.attributes.position;
          if (pos) vertCount += pos.count;
        }
      });
      if (statusEl) {
        statusEl.textContent =
          "Loaded agatha.glb · " +
          meshCount +
          " meshes · " +
          vertCount.toLocaleString() +
          " vertices · 1.72m tall · Drag to rotate / Scroll to zoom";
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
    autoSpin = false;
    if (spinBtn) spinBtn.textContent = "Auto-Spin: OFF";
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
      camDist = Math.max(0.85, Math.min(4.5, camDist + e.deltaY * 0.002));
    },
    { passive: false },
  );

  if (spinBtn) {
    spinBtn.addEventListener("click", function () {
      autoSpin = !autoSpin;
      spinBtn.textContent = autoSpin ? "Auto-Spin: ON" : "Auto-Spin: OFF";
    });
  }

  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function animate() {
    requestAnimationFrame(animate);
    if (autoSpin) camYaw += 0.007;
    camera.position.x = Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.z = Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.y = targetY + Math.sin(camPitch) * camDist;
    camera.lookAt(0, targetY, 0);
    renderer.render(scene, camera);
  }
  animate();
})();
