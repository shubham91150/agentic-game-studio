/**
 * WorldRealism — Drop-in Three.js r128 Realism & Shader Grass Helper
 * Eliminates flat box grass, primitive cone trees, and unlit box cars forever.
 *
 * Exposes `window.WorldRealism` (and `globalThis.WorldRealism` for Node tests).
 * Compatible with global `THREE` r128 and strictly CSP-safe (`script-src 'self'`).
 */
(function (root) {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hash2(x, y, seed) {
    var h =
      Math.sin(x * 127.1 + y * 311.7 + (seed || 0) * 74.7) * 43758.5453123;
    return h - Math.floor(h);
  }

  function valueNoise2D(x, y, periodX, periodY, seed) {
    var px = periodX || 64;
    var py = periodY || 64;
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var x0 = ((xi % px) + px) % px;
    var y0 = ((yi % py) + py) % py;
    var x1 = (x0 + 1) % px;
    var y1 = (y0 + 1) % py;

    var u = xf * xf * (3.0 - 2.0 * xf);
    var v = yf * yf * (3.0 - 2.0 * yf);

    var n00 = hash2(x0, y0, seed);
    var n10 = hash2(x1, y0, seed);
    var n01 = hash2(x0, y1, seed);
    var n11 = hash2(x1, y1, seed);

    var nx0 = n00 + (n10 - n00) * u;
    var nx1 = n01 + (n11 - n01) * u;
    return nx0 + (nx1 - nx0) * v;
  }

  function fbmTileable(u, v, baseFreq, octaves, seed) {
    var sum = 0.0;
    var amp = 0.5;
    var freq = baseFreq || 8;
    var norm = 0.0;
    var oct = octaves || 4;
    for (var i = 0; i < oct; i++) {
      sum +=
        amp *
        valueNoise2D(u * freq, v * freq, freq, freq, (seed || 0) + i * 19);
      norm += amp;
      freq *= 2;
      amp *= 0.5;
    }
    return sum / (norm || 1.0);
  }

  /**
   * 1. createRealisticSkyAndLighting(scene, renderer, options)
   * Configures ACES Filmic tone mapping, sRGB output, PCFSoftShadowMap,
   * builds a procedural gradient + sun-disc ShaderMaterial sky dome on
   * SphereGeometry(900, 32, 16) BackSide, generates a real PMREM environment
   * map (`scene.environment = envTex`), and sets up balanced 3-point lighting + FogExp2.
   */
  function createRealisticSkyAndLighting(scene, renderer, options) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error(
        "WorldRealism.createRealisticSkyAndLighting requires global THREE.",
      );
    }
    var opts = options || {};

    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure =
        typeof opts.exposure === "number" ? opts.exposure : 1.05;
      renderer.outputEncoding = THREE.sRGBEncoding;
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    }

    var sunPosArr = opts.sunPosition || [120, 95, 65];
    var sunPos = new THREE.Vector3(sunPosArr[0], sunPosArr[1], sunPosArr[2]);
    var sunDir = sunPos.clone().normalize();

    var topColor = new THREE.Color(
      opts.skyTopColor !== undefined ? opts.skyTopColor : 0x1e57b8,
    );
    var midColor = new THREE.Color(
      opts.skyMidColor !== undefined ? opts.skyMidColor : 0x7db4e8,
    );
    var horizonColor = new THREE.Color(
      opts.skyHorizonColor !== undefined ? opts.skyHorizonColor : 0xffdfa8,
    );
    var sunDiskColor = new THREE.Color(
      opts.sunDiskColor !== undefined ? opts.sunDiskColor : 0xfff4d2,
    );
    var groundBounceColor = new THREE.Color(
      opts.groundColor !== undefined ? opts.groundColor : 0x3b4928,
    );

    var skyUniforms = {
      uTopColor: { value: topColor },
      uMidColor: { value: midColor },
      uHorizonColor: { value: horizonColor },
      uSunColor: { value: sunDiskColor },
      uGroundColor: { value: groundBounceColor },
      uSunDir: { value: sunDir },
    };

    var skyVertexShader = [
      "varying vec3 vWorldDir;",
      "void main() {",
      "  vWorldDir = position;",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "}",
    ].join("\n");

    var skyFragmentShader = [
      "varying vec3 vWorldDir;",
      "uniform vec3 uTopColor;",
      "uniform vec3 uMidColor;",
      "uniform vec3 uHorizonColor;",
      "uniform vec3 uSunColor;",
      "uniform vec3 uGroundColor;",
      "uniform vec3 uSunDir;",
      "void main() {",
      "  vec3 dir = normalize(vWorldDir);",
      "  float h = dir.y;",
      "  vec3 col;",
      "  if (h >= 0.0) {",
      "    vec3 lowMix = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));",
      "    col = mix(lowMix, uTopColor, smoothstep(0.22, 0.88, h));",
      "  } else {",
      "    col = mix(uHorizonColor, uGroundColor, smoothstep(0.0, -0.35, h));",
      "  }",
      "  float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0001);",
      "  float sunGlow = pow(sunAmt, 12.0) * 0.35;",
      "  float sunHalo = pow(sunAmt, 96.0) * 0.65;",
      "  float sunDisc = smoothstep(0.9982, 0.9995, sunAmt) * 2.2;",
      "  col += uSunColor * (sunGlow + sunHalo + sunDisc);",
      "  gl_FragColor = vec4(col, 1.0);",
      "}",
    ].join("\n");

    var skyGeo = new THREE.SphereGeometry(900, 32, 16);
    var skyMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    var skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = "WorldRealismSkyDome";
    scene.add(skyDome);

    // Real PMREM environment map for metallic/PBR .glb reflections
    var envTex = null;
    if (renderer && typeof THREE.PMREMGenerator === "function") {
      try {
        var envScene = new THREE.Scene();
        var envSkyGeo = new THREE.SphereGeometry(60, 20, 12);
        var envSkyMesh = new THREE.Mesh(
          envSkyGeo,
          new THREE.MeshBasicMaterial({
            side: THREE.BackSide,
            color: midColor,
          }),
        );
        envScene.add(envSkyMesh);

        var horizonCard = new THREE.Mesh(
          new THREE.PlaneGeometry(75, 22),
          new THREE.MeshBasicMaterial({ color: horizonColor }),
        );
        horizonCard.position.set(0, 10, -42);
        horizonCard.lookAt(0, 0, 0);
        envScene.add(horizonCard);

        var envGround = new THREE.Mesh(
          new THREE.PlaneGeometry(120, 120),
          new THREE.MeshBasicMaterial({ color: groundBounceColor }),
        );
        envGround.rotation.x = -Math.PI / 2;
        envGround.position.y = -8;
        envScene.add(envGround);

        var sunCard = new THREE.Mesh(
          new THREE.PlaneGeometry(36, 18),
          new THREE.MeshBasicMaterial({ color: sunDiskColor }),
        );
        sunCard.position.copy(sunDir).multiplyScalar(45);
        sunCard.lookAt(0, 0, 0);
        envScene.add(sunCard);

        var pmremGenerator = new THREE.PMREMGenerator(renderer);
        envTex = pmremGenerator.fromScene(envScene, 0.04).texture;
        scene.environment = envTex;
        pmremGenerator.dispose();
      } catch (err) {
        // Headless/mocked WebGL fallback safe no-op
      }
    }

    // Balanced 3-point lighting: HemisphereLight + DirectionalLight (key) + Rim light + FogExp2
    var hemiLight = new THREE.HemisphereLight(
      opts.hemiSkyColor !== undefined ? opts.hemiSkyColor : 0xc6e0ff,
      opts.hemiGroundColor !== undefined ? opts.hemiGroundColor : 0x5c533b,
      typeof opts.hemiIntensity === "number" ? opts.hemiIntensity : 0.62,
    );
    hemiLight.position.set(0, 120, 0);
    scene.add(hemiLight);

    var sunLight = new THREE.DirectionalLight(
      opts.sunLightColor !== undefined ? opts.sunLightColor : 0xffe6ba,
      typeof opts.sunIntensity === "number" ? opts.sunIntensity : 1.25,
    );
    sunLight.position.copy(sunPos);
    sunLight.castShadow = true;

    var shadowSize = opts.shadowMapSize || 2048;
    var frustum = opts.shadowFrustum || 95;
    if (sunLight.shadow) {
      sunLight.shadow.mapSize.set(shadowSize, shadowSize);
      sunLight.shadow.bias =
        typeof opts.shadowBias === "number" ? opts.shadowBias : -0.0005;
      if (sunLight.shadow.camera) {
        sunLight.shadow.camera.left = -frustum;
        sunLight.shadow.camera.right = frustum;
        sunLight.shadow.camera.top = frustum;
        sunLight.shadow.camera.bottom = -frustum;
        sunLight.shadow.camera.near = 10;
        sunLight.shadow.camera.far = 450;
        if (
          typeof sunLight.shadow.camera.updateProjectionMatrix === "function"
        ) {
          sunLight.shadow.camera.updateProjectionMatrix();
        }
      }
    }
    scene.add(sunLight);
    if (sunLight.target) {
      scene.add(sunLight.target);
    }

    var rimLight = new THREE.DirectionalLight(
      opts.rimLightColor !== undefined ? opts.rimLightColor : 0x9cbcff,
      typeof opts.rimIntensity === "number" ? opts.rimIntensity : 0.38,
    );
    rimLight.position.set(-sunPos.x * 0.75, 48, -sunPos.z * 0.75);
    scene.add(rimLight);

    var fogColor = opts.fogColor !== undefined ? opts.fogColor : 0xdccbb0;
    var fogDensity =
      typeof opts.fogDensity === "number" ? opts.fogDensity : 0.00075;
    scene.fog = new THREE.FogExp2(fogColor, fogDensity);

    return {
      skyDome: skyDome,
      envTexture: envTex,
      hemiLight: hemiLight,
      sunLight: sunLight,
      rimLight: rimLight,
      fog: scene.fog,
      followTarget: function (targetPos) {
        if (!targetPos) return;
        skyDome.position.set(targetPos.x, 0, targetPos.z);
        sunLight.position.set(
          targetPos.x + sunPos.x,
          sunPos.y,
          targetPos.z + sunPos.z,
        );
        if (sunLight.target) {
          sunLight.target.position.set(
            targetPos.x,
            targetPos.y || 0,
            targetPos.z,
          );
          if (typeof sunLight.target.updateMatrixWorld === "function") {
            sunLight.target.updateMatrixWorld();
          }
        }
      },
    };
  }

  /**
   * Internal helper to create a 2D canvas (browser or lightweight stub in Node).
   */
  function makeCanvas(w, h) {
    if (
      typeof document !== "undefined" &&
      typeof document.createElement === "function"
    ) {
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }
    return {
      width: w,
      height: h,
      getContext: function () {
        return null;
      },
    };
  }

  /**
   * 2. createProceduralPBRMaterial(kind, options)
   * Generates 512x512 procedural CanvasTexture Albedo + NormalMap (computed via
   * 3x3 Sobel filter over heightfield!) + RoughnessMap with RepeatWrapping and
   * anisotropy = 8 for 'asphalt', 'grass', 'rock', 'dirt', 'kerb'.
   */
  function createProceduralPBRMaterial(kind, options) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error(
        "WorldRealism.createProceduralPBRMaterial requires global THREE.",
      );
    }
    var opts = options || {};
    var size = opts.size || 512;
    var repeatX =
      opts.repeatX ||
      (Array.isArray(opts.repeat) ? opts.repeat[0] : opts.repeat || 1);
    var repeatY =
      opts.repeatY ||
      (Array.isArray(opts.repeat) ? opts.repeat[1] : opts.repeat || 1);
    var anisotropy = opts.anisotropy || 8;
    var surfaceKind = String(kind || "asphalt").toLowerCase();

    var heightField = new Float32Array(size * size);
    var albedoCanvas = makeCanvas(size, size);
    var normalCanvas = makeCanvas(size, size);
    var roughCanvas = makeCanvas(size, size);

    var albedoCtx = albedoCanvas.getContext
      ? albedoCanvas.getContext("2d")
      : null;
    var normalCtx = normalCanvas.getContext
      ? normalCanvas.getContext("2d")
      : null;
    var roughCtx = roughCanvas.getContext ? roughCanvas.getContext("2d") : null;

    var baseRoughness = 0.88;
    var baseMetalness = 0.0;
    var normalScaleVal = opts.normalScale || 1.1;

    if (
      albedoCtx &&
      normalCtx &&
      roughCtx &&
      typeof albedoCtx.createImageData === "function"
    ) {
      var albedoImg = albedoCtx.createImageData(size, size);
      var normalImg = normalCtx.createImageData(size, size);
      var roughImg = roughCtx.createImageData(size, size);
      var aData = albedoImg.data;
      var nData = normalImg.data;
      var rData = roughImg.data;

      // Pass 1: synthesize heightfield, albedo RGB, and roughness per pixel
      for (var y = 0; y < size; y++) {
        var v = y / size;
        for (var x = 0; x < size; x++) {
          var u = x / size;
          var idx = y * size + x;
          var p4 = idx * 4;

          var fine = hash2(x, y, 11);
          var med = fbmTileable(u, v, 8, 3, 23);
          var coarse = fbmTileable(u, v, 4, 2, 71);

          var r = 128,
            g = 128,
            b = 128,
            hVal = 0.5,
            rough = 210;

          if (surfaceKind === "asphalt") {
            var agg = fine * 0.55 + med * 0.35 + coarse * 0.1;
            hVal = agg;
            var baseTone = 44 + (agg - 0.5) * 34 + (coarse - 0.5) * 16;
            var sparkle = fine > 0.965 ? 28 : 0;
            r = baseTone + sparkle;
            g = baseTone + 2 + sparkle;
            b = baseTone + 5 + sparkle;
            rough = 215 + (0.5 - coarse) * 35 - (sparkle ? 40 : 0);

            // Optional lane markings if requested
            if (opts.roadMarkings) {
              var edgeStripe = u < 0.045 || u > 0.955;
              var centerDash =
                Math.abs(u - 0.5) < 0.014 && (v * 4.0) % 1.0 < 0.55;
              if (edgeStripe || centerDash) {
                var wear = 0.78 + 0.22 * med;
                r = 232 * wear;
                g = 228 * wear;
                b = 215 * wear;
                hVal = Math.min(1.0, hVal + 0.15);
                rough = 175;
              }
            }
          } else if (surfaceKind === "grass") {
            var patch = coarse;
            var bladeTex = fbmTileable(u * 2.0, v * 2.0, 16, 3, 41);
            hVal = bladeTex * 0.65 + fine * 0.35;
            r = 56 + patch * 42 + (bladeTex - 0.5) * 28;
            g = 94 + patch * 48 + (bladeTex - 0.5) * 36;
            b = 34 + patch * 20 + (fine - 0.5) * 16;
            rough = 225 + (1.0 - bladeTex) * 25;
          } else if (surfaceKind === "rock") {
            var strata = fbmTileable(u, v * 1.5, 6, 4, 59);
            var crag = Math.abs(med - 0.5) * 2.0;
            hVal = strata * 0.6 + (1.0 - crag) * 0.25 + fine * 0.15;
            var rockBase = 95 + (strata - 0.5) * 58 - crag * 28;
            r = rockBase + 4;
            g = rockBase + 1;
            b = rockBase - 5;
            rough = 210 + crag * 38;
          } else if (surfaceKind === "dirt") {
            var soil = med * 0.65 + coarse * 0.25 + fine * 0.1;
            hVal = soil;
            r = 108 + (soil - 0.5) * 48;
            g = 82 + (soil - 0.5) * 36;
            b = 54 + (soil - 0.5) * 26;
            rough = 230 + (0.5 - soil) * 20;
          } else if (surfaceKind === "kerb") {
            var stripe = Math.floor(v * 4.0) % 2 === 0;
            var grime = (1.0 - coarse * 0.22) * (0.9 + fine * 0.1);
            hVal =
              0.5 +
              (med - 0.5) * 0.35 +
              (fine - 0.5) * 0.2 +
              (stripe ? 0.06 : -0.06);
            if (stripe) {
              r = 212 * grime;
              g = 38 * grime;
              b = 42 * grime;
            } else {
              r = 238 * grime;
              g = 238 * grime;
              b = 235 * grime;
            }
            rough = 195 + (1.0 - med) * 35;
          } else {
            hVal = med * 0.7 + fine * 0.3;
            r = 120 + (hVal - 0.5) * 40;
            g = 120 + (hVal - 0.5) * 40;
            b = 120 + (hVal - 0.5) * 40;
            rough = 210;
          }

          heightField[idx] = hVal;
          aData[p4] = clamp(Math.round(r), 0, 255);
          aData[p4 + 1] = clamp(Math.round(g), 0, 255);
          aData[p4 + 2] = clamp(Math.round(b), 0, 255);
          aData[p4 + 3] = 255;

          var rByte = clamp(Math.round(rough), 0, 255);
          rData[p4] = rByte;
          rData[p4 + 1] = rByte;
          rData[p4 + 2] = rByte;
          rData[p4 + 3] = 255;
        }
      }

      // Pass 2: 3x3 Sobel filter over heightField to generate tangent-space normal map
      var sobelStrength =
        opts.sobelStrength || (surfaceKind === "rock" ? 4.2 : 3.0);
      for (var ny = 0; ny < size; ny++) {
        var ym1 = (ny - 1 + size) % size;
        var yp1 = (ny + 1) % size;
        for (var nx = 0; nx < size; nx++) {
          var xm1 = (nx - 1 + size) % size;
          var xp1 = (nx + 1) % size;

          var tl = heightField[ym1 * size + xm1];
          var tc = heightField[ym1 * size + nx];
          var tr = heightField[ym1 * size + xp1];
          var ml = heightField[ny * size + xm1];
          var mr = heightField[ny * size + xp1];
          var bl = heightField[yp1 * size + xm1];
          var bc = heightField[yp1 * size + nx];
          var br = heightField[yp1 * size + xp1];

          // Sobel X and Y kernels
          var dX = tr + 2.0 * mr + br - (tl + 2.0 * ml + bl);
          var dY = bl + 2.0 * bc + br - (tl + 2.0 * tc + tr);

          var vx = -dX * sobelStrength;
          var vy = -dY * sobelStrength;
          var vz = 1.0;
          var invLen = 1.0 / Math.sqrt(vx * vx + vy * vy + vz * vz);
          vx *= invLen;
          vy *= invLen;
          vz *= invLen;

          var np4 = (ny * size + nx) * 4;
          nData[np4] = clamp(Math.round((vx * 0.5 + 0.5) * 255), 0, 255);
          nData[np4 + 1] = clamp(Math.round((vy * 0.5 + 0.5) * 255), 0, 255);
          nData[np4 + 2] = clamp(Math.round((vz * 0.5 + 0.5) * 255), 0, 255);
          nData[np4 + 3] = 255;
        }
      }

      albedoCtx.putImageData(albedoImg, 0, 0);
      normalCtx.putImageData(normalImg, 0, 0);
      roughCtx.putImageData(roughImg, 0, 0);
    }

    function configureTex(canvas, isSRGB) {
      var tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      if (tex.repeat && typeof tex.repeat.set === "function") {
        tex.repeat.set(repeatX, repeatY);
      }
      tex.anisotropy = anisotropy;
      if (isSRGB && THREE.sRGBEncoding !== undefined) {
        tex.encoding = THREE.sRGBEncoding;
      }
      tex.needsUpdate = true;
      return tex;
    }

    var albedoTex = configureTex(albedoCanvas, true);
    var normalTex = configureTex(normalCanvas, false);
    var roughnessTex = configureTex(roughCanvas, false);

    var mat = new THREE.MeshStandardMaterial({
      map: albedoTex,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(normalScaleVal, normalScaleVal),
      roughnessMap: roughnessTex,
      roughness:
        typeof opts.roughness === "number" ? opts.roughness : baseRoughness,
      metalness:
        typeof opts.metalness === "number" ? opts.metalness : baseMetalness,
      envMapIntensity:
        typeof opts.envMapIntensity === "number" ? opts.envMapIntensity : 0.35,
    });

    mat.userData = mat.userData || {};
    mat.userData.pbrKind = surfaceKind;
    mat.userData.textures = {
      albedo: albedoTex,
      normal: normalTex,
      roughness: roughnessTex,
    };

    return mat;
  }

  /**
   * Builds a 3-blade crossed grass tuft BufferGeometry (15 vertices, 9 triangles):
   * - 3 curved tapered blades rotated at 0°, 60°, and 120° around Y
   * - Varying heights (0.45m to 0.85m) and base width 0.18m per blade
   * - 25,000 instances = 75,000 dense 3D grass blades!
   * - Vertex colors: dark lush green at root -> warm sunlit green at tip
   */
  function createTaperedBladeGeometry(THREE, bladeHeight, bladeWidth) {
    var baseH = bladeHeight || 0.68;
    var W = bladeWidth || 0.18;
    var tuftAngles = [0.0, Math.PI / 3.0, (2.0 * Math.PI) / 3.0];
    var tuftHeights = [
      clamp(baseH * 0.78, 0.45, 0.85),
      clamp(baseH * 1.12, 0.45, 0.85),
      clamp(baseH * 0.94, 0.45, 0.85),
    ];
    var tuftOffsets = [
      [0.0, 0.0],
      [0.035, -0.025],
      [-0.03, 0.03],
    ];

    var positions = new Float32Array(15 * 3);
    var normals = new Float32Array(15 * 3);
    var colors = new Float32Array(15 * 3);
    var uvs = new Float32Array(15 * 2);
    var indices = [];

    for (var b = 0; b < 3; b++) {
      var H = tuftHeights[b];
      var ang = tuftAngles[b];
      var ca = Math.cos(ang);
      var sa = Math.sin(ang);
      var ox = tuftOffsets[b][0];
      var oz = tuftOffsets[b][1];

      var hw0 = W * 0.42;
      var hw1 = W * 0.22;
      var midY = H * 0.52;
      var midZ = H * 0.14;
      var tipZ = H * 0.34;

      var localPos = [
        [-hw0, 0.0, 0.0],
        [hw0, 0.0, 0.0],
        [-hw1, midY, midZ],
        [hw1, midY, midZ],
        [0.0, H, tipZ],
      ];
      var localNor = [
        [-0.25, 0.18, 0.95],
        [0.25, 0.18, 0.95],
        [-0.22, 0.28, 0.93],
        [0.22, 0.28, 0.93],
        [0.0, 0.45, 0.89],
      ];
      var localCol = [
        [0.09, 0.21, 0.06],
        [0.09, 0.21, 0.06],
        [0.22, 0.46, 0.13],
        [0.22, 0.46, 0.13],
        [0.52, 0.74, 0.22],
      ];
      var localUv = [
        [0.0, 0.0],
        [1.0, 0.0],
        [0.15, 0.52],
        [0.85, 0.52],
        [0.5, 1.0],
      ];

      var vBase = b * 5;
      for (var v = 0; v < 5; v++) {
        var lx = localPos[v][0];
        var ly = localPos[v][1];
        var lz = localPos[v][2];
        var rx = lx * ca + lz * sa + ox;
        var rz = -lx * sa + lz * ca + oz;
        var pIdx = (vBase + v) * 3;
        positions[pIdx] = rx;
        positions[pIdx + 1] = ly;
        positions[pIdx + 2] = rz;

        var nx = localNor[v][0];
        var ny = localNor[v][1];
        var nz = localNor[v][2];
        normals[pIdx] = nx * ca + nz * sa;
        normals[pIdx + 1] = ny;
        normals[pIdx + 2] = -nx * sa + nz * ca;

        colors[pIdx] = localCol[v][0];
        colors[pIdx + 1] = localCol[v][1];
        colors[pIdx + 2] = localCol[v][2];

        var uIdx = (vBase + v) * 2;
        uvs[uIdx] = localUv[v][0];
        uvs[uIdx + 1] = localUv[v][1];
      }

      indices.push(
        vBase + 0,
        vBase + 1,
        vBase + 2,
        vBase + 1,
        vBase + 3,
        vBase + 2,
        vBase + 2,
        vBase + 3,
        vBase + 4,
      );
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * 3. create3DGrassField(scene, options)
   * NEVER a flat box or plane! Builds a THREE.InstancedMesh of 20,000-35,000
   * 3-blade crossed grass tufts (15 vertices per instance = 75,000+ 3D curved
   * grass blades) with vertex colors and an onBeforeCompile wind-sway vertex
   * shader (`uTime` uniform) that bends blades in travelling wind waves while
   * keeping roots pinned to the ground.
   */
  function create3DGrassField(scene, options) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error("WorldRealism.create3DGrassField requires global THREE.");
    }
    var opts = options || {};
    var requestedCount = typeof opts.count === "number" ? opts.count : 26000;
    var count = clamp(Math.floor(requestedCount), 20000, 35000);
    var spread = opts.spread || opts.areaSize || 380;
    var bladeHeight = opts.bladeHeight || 0.68;
    var bladeWidth = opts.bladeWidth || 0.18;
    var excludeFn =
      typeof opts.excludeFn === "function" ? opts.excludeFn : null;
    var heightFn = typeof opts.heightFn === "function" ? opts.heightFn : null;
    var sampleFn = typeof opts.sampleFn === "function" ? opts.sampleFn : null;

    var bladeGeo = createTaperedBladeGeometry(THREE, bladeHeight, bladeWidth);

    var windUniforms = {
      uTime: { value: 0.0 },
      uBladeHeight: { value: bladeHeight },
    };

    var grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.04,
      side: THREE.DoubleSide,
      envMapIntensity: 0.45,
    });

    grassMat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uBladeHeight = windUniforms.uBladeHeight;

      shader.vertexShader =
        "uniform float uTime;\nuniform float uBladeHeight;\n" +
        shader.vertexShader;

      var bendSnippet = [
        "#include <begin_vertex>",
        "float hFrac = clamp(position.y / max(uBladeHeight, 0.001), 0.0, 1.0);",
        "float bendWeight = hFrac * hFrac;",
        "vec4 instWorld = vec4(position, 1.0);",
        "#ifdef USE_INSTANCING",
        "  instWorld = instanceMatrix * instWorld;",
        "#endif",
        "float worldX = instWorld.x;",
        "float worldZ = instWorld.z;",
        "float wave = sin(worldX * 0.4 + uTime * 2.2) * cos(worldZ * 0.3 + uTime * 1.7);",
        "float gust = sin(worldX * 0.12 - worldZ * 0.15 + uTime * 3.1) * 0.35;",
        "float sway = (wave + gust) * 0.24 * bendWeight;",
        "transformed.x += sway;",
        "transformed.z += sway * 0.65;",
        "transformed.y -= abs(sway) * 0.15 * bendWeight;",
      ].join("\n");

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        bendSnippet,
      );
      grassMat.userData.shader = shader;
    };

    var instancedMesh = new THREE.InstancedMesh(bladeGeo, grassMat, count);
    instancedMesh.name = "WorldRealism3DGrassField";
    instancedMesh.castShadow = !!opts.castShadow;
    instancedMesh.receiveShadow = opts.receiveShadow !== false;
    instancedMesh.frustumCulled = false;

    var dummy = new THREE.Object3D();
    var tintColor = new THREE.Color();
    var placed = 0;
    var maxAttempts = count * 5;
    var attempt = 0;

    while (placed < count && attempt < maxAttempts) {
      attempt++;
      var rx = 0,
        rz = 0;
      if (sampleFn) {
        var sp = sampleFn(
          attempt,
          hash2(attempt, 13, 101),
          hash2(attempt, 29, 203),
        );
        rx = sp[0];
        rz = sp[1];
      } else {
        // Focus grass density near road verges and camera (distance 8m to 95m)
        var u1 = hash2(attempt, 13, 101);
        var u2 = hash2(attempt, 29, 203);
        if (attempt % 5 !== 0) {
          var ang = u1 * Math.PI * 2.0;
          var dist = 8.0 + Math.pow(u2, 0.75) * 87.0; // 8m to 95m band
          rx = Math.cos(ang) * dist;
          rz = Math.sin(ang) * dist;
        } else {
          rx = (u1 - 0.5) * spread;
          rz = (u2 - 0.5) * spread;
        }
      }

      if (excludeFn && excludeFn(rx, rz)) {
        continue;
      }

      var ry = heightFn ? heightFn(rx, rz) : 0.0;
      var yaw = hash2(attempt, 47, 307) * Math.PI * 2.0;
      var tiltX = (hash2(attempt, 61, 409) - 0.5) * 0.22;
      var tiltZ = (hash2(attempt, 79, 503) - 0.5) * 0.22;
      var scaleXZ = 0.85 + hash2(attempt, 97, 607) * 0.45;
      var scaleY = 0.85 + hash2(attempt, 113, 709) * 0.65;

      dummy.position.set(rx, ry, rz);
      dummy.rotation.set(tiltX, yaw, tiltZ);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(placed, dummy.matrix);

      if (typeof instancedMesh.setColorAt === "function") {
        var hueShift = (hash2(attempt, 131, 809) - 0.5) * 0.04;
        var lumShift = 0.86 + hash2(attempt, 151, 907) * 0.28;
        tintColor.setRGB(
          clamp(lumShift + hueShift, 0.65, 1.15),
          clamp(lumShift, 0.72, 1.15),
          clamp(lumShift - hueShift * 0.8, 0.6, 1.1),
        );
        instancedMesh.setColorAt(placed, tintColor);
      }

      placed++;
    }

    instancedMesh.count = placed;
    if (instancedMesh.instanceMatrix) {
      instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    if (scene && typeof scene.add === "function") {
      scene.add(instancedMesh);
    }

    return {
      mesh: instancedMesh,
      geometry: bladeGeo,
      material: grassMat,
      uniforms: windUniforms,
      count: placed,
      update: function (dt, playerPos) {
        var step =
          typeof dt === "number" && dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
        windUniforms.uTime.value += step;
        if (playerPos && opts.followPlayer) {
          instancedMesh.position.x = playerPos.x;
          instancedMesh.position.z = playerPos.z;
        }
      },
    };
  }

  /**
   * Normalizes a 3D Object3D / GLTF scene root so its longest horizontal/overall
   * dimension matches `targetLength`, and grounds its bounding-box minimum Y at 0.
   */
  function normalizeToSize(rootObj, targetLength) {
    var THREE = root.THREE;
    if (!THREE || !rootObj) return rootObj;

    if (typeof rootObj.updateMatrixWorld === "function") {
      rootObj.updateMatrixWorld(true);
    }

    var box = new THREE.Box3().setFromObject(rootObj);
    if (box.isEmpty()) return rootObj;

    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    var maxDim = Math.max(size.x, size.y, size.z);
    if (targetLength && maxDim > 1e-5) {
      var scaleFactor = targetLength / maxDim;
      rootObj.scale.multiplyScalar(scaleFactor);
      if (typeof rootObj.updateMatrixWorld === "function") {
        rootObj.updateMatrixWorld(true);
      }
      box.setFromObject(rootObj);
      box.getCenter(center);
    }

    // Center X and Z around local origin and ground min.y to 0
    rootObj.position.x -= center.x;
    rootObj.position.z -= center.z;
    rootObj.position.y -= box.min.y;

    if (typeof rootObj.updateMatrixWorld === "function") {
      rootObj.updateMatrixWorld(true);
    }
    return rootObj;
  }

  /**
   * 4. loadGlbModel(url, onLoaded, options)
   * Wraps THREE.GLTFLoader with automatic shadow casting/receiving,
   * material `envMapIntensity = 1.2`, and bounding-box auto-grounding +
   * target-size normalization (`normalizeToSize(root, targetLength)`).
   */
  function loadGlbModel(url, onLoaded, options) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error("WorldRealism.loadGlbModel requires global THREE.");
    }

    var opts = {};
    var callback = onLoaded;
    if (typeof onLoaded === "object" && onLoaded !== null) {
      opts = onLoaded;
      callback = typeof opts.onLoaded === "function" ? opts.onLoaded : null;
    } else if (typeof options === "object" && options !== null) {
      opts = options;
    }

    var targetLength =
      typeof opts.targetLength === "number"
        ? opts.targetLength
        : typeof opts.targetSize === "number"
          ? opts.targetSize
          : null;
    var envMapIntensity =
      typeof opts.envMapIntensity === "number" ? opts.envMapIntensity : 1.2;
    var castShadow = opts.castShadow !== false;
    var receiveShadow = opts.receiveShadow !== false;
    var autoGround = opts.autoGround !== false;

    if (typeof THREE.GLTFLoader !== "function") {
      var err = new Error(
        'THREE.GLTFLoader is not loaded. Include <script src="/studio/vendor/GLTFLoader.js" defer></script> after three.min.js.',
      );
      if (typeof opts.onError === "function") opts.onError(err);
      return Promise.reject(err);
    }

    var loader = new THREE.GLTFLoader();

    return new Promise(function (resolve, reject) {
      loader.load(
        url,
        function (gltf) {
          var modelRoot =
            (gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]))) || null;
          if (!modelRoot) {
            var emptyErr = new Error(
              "GLB loaded without a valid scene root: " + url,
            );
            if (typeof opts.onError === "function") opts.onError(emptyErr);
            reject(emptyErr);
            return;
          }

          modelRoot.traverse(function (node) {
            if (node && node.isMesh) {
              node.castShadow = castShadow;
              node.receiveShadow = receiveShadow;
              var mats = Array.isArray(node.material)
                ? node.material
                : [node.material];
              for (var i = 0; i < mats.length; i++) {
                var m = mats[i];
                if (!m) continue;
                m.envMapIntensity = envMapIntensity;
                if (m.map && THREE.sRGBEncoding !== undefined) {
                  m.map.encoding = THREE.sRGBEncoding;
                }
                m.needsUpdate = true;
              }
            }
          });

          if (targetLength || autoGround) {
            normalizeToSize(modelRoot, targetLength);
          }

          if (typeof callback === "function") {
            callback(modelRoot, gltf);
          }
          resolve(modelRoot);
        },
        opts.onProgress || undefined,
        function (err) {
          if (typeof opts.onError === "function") {
            opts.onError(err);
          }
          reject(err);
        },
      );
    });
  }

  var WorldRealism = {
    createRealisticSkyAndLighting: createRealisticSkyAndLighting,
    createProceduralPBRMaterial: createProceduralPBRMaterial,
    create3DGrassField: create3DGrassField,
    loadGlbModel: loadGlbModel,
    normalizeToSize: normalizeToSize,
  };

  root.WorldRealism = WorldRealism;
  if (typeof window !== "undefined") {
    window.WorldRealism = WorldRealism;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : this,
);
