/* 360° Interactive GLB Inspector for Mother Agatha (public/live-preview/assets/agatha.glb).
 * Rigged 20-bone Armature + SkinnedMesh driven by THREE.AnimationMixer
 * (baked Idle/Walk NLA clips); legacy procedural limb driver kept as a
 * fallback mode. Append ?skeleton=1 for a live SkeletonHelper overlay. */
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
  var walkPhase = 0;
  var mixer = null;
  var mixerOk = false;
  var idleAction = null;
  var walkAction = null;
  var MODES = ["blend", "walk", "idle", "procedural", "off"];
  var MODE_LABEL = {
    blend: "Anim: Blend",
    walk: "Anim: Walk",
    idle: "Anim: Idle",
    procedural: "Anim: Procedural",
    off: "Anim: Off",
  };
  var animMode = 0;

  function modeName() {
    return MODES[animMode];
  }

  if (spinBtn) {
    spinBtn.textContent = MODE_LABEL[modeName()];
    spinBtn.addEventListener("click", function () {
      animMode = (animMode + 1) % MODES.length;
      spinBtn.textContent = MODE_LABEL[modeName()];
    });
  }

  function setupMixer(root, clips) {
    mixer = null;
    mixerOk = false;
    idleAction = null;
    walkAction = null;
    if (!root || !window.THREE.AnimationMixer || !clips || !clips.length) {
      return null;
    }
    var idleClip = null;
    var walkClip = null;
    var i;
    for (i = 0; i < clips.length; i++) {
      var nm = (clips[i] && clips[i].name ? clips[i].name : "").toLowerCase();
      if (!idleClip && nm.indexOf("idle") >= 0) idleClip = clips[i];
      if (!walkClip && nm.indexOf("walk") >= 0) walkClip = clips[i];
    }
    if (window.THREE.AnimationClip && window.THREE.AnimationClip.findByName) {
      if (!idleClip) {
        idleClip = window.THREE.AnimationClip.findByName(clips, "Idle");
      }
      if (!walkClip) {
        walkClip = window.THREE.AnimationClip.findByName(clips, "Walk");
      }
    }
    if (!idleClip && !walkClip) return null;
    mixer = new window.THREE.AnimationMixer(root);
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
    }
    if (walkClip) {
      walkAction = mixer.clipAction(walkClip);
      walkAction.timeScale = 0.55;
      walkAction.play();
    }
    mixerOk = true;
    var names = [];
    if (idleClip) names.push(idleClip.name);
    if (walkClip) names.push(walkClip.name);
    return names.join(" + ");
  }

  var loader = new THREE.GLTFLoader();
  loader.load(
    "./assets/agatha.glb?v=" + Date.now(),
    function (gltf) {
      var root = gltf.scene || gltf.scenes[0];
      pivot.add(root);

      var meshCount = 0;
      var vertCount = 0;
      var boneCount = 0;
      var skinnedCount = 0;
      root.traverse(function (o) {
        if (!o) return;
        if (o.isBone) boneCount++;
        if (o.isSkinnedMesh) skinnedCount++;
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
      var clipText = setupMixer(root, gltf.animations);
      try {
        if (
          window.location &&
          window.location.search &&
          window.location.search.indexOf("skeleton=1") >= 0 &&
          window.THREE.SkeletonHelper
        ) {
          scene.add(new window.THREE.SkeletonHelper(root));
        }
      } catch (errSkel) {
        /* overlay optional */
      }
      if (statusEl) {
        statusEl.textContent =
          "Loaded agatha.glb · Human Lady Face + Red Glowing Eyes · " +
          meshCount +
          " meshes (" +
          skinnedCount +
          " skinned) · " +
          boneCount +
          " bones · " +
          vertCount.toLocaleString() +
          " verts" +
          (clipText ? " · Mixer: " + clipText : " · Mixer: n/a (procedural)");
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
  window.__agathaManualStep = function (fixedDt, yawVal) {
    window.__agathaManual = true;
    if (typeof yawVal === "number") camYaw = yawVal;
    stepViewer(fixedDt || (1 / 30));
  };
  function animate(now) {
    requestAnimationFrame(animate);
    if (window.__agathaManual) return;
    var dt = Math.min(0.05, Math.max(0.001, (now - lastT) * 0.001));
    lastT = now;
    stepViewer(dt);
  }
  function stepViewer(dt) {

    var mode = modeName();
    if (mixerOk && (mode === "blend" || mode === "walk" || mode === "idle")) {
      /* Baked-bone path: smooth human stride straight from the NLA clips. */
      var wWalk = mode === "walk" ? 1 : mode === "idle" ? 0 : 0.7;
      try {
        if (idleAction) idleAction.setEffectiveWeight(1 - wWalk);
        if (walkAction) walkAction.setEffectiveWeight(wWalk);
        mixer.update(dt);
      } catch (errMix) {
        /* mixer never breaks the viewer */
      }
    } else if (mode === "procedural") {
      /* Legacy procedural limb driver (fallback / comparison). */
      walkPhase += dt * 2.8;
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
