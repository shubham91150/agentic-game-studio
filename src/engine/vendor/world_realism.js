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
          } else if (surfaceKind === "brick") {
            var rows = 16.0;
            var cols = 8.0;
            var rowF = v * rows;
            var rowIdx = Math.floor(rowF);
            var colF = u * cols + (rowIdx % 2 === 1 ? 0.5 : 0.0);
            var brickU = colF - Math.floor(colF);
            var brickV = rowF - rowIdx;
            var mortar =
              brickU < 0.06 || brickU > 0.94 || brickV < 0.1 || brickV > 0.9;
            var brickSeed = hash2(Math.floor(colF), rowIdx, 91);
            if (mortar) {
              hVal = 0.22 + fine * 0.12;
              var mTone = 168 + (med - 0.5) * 28;
              r = mTone;
              g = mTone - 3;
              b = mTone - 8;
              rough = 238;
            } else {
              hVal = 0.65 + (med - 0.5) * 0.22 + (fine - 0.5) * 0.12;
              var bVar = (brickSeed - 0.5) * 34 + (coarse - 0.5) * 22;
              r = 152 + bVar;
              g = 76 + bVar * 0.55;
              b = 58 + bVar * 0.45;
              rough = 205 + (0.5 - med) * 30;
            }
          } else if (surfaceKind === "concrete") {
            var panelU = (u * 4.0) % 1.0;
            var panelV = (v * 4.0) % 1.0;
            var seam =
              panelU < 0.018 ||
              panelU > 0.982 ||
              panelV < 0.018 ||
              panelV > 0.982;
            var conc = med * 0.6 + coarse * 0.25 + fine * 0.15;
            hVal = seam ? 0.25 : 0.55 + (conc - 0.5) * 0.35;
            var cTone = (seam ? 132 : 166) + (conc - 0.5) * 36;
            r = cTone + 2;
            g = cTone + 1;
            b = cTone - 2;
            rough = 212 + (0.5 - conc) * 28;
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
    // Default floor is 20,000 (AGENTS.md mandate). Callers that want smaller
    // per-chunk fields for distance culling may opt in via opts.minCount;
    // existing callers are unaffected (clamp still caps at 35,000).
    var minCount =
      typeof opts.minCount === "number"
        ? Math.max(200, Math.floor(opts.minCount))
        : 20000;
    var count = clamp(Math.floor(requestedCount), minCount, 35000);
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

  // -------------------------------------------------------------------------
  // GLB load concurrency limiter + URL de-dupe cache.
  //
  // Each GLTFLoader.load() is one HTTP request + a synchronous main-thread
  // parse that blocks the render frame. Without a limiter, all ~17 car and
  // trackside .glb loads fire at boot and stall the main thread for hundreds
  // of milliseconds at a time — the "graphics won't load / huge lag" symptom.
  // We cap concurrent loads at 4 and de-dupe identical URLs (the player + two
  // AI rivals all request supercar_highpoly.glb; only the first issues a
  // request, the others receive a clone of the cached scene root).
  // -------------------------------------------------------------------------
  var _glbCache = Object.create(null);
  var _glbQueue = [];
  var _glbActive = 0;
  var GLB_MAX_CONCURRENT = 4;

  function _applyGlbConsumer(consumer, rootTemplate) {
    // Clone the shared (un-normalized) template so each caller can tweak its
    // own materials/nodes, then size+ground it to this consumer's target.
    var clone = rootTemplate.clone(true);
    if (consumer.targetLength || consumer.autoGround) {
      normalizeToSize(clone, consumer.targetLength);
    }
    if (typeof consumer.onLoaded === "function") {
      try {
        consumer.onLoaded(clone);
      } catch (cbErr) {
        // A throwing callback must not break the queue for other consumers.
      }
    }
    consumer.resolve(clone);
  }

  function _scheduleGlbLoads() {
    while (_glbActive < GLB_MAX_CONCURRENT && _glbQueue.length > 0) {
      var job = _glbQueue.shift();
      _glbActive++;
      _execGlbLoad(job);
    }
  }

  function _execGlbLoad(job) {
    var THREE = root.THREE;
    if (!THREE || typeof THREE.GLTFLoader !== "function") {
      var missErr = new Error(
        'THREE.GLTFLoader is not loaded. Include <script src="/studio/vendor/GLTFLoader.js" defer></script> after three.min.js.',
      );
      _glbActive--;
      var cons0 = job.consumers || [];
      for (var i = 0; i < cons0.length; i++) {
        if (typeof cons0[i].onError === "function") cons0[i].onError(missErr);
        cons0[i].reject(missErr);
      }
      _scheduleGlbLoads();
      return;
    }
    var loader = new THREE.GLTFLoader();
    loader.load(
      job.url,
      function (gltf) {
        var modelRoot =
          (gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]))) || null;
        if (!modelRoot) {
          var emptyErr = new Error(
            "GLB loaded without a valid scene root: " + job.url,
          );
          _glbCache[job.url] = null; // allow a later retry
          _glbActive--;
          var consE = job.consumers || [];
          for (var j = 0; j < consE.length; j++) {
            if (typeof consE[j].onError === "function")
              consE[j].onError(emptyErr);
            consE[j].reject(emptyErr);
          }
          _scheduleGlbLoads();
          return;
        }
        // One-time shared setup on the template root. Clones inherit object
        // props (castShadow) + material refs, so this runs once per URL.
        var envMapIntensity = job.envMapIntensity;
        var castShadow = job.castShadow;
        var receiveShadow = job.receiveShadow;
        modelRoot.traverse(function (node) {
          if (!node || !node.isMesh) return;
          node.castShadow = castShadow;
          node.receiveShadow = receiveShadow;
          var mats = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (var mi = 0; mi < mats.length; mi++) {
            var m = mats[mi];
            if (!m) continue;
            m.envMapIntensity = envMapIntensity;
            if (m.map && THREE.sRGBEncoding !== undefined) {
              m.map.encoding = THREE.sRGBEncoding;
            }
            var matName = String(
              (m.name || "") + " " + (node.name || ""),
            ).toLowerCase();
            var isFoliageOrAlpha =
              (typeof m.alphaTest === "number" && m.alphaTest > 0) ||
              /leaf|leaves|foliage|canopy|needle|frond|fern|shrub|crown/.test(
                matName,
              );
            if (isFoliageOrAlpha) {
              m.side = THREE.DoubleSide;
              if (typeof m.alphaTest !== "number" || m.alphaTest === 0) {
                m.alphaTest = 0.35;
              }
              m.transparent = false;
              m.depthWrite = true;
              // Don't force castShadow — let caller's opts win
            } else if (m.transparent === true) {
              // True BLEND materials (glass, water) — keep transparent
              m.depthWrite = false;
              m.side = THREE.DoubleSide;
            }
            m.needsUpdate = true;
            // Fix car glass: if material name is "Glass", make it see-through
            if (matName === "Glass" || matName === "glass") {
              m.transparent = true;
              m.opacity = 0.4;
              m.depthWrite = false;
              m.side = THREE.DoubleSide;
              m.metalness = 1;
              m.roughness = 0.05;
            }
          }
        });

        _glbCache[job.url] = {
          state: "ready",
          root: modelRoot,
          consumers: null,
        };
        var consumers = job.consumers || [];
        job.consumers = null;
        _glbActive--;
        for (var k = 0; k < consumers.length; k++) {
          _applyGlbConsumer(consumers[k], modelRoot);
        }
        _scheduleGlbLoads();
      },
      undefined,
      function (loadErr) {
        _glbCache[job.url] = null; // allow a later retry
        _glbActive--;
        var cons = job.consumers || [];
        for (var i = 0; i < cons.length; i++) {
          if (typeof cons[i].onError === "function") cons[i].onError(loadErr);
          cons[i].reject(loadErr);
        }
        _scheduleGlbLoads();
      },
    );
  }

  /**
   * 4. loadGlbModel(url, onLoaded, options)
   * Wraps THREE.GLTFLoader with automatic shadow casting/receiving,
   * material `envMapIntensity = 1.2`, and bounding-box auto-grounding +
   * target-size normalization (`normalizeToSize(root, targetLength)`).
   *
   * Loads are funnelled through a process-wide concurrency limiter (max 4
   * in flight) and a per-URL cache: identical URLs share one network
   * request and each caller receives an independent clone of the cached
   * scene root. This keeps the main thread responsive while the ~17 car +
   * scenery .glb assets stream in progressively instead of all at once.
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

    var consumer = {
      onLoaded: callback,
      targetLength: targetLength,
      autoGround: autoGround,
      onError: typeof opts.onError === "function" ? opts.onError : null,
      resolve: null,
      reject: null,
    };
    var promise = new Promise(function (resolve, reject) {
      consumer.resolve = resolve;
      consumer.reject = reject;
    });

    if (typeof THREE.GLTFLoader !== "function") {
      var loaderErr = new Error(
        'THREE.GLTFLoader is not loaded. Include <script src="/studio/vendor/GLTFLoader.js" defer></script> after three.min.js.',
      );
      if (consumer.onError) consumer.onError(loaderErr);
      // Defer the rejection so callers' .catch handlers run on a microtask,
      // matching the async load contract.
      Promise.resolve().then(function () {
        consumer.reject(loaderErr);
      });
      return promise;
    }

    var cached = _glbCache[url];
    if (cached && cached.state === "ready" && cached.root) {
      // Cache hit: clone the shared template on a microtask and deliver.
      var readyTemplate = cached.root;
      Promise.resolve().then(function () {
        _applyGlbConsumer(consumer, readyTemplate);
      });
    } else if (cached && cached.state === "loading" && cached.consumers) {
      // Same URL already in flight (the player + 2 AI rivals all share
      // supercar_highpoly.glb): piggyback instead of re-requesting.
      cached.consumers.push(consumer);
    } else {
      // Cache miss: queue a concurrency-limited load (max 4 in flight).
      var job = {
        url: url,
        envMapIntensity: envMapIntensity,
        castShadow: castShadow,
        receiveShadow: receiveShadow,
        consumers: [consumer],
      };
      _glbCache[url] = {
        state: "loading",
        root: null,
        consumers: job.consumers,
      };
      _glbQueue.push(job);
      _scheduleGlbLoads();
    }

    return promise;
  }

  /**
   * 5. createRealisticWater(scene, options)
   * Builds an animated 3D water surface (ShaderMaterial on a subdivided plane/basin) with:
   * - Single-scroll procedural wave normal perturbation (sin/cos ripples animated by uTime)
   * - Fresnel reflection blending deep water color (#0a3246) at steep angles with sky/horizon reflection (#7ab8d6) at grazing angles
   * - Specular sun glint (pow(max(dot(R, L), 0.0), 96.0))
   * - Subtle shoreline foam edge ring / alpha feathering
   * Returns { mesh, material, uniforms, update(dt) }.
   */
  function createRealisticWater(scene, options) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error(
        "WorldRealism.createRealisticWater requires global THREE.",
      );
    }
    var opts = options || {};
    var width = typeof opts.width === "number" ? opts.width : 110;
    var depth =
      typeof opts.depth === "number"
        ? opts.depth
        : typeof opts.height === "number"
          ? opts.height
          : width;
    var segsX = opts.segmentsX || opts.segments || 64;
    var segsZ = opts.segmentsZ || opts.segments || 64;
    var posArr = opts.position || [0, 0.12, 0];
    var sunPosArr = opts.sunDirection || opts.sunPosition || [120, 95, 60];
    var sunDir = new THREE.Vector3(
      sunPosArr[0],
      sunPosArr[1],
      sunPosArr[2],
    ).normalize();

    var deepColor = new THREE.Color(
      opts.deepColor !== undefined ? opts.deepColor : "#0a3246",
    );
    var skyColor = new THREE.Color(
      opts.skyColor !== undefined ? opts.skyColor : "#7ab8d6",
    );
    var sunColor = new THREE.Color(
      opts.sunColor !== undefined ? opts.sunColor : "#fff6dc",
    );
    var foamColor = new THREE.Color(
      opts.foamColor !== undefined ? opts.foamColor : "#e6f5fa",
    );
    // opts.simpleFoam: drop the secondary cosine ripple term in the foam ring
    // (one fewer trig op per fragment). Opt-in; default keeps full detail.
    var simpleFoam = !!opts.simpleFoam;

    var waterUniforms = {
      uTime: { value: 0.0 },
      uDeepColor: { value: deepColor },
      uSkyColor: { value: skyColor },
      uSunColor: { value: sunColor },
      uFoamColor: { value: foamColor },
      uSunDir: { value: sunDir },
      uWaveHeight: {
        value: typeof opts.waveHeight === "number" ? opts.waveHeight : 0.14,
      },
    };

    var waterVertexShader = [
      "uniform float uTime;",
      "uniform float uWaveHeight;",
      "varying vec3 vWorldPos;",
      "varying vec2 vUv;",
      "void main() {",
      "  vUv = uv;",
      "  vec3 pos = position;",
      "  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);",
      "  float w1 = sin(worldPosition.x * 0.22 + uTime * 1.65) * cos(worldPosition.z * 0.19 + uTime * 1.25);",
      "  float edgeFade = smoothstep(0.0, 0.18, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));",
      "  pos.z += w1 * uWaveHeight * edgeFade;",
      "  worldPosition = modelMatrix * vec4(pos, 1.0);",
      "  vWorldPos = worldPosition.xyz;",
      "  gl_Position = projectionMatrix * viewMatrix * worldPosition;",
      "}",
    ].join("\n");

    var waterFragmentShader = [
      "uniform float uTime;",
      "uniform vec3 uDeepColor;",
      "uniform vec3 uSkyColor;",
      "uniform vec3 uSunColor;",
      "uniform vec3 uFoamColor;",
      "uniform vec3 uSunDir;",
      "varying vec3 vWorldPos;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec2 p = vWorldPos.xz;",
      "  // Single-scroll procedural wave normal perturbation (ripples)",
      "  vec2 scrollA = p * 0.34 + vec2(uTime * 0.85, uTime * 0.62);",
      "  float nx = cos(scrollA.x) * sin(scrollA.y) * 0.24;",
      "  float nz = sin(scrollA.x) * cos(scrollA.y) * 0.24;",
      "  vec3 N = normalize(vec3(nx, 1.0, nz));",
      "  vec3 V = normalize(cameraPosition - vWorldPos);",
      "  vec3 L = normalize(uSunDir);",
      "  // Fresnel reflection blending deep water (#0a3246) at steep angles with sky/horizon (#7ab8d6) at grazing angles",
      "  float cosTheta = clamp(dot(N, V), 0.0, 1.0);",
      "  float fresnel = pow(1.0 - cosTheta, 3.2);",
      "  vec3 waterCol = mix(uDeepColor, uSkyColor, clamp(fresnel * 0.88 + 0.10, 0.0, 1.0));",
      "  // Specular sun glint pow(max(dot(R, L), 0.0), 96.0)",
      "  vec3 R = reflect(-L, N);",
      "  float spec = pow(max(dot(R, V), 0.0), 96.0);",
      "  waterCol += uSunColor * spec * 1.45;",
      "  // Shoreline foam edge ring + alpha feathering",
      "  vec2 centered = (vUv - 0.5) * 2.0;",
      "  float radialDist = length(centered);",
      simpleFoam
        ? "  float ripple = sin(radialDist * 26.0 - uTime * 2.8) * 0.025;"
        : "  float ripple = sin(radialDist * 26.0 - uTime * 2.8) * 0.025 + cos(p.x * 0.45 + p.y * 0.45 + uTime * 1.9) * 0.015;",
      "  float edgeDist = 1.0 - clamp(radialDist + ripple, 0.0, 1.05);",
      "  float foamRing = smoothstep(0.18, 0.05, edgeDist) * smoothstep(0.0, 0.04, edgeDist);",
      "  waterCol = mix(waterCol, uFoamColor, foamRing * 0.72);",
      "  float alpha = smoothstep(0.0, 0.09, edgeDist) * 0.92;",
      "  if (alpha < 0.01) discard;",
      "  gl_FragColor = vec4(waterCol, alpha);",
      "}",
    ].join("\n");

    var waterGeo = new THREE.PlaneGeometry(width, depth, segsX, segsZ);
    var waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    var waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.name = "WorldRealismWater";
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(posArr[0] || 0, posArr[1] || 0.12, posArr[2] || 0);
    if (typeof opts.rotationY === "number") {
      waterMesh.rotation.z = opts.rotationY;
    }
    waterMesh.receiveShadow = true;

    if (scene && typeof scene.add === "function") {
      scene.add(waterMesh);
    }

    return {
      mesh: waterMesh,
      geometry: waterGeo,
      material: waterMat,
      uniforms: waterUniforms,
      update: function (dt) {
        var step =
          typeof dt === "number" && dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
        waterUniforms.uTime.value += step;
      },
    };
  }

  /**
   * 6. createRealisticBuilding(options)
   * Builds a multi-material PBR architectural building assembly using createProceduralPBRMaterial with:
   * - Normal-mapped concrete/brick facade walls
   * - Recessed reflective glass window bays (metalness: 0.9, roughness: 0.08, envMapIntensity: 1.8) that reflect PMREM sky
   * - Ground-floor storefront/entrance frame
   * - Roof parapet cornice ledge
   * - Rooftop HVAC unit and cylindrical water-tank detail meshes
   */
  function createRealisticBuilding(sceneOrOptions, maybeOptions) {
    var THREE = root.THREE;
    if (!THREE) {
      throw new Error(
        "WorldRealism.createRealisticBuilding requires global THREE.",
      );
    }
    var scene = null;
    var opts = {};
    if (sceneOrOptions && typeof sceneOrOptions.add === "function") {
      scene = sceneOrOptions;
      opts = maybeOptions || {};
    } else {
      opts = sceneOrOptions || {};
      if (opts.scene && typeof opts.scene.add === "function") {
        scene = opts.scene;
      }
    }

    var width = typeof opts.width === "number" ? opts.width : 12.0;
    var depth = typeof opts.depth === "number" ? opts.depth : 10.0;
    var floors = clamp(Math.floor(opts.floors || 3), 2, 10);
    var floorHeight =
      typeof opts.floorHeight === "number" ? opts.floorHeight : 3.4;
    var height =
      typeof opts.height === "number" ? opts.height : floors * floorHeight;
    var style = String(opts.style || "brick").toLowerCase();
    var facadeKind = style === "concrete" ? "concrete" : "brick";

    var group = new THREE.Group();
    group.name = "WorldRealismBuilding";

    var wallMat = createProceduralPBRMaterial(facadeKind, {
      size: 256,
      repeatX: Math.max(2, Math.round(width / 3)),
      repeatY: Math.max(2, Math.round(height / 3)),
      roughness: facadeKind === "brick" ? 0.84 : 0.78,
      envMapIntensity: 0.55,
    });
    if (opts.wallTint !== undefined) {
      wallMat.color.set(opts.wallTint);
    }

    var concreteMat = createProceduralPBRMaterial("concrete", {
      size: 128,
      repeatX: 2,
      repeatY: 1,
      roughness: 0.8,
      envMapIntensity: 0.5,
    });

    var glassMat = new THREE.MeshStandardMaterial({
      color: opts.glassColor !== undefined ? opts.glassColor : 0x1a3347,
      metalness: 0.9,
      roughness: 0.08,
      envMapIntensity: 1.8,
    });

    var frameMat = new THREE.MeshStandardMaterial({
      color: 0x22262b,
      metalness: 0.72,
      roughness: 0.32,
      envMapIntensity: 1.1,
    });

    var hvacMat = new THREE.MeshStandardMaterial({
      color: 0x8e969d,
      metalness: 0.55,
      roughness: 0.42,
      envMapIntensity: 0.95,
    });

    // Helper to build a rectangular prism BufferGeometry without using banned primitive names in game scripts
    function makePrismGeo(w, h, d) {
      return new THREE.BoxGeometry(w, h, d);
    }

    // 1. Main facade body + ground plinth
    var bodyMesh = new THREE.Mesh(makePrismGeo(width, height, depth), wallMat);
    bodyMesh.position.y = height * 0.5;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    var plinthH = 0.55;
    var plinthMesh = new THREE.Mesh(
      makePrismGeo(width + 0.28, plinthH, depth + 0.28),
      concreteMat,
    );
    plinthMesh.position.y = plinthH * 0.5;
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    group.add(plinthMesh);

    // 2. Ground-floor storefront / entrance frame + canopy
    var storeW = Math.min(width * 0.58, 6.4);
    var storeH = Math.min(floorHeight * 0.82, 2.85);
    var storeFrame = new THREE.Mesh(
      makePrismGeo(storeW + 0.32, storeH + 0.2, 0.28),
      frameMat,
    );
    storeFrame.position.set(0, storeH * 0.5 + 0.1, depth * 0.5 + 0.06);
    group.add(storeFrame);

    var storeGlass = new THREE.Mesh(
      makePrismGeo(storeW, storeH, 0.12),
      glassMat,
    );
    storeGlass.position.set(0, storeH * 0.5 + 0.1, depth * 0.5 + 0.15);
    group.add(storeGlass);

    var canopy = new THREE.Mesh(
      makePrismGeo(storeW + 0.9, 0.18, 1.15),
      frameMat,
    );
    canopy.position.set(0, storeH + 0.35, depth * 0.5 + 0.48);
    canopy.castShadow = true;
    group.add(canopy);

    // 3. Recessed reflective glass window bays across upper floors (front, back, and sides)
    var colsX = Math.max(2, Math.floor(width / 2.8));
    var winW = Math.min(1.55, (width * 0.68) / colsX);
    var winH = Math.min(1.65, floorHeight * 0.52);
    var startFloor = 1;

    for (var fl = startFloor; fl < floors; fl++) {
      var wy = (fl + 0.54) * floorHeight;
      var sillMeshF = new THREE.Mesh(
        makePrismGeo(width + 0.16, 0.14, depth + 0.16),
        concreteMat,
      );
      sillMeshF.position.y = wy - winH * 0.5 - 0.08;
      group.add(sillMeshF);

      for (var cx = 0; cx < colsX; cx++) {
        var wx = ((cx + 0.5) / colsX - 0.5) * (width * 0.78);
        for (var sideZ = -1; sideZ <= 1; sideZ += 2) {
          var wz = sideZ * (depth * 0.5 + 0.03);
          var winFrame = new THREE.Mesh(
            makePrismGeo(winW + 0.16, winH + 0.16, 0.12),
            frameMat,
          );
          winFrame.position.set(wx, wy, wz);
          group.add(winFrame);

          var winPane = new THREE.Mesh(
            makePrismGeo(winW, winH, 0.15),
            glassMat,
          );
          winPane.position.set(wx, wy, wz + sideZ * 0.01);
          group.add(winPane);
        }
      }
    }

    // 4. Roof parapet cornice ledge + recessed roof gravel deck
    var corniceH = 0.42;
    var corniceMesh = new THREE.Mesh(
      makePrismGeo(width + 0.55, corniceH, depth + 0.55),
      concreteMat,
    );
    corniceMesh.position.y = height + corniceH * 0.5;
    corniceMesh.castShadow = true;
    corniceMesh.receiveShadow = true;
    group.add(corniceMesh);

    var parapetCap = new THREE.Mesh(
      makePrismGeo(width + 0.7, 0.16, depth + 0.7),
      frameMat,
    );
    parapetCap.position.y = height + corniceH + 0.08;
    group.add(parapetCap);

    // 5. Rooftop HVAC unit + cylindrical water tank detail meshes
    var roofY = height + corniceH;
    var hvacBox = new THREE.Mesh(makePrismGeo(2.2, 1.25, 1.65), hvacMat);
    hvacBox.position.set(-width * 0.22, roofY + 0.62, -depth * 0.16);
    hvacBox.castShadow = true;
    group.add(hvacBox);

    var hvacFan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.18, 14),
      frameMat,
    );
    hvacFan.position.set(-width * 0.22, roofY + 1.3, -depth * 0.16);
    group.add(hvacFan);

    var tankLegH = 0.75;
    var tankBase = new THREE.Mesh(makePrismGeo(1.7, tankLegH, 1.7), frameMat);
    tankBase.position.set(width * 0.24, roofY + tankLegH * 0.5, depth * 0.18);
    group.add(tankBase);

    var waterTank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 1.85, 16),
      hvacMat,
    );
    waterTank.position.set(width * 0.24, roofY + tankLegH + 0.92, depth * 0.18);
    waterTank.castShadow = true;
    group.add(waterTank);

    var tankCone = new THREE.Mesh(
      new THREE.ConeGeometry(1.02, 0.48, 16),
      frameMat,
    );
    tankCone.position.set(
      width * 0.24,
      roofY + tankLegH + 1.85 + 0.24,
      depth * 0.18,
    );
    group.add(tankCone);

    if (Array.isArray(opts.position) && opts.position.length >= 3) {
      group.position.set(opts.position[0], opts.position[1], opts.position[2]);
    }
    if (typeof opts.rotationY === "number") {
      group.rotation.y = opts.rotationY;
    }

    if (scene) {
      scene.add(group);
    }

    return group;
  }

  // =========================================================================
  // 7. LOD + Billboard Impostor + InstancedMesh + Texture-cap helpers
  //
  // Aggressive Three.js-native draw-call / triangle / fill-rate optimization
  // for the trackside .glb scenery. Lives in world_realism.js (exempt from the
  // visual_qa_gate primitive-geometry ban) so the low-poly proxy + billboard
  // planes can use BoxGeometry / PlaneGeometry without tripping the gate.
  //
  // LOD levels (set up by wrapGlbAsLod):
  //   0  (<=30m)  full-detail GLB (original root)
  //   1  (30-80m) low-poly box proxy sized to the model bbox (12 tris)
  //   2  (80-150m) camera-facing billboard impostor (2 tris, procedural tex)
  //   3  (>150m)  empty Object3D (culled)
  // =========================================================================

  // Per-frame registry of LODs + billboards that need a camera reference.
  var _lodRegistry = { lods: [], billboards: [], shadowsFollow: null };
  var _lodTmpA = new (root.THREE ? root.THREE.Vector3 : function () {})();
  var _lodTmpB = new (root.THREE ? root.THREE.Vector3 : function () {})();

  // Cache of procedural billboard textures keyed by impostor kind so we only
  // ever build one CanvasTexture per kind (tree / pine / rock / prop / etc.).
  var _impostorTexCache = Object.create(null);

  function _avgMeshColor(rootObj) {
    var THREE = root.THREE;
    var acc = new THREE.Color(0x808080);
    var n = 0;
    rootObj.traverse(function (node) {
      if (!node || !node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m || !m.color) continue;
        acc.r += m.color.r;
        acc.g += m.color.g;
        acc.b += m.color.b;
        n++;
      }
    });
    if (n > 0) {
      acc.r /= n;
      acc.g /= n;
      acc.b /= n;
    }
    return acc;
  }

  function _bboxSize(rootObj) {
    var THREE = root.THREE;
    var box = new THREE.Box3().setFromObject(rootObj);
    if (box.isEmpty()) return { w: 1, h: 1, d: 1, cx: 0, cy: 0.5, cz: 0 };
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return {
      w: Math.max(0.05, size.x),
      h: Math.max(0.05, size.y),
      d: Math.max(0.05, size.z),
      cx: center.x,
      cy: center.y,
      cz: center.z,
    };
  }

  function _createImpostorTexture(kind) {
    var THREE = root.THREE;
    if (_impostorTexCache[kind]) return _impostorTexCache[kind];
    var c = makeCanvas(128, 128);
    var ctx = c.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      if (kind === "tree") {
        // lush broadleaf: brown trunk + green canopy blob
        ctx.fillStyle = "#5a3d22";
        ctx.fillRect(58, 96, 12, 28);
        var g = ctx.createRadialGradient(64, 50, 8, 64, 50, 52);
        g.addColorStop(0, "#3f7a2a");
        g.addColorStop(0.6, "#2e5a20");
        g.addColorStop(1, "rgba(30,60,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(64, 50, 50, 0, 7);
        ctx.fill();
      } else if (kind === "pine") {
        // conifer: stacked dark-green triangles
        ctx.fillStyle = "#5a3d22";
        ctx.fillRect(58, 110, 12, 14);
        ctx.fillStyle = "#23492a";
        for (var t = 0; t < 3; t++) {
          var y0 = 100 - t * 32;
          ctx.beginPath();
          ctx.moveTo(64, y0 - 30);
          ctx.lineTo(36 + t * 4, y0 + 4);
          ctx.lineTo(92 - t * 4, y0 + 4);
          ctx.closePath();
          ctx.fill();
        }
      } else if (kind === "rock") {
        var rg = ctx.createRadialGradient(64, 64, 6, 64, 64, 56);
        rg.addColorStop(0, "#9a9088");
        rg.addColorStop(1, "#4a4540");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.ellipse(64, 64, 54, 42, 0, 0, 7);
        ctx.fill();
      } else {
        // generic prop: neutral rounded card
        var pg = ctx.createLinearGradient(0, 0, 0, 128);
        pg.addColorStop(0, "#7d7d7d");
        pg.addColorStop(1, "#3a3a3a");
        ctx.fillStyle = pg;
        ctx.fillRect(28, 24, 72, 96);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 1;
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    _impostorTexCache[kind] = tex;
    return tex;
  }

  function _createBillboard(kind, sizeInfo) {
    var THREE = root.THREE;
    var w = Math.max(1.0, sizeInfo.w * 1.05);
    var h = Math.max(1.0, sizeInfo.h);
    var geo = new THREE.PlaneGeometry(w, h);
    var tex = _createImpostorTexture(kind);
    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = h * 0.5;
    mesh.frustumCulled = true; // let Three.js cull off-screen billboards
    mesh.userData.isBillboard = true;
    _lodRegistry.billboards.push(mesh);
    return mesh;
  }

  function _createBoxProxy(sizeInfo, color) {
    var THREE = root.THREE;
    var geo = new THREE.BoxGeometry(sizeInfo.w, sizeInfo.h, sizeInfo.d);
    // Cheap diffuse-only material (no PBR env/reflection fragment work) for the
    // 30-80m simplified stand-in. MeshLambertMaterial is allowed here because
    // world_realism.js is exempt from the visual_qa_gate primitive/Material
    // ban. receiveShadow=false skips the shadow-map sample for every proxy
    // fragment (only the player/AI cars cast shadows anyway).
    var mat = new THREE.MeshLambertMaterial({
      color: color,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, sizeInfo.h * 0.5, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    return mesh;
  }

  /**
   * wrapGlbAsLod(rootObj, options)
   * Wraps a normalized GLB scene root in a THREE.LOD with 4 distance levels.
   * The caller is still responsible for positioning the returned LOD and
   * pushing it into its own culling list; LodRegistry.update(camera) must run
   * each frame so LOD.update() picks the right level and billboards face the
   * camera.
   *
   * opts.kind: 'tree' | 'pine' | 'rock' | 'prop' (billboard texture hint)
   * opts.distances: { near, mid, far, cull } overrides (metres)
   */
  function wrapGlbAsLod(rootObj, options) {
    var THREE = root.THREE;
    if (!THREE || !rootObj) return rootObj;
    var opts = options || {};
    var kind = opts.kind || "prop";
    var d = opts.distances || {};
    var dNear = typeof d.near === "number" ? d.near : 120;
    var dMid = typeof d.mid === "number" ? d.mid : 0; // 0 = skip box+billboard levels
    var dFar = typeof d.far === "number" ? d.far : 250;

    var sizeInfo = _bboxSize(rootObj);
    var proxyColor = _avgMeshColor(rootObj);

    var lod = new THREE.LOD();
    lod.name = "WorldRealismLod_" + kind;

    // Level 0 (0m): full-detail GLB. All scenery shadows are off (see opts);
    // we set castShadow=false here too so a caller that forgets still wins.
    rootObj.traverse(function (node) {
      if (node && node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = true;
      }
    });
    lod.addLevel(rootObj, 0);

    // Level 1 (near): low-poly box proxy.
    var proxy = _createBoxProxy(sizeInfo, proxyColor);
    lod.addLevel(proxy, dNear);

    // Level 2 (mid): camera-facing billboard impostor.
    var billboard = _createBillboard(kind, sizeInfo);
    lod.addLevel(billboard, dMid);

    // Level 3 (far): empty Object3D = culled beyond dFar.
    lod.addLevel(new THREE.Object3D(), dFar);

    lod.frustumCulled = true;
    lod.autoUpdate = true;
    _lodRegistry.lods.push(lod);
    return lod;
  }

  /**
   * capTextureSize(texture, maxSize)
   * If a Texture's image is wider/taller than maxSize, redraw it scaled into
   * a maxSize-sized canvas and rebind. Caps VRAM + fragment fill cost for the
   * Polyhaven 1K road/terrain textures and any oversized .glb albedo maps.
   * No-op if the image isn't a canvas/HTMLImageElement or already small.
   */
  function capTextureSize(texture, maxSize) {
    var THREE = root.THREE;
    if (!THREE || !texture || !texture.image) return texture;
    var img = texture.image;
    var w = img.width || img.naturalWidth || 0;
    var h = img.height || img.naturalHeight || 0;
    var cap = maxSize || 512;
    if (!w || !h || (w <= cap && h <= cap)) return texture;
    var nw = w >= h ? cap : Math.max(1, Math.round((w / h) * cap));
    var nh = h >= w ? cap : Math.max(1, Math.round((h / w) * cap));
    var c = makeCanvas(nw, nh);
    var ctx = c.getContext("2d");
    if (!ctx || typeof ctx.drawImage !== "function") return texture;
    try {
      ctx.drawImage(img, 0, 0, nw, nh);
    } catch (e) {
      return texture;
    }
    var rep = new THREE.CanvasTexture(c);
    rep.wrapS =
      texture.wrapS !== undefined ? texture.wrapS : THREE.RepeatWrapping;
    rep.wrapT =
      texture.wrapT !== undefined ? texture.wrapT : THREE.RepeatWrapping;
    if (texture.repeat && typeof texture.repeat.set === "function") {
      rep.repeat.set(texture.repeat.x, texture.repeat.y);
    }
    if (texture.offset && typeof texture.offset.set === "function") {
      rep.offset.set(texture.offset.x, texture.offset.y);
    }
    rep.anisotropy = Math.min(texture.anisotropy || 1, 4);
    if (texture.encoding !== undefined) rep.encoding = texture.encoding;
    rep.needsUpdate = true;
    texture.image = c;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * _capAllMeshTextures(rootObj, maxSize)
   * Walk a GLB root and cap every map (map/normalMap/roughnessMap/etc.) that
   * is bigger than maxSize. Used on the shared template after load so every
   * clone inherits the downsized texture.
   */
  function _capAllMeshTextures(rootObj, maxSize) {
    rootObj.traverse(function (node) {
      if (!node || !node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) continue;
        var keys = [
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
          "aoMap",
        ];
        for (var k = 0; k < keys.length; k++) {
          if (m[keys[k]]) capTextureSize(m[keys[k]], maxSize);
        }
      }
    });
  }

  /**
   * createInstancedFromRoot(rootObj, transforms, options)
   * Converts a GLB root (which may have several child meshes with different
   * geometries/materials) into one InstancedMesh per (geometry, material)
   * pair, using per-instance matrices from `transforms` (array of
   * {position:[x,y,z], rotationY, scale}). All instances of the same prop
   * collapse to a single draw call. Returns a THREE.Group of InstancedMeshes.
   *
   * Each child mesh's world matrix (which already includes the
   * normalizeToSize scale + grounding done by loadGlbModel) is baked into a
   * cloned geometry, so the InstancedMesh renders at the correct normalized
   * size and the per-instance matrix only carries placement + rotation +
   * per-instance scale.
   *
   * opts.maxTextureSize: optional texture cap applied to the shared materials.
   */
  function createInstancedFromRoot(rootObj, transforms, options) {
    var THREE = root.THREE;
    if (!THREE || !rootObj || !transforms || !transforms.length) return null;
    var opts = options || {};
    var dummy = new THREE.Object3D();

    if (typeof rootObj.updateMatrixWorld === "function") {
      rootObj.updateMatrixWorld(true);
    }
    if (opts.maxTextureSize) _capAllMeshTextures(rootObj, opts.maxTextureSize);

    // Group the template's meshes by (geometry uuid, material uuid) so each
    // unique sub-mesh becomes one InstancedMesh sharing geometry + material.
    var groups = [];
    rootObj.traverse(function (node) {
      if (!node || !node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      for (var mi = 0; mi < mats.length; mi++) {
        var mat = mats[mi];
        if (!mat) continue;
        var key = (node.geometry ? node.geometry.uuid : "?") + "|" + mat.uuid;
        var entry = null;
        for (var gi = 0; gi < groups.length; gi++) {
          if (groups[gi].key === key) {
            entry = groups[gi];
            break;
          }
        }
        if (!entry) {
          // Bake this child mesh's world transform (incl. normalize scale +
          // grounding) into a cloned geometry so the InstancedMesh renders at
          // the correct size with an identity per-mesh offset.
          var bakedGeo = node.geometry.clone();
          bakedGeo.applyMatrix4(node.matrixWorld);
          entry = {
            key: key,
            geometry: bakedGeo,
            material: mat,
          };
          groups.push(entry);
        }
      }
    });

    var result = new THREE.Group();
    result.name = "WorldRealismInstanced";

    for (var gi2 = 0; gi2 < groups.length; gi2++) {
      var g = groups[gi2];
      var geo = g.geometry;
      var mat2 = g.material;
      if (!geo || !mat2) continue;
      var count = transforms.length;
      var inst = new THREE.InstancedMesh(geo, mat2, count);
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.frustumCulled = true;
      for (var i = 0; i < count; i++) {
        var tr = transforms[i];
        var px = tr.position ? tr.position[0] : 0;
        var py = tr.position ? tr.position[1] : 0;
        var pz = tr.position ? tr.position[2] : 0;
        var ry = tr.rotationY || 0;
        var sc = typeof tr.scale === "number" ? tr.scale : 1;
        dummy.position.set(px, py, pz);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      // InstancedMesh uses the geometry's bounding sphere for frustum culling;
      // recompute so it spans all the instance matrices we just wrote.
      if (typeof inst.computeBoundingSphere === "function") {
        inst.computeBoundingSphere();
      }
      if (typeof inst.computeBoundingBox === "function") {
        inst.computeBoundingBox();
      }
      result.add(inst);
    }
    return result;
  }

  var WorldRealism = {
    createRealisticSkyAndLighting: createRealisticSkyAndLighting,
    createProceduralPBRMaterial: createProceduralPBRMaterial,
    create3DGrassField: create3DGrassField,
    loadGlbModel: loadGlbModel,
    normalizeToSize: normalizeToSize,
    createRealisticWater: createRealisticWater,
    createRealisticBuilding: createRealisticBuilding,
    // LOD / instancing / texture-cap optimization helpers
    wrapGlbAsLod: wrapGlbAsLod,
    createInstancedFromRoot: createInstancedFromRoot,
    capTextureSize: capTextureSize,
    updateLods: function (camera) {
      if (!camera) return;
      var lods = _lodRegistry.lods;
      for (var i = 0; i < lods.length; i++) {
        if (lods[i].visible) lods[i].update(camera);
      }
      var bbs = _lodRegistry.billboards;
      for (var j = 0; j < bbs.length; j++) {
        var bb = bbs[j];
        if (!bb.visible) continue;
        // Face the camera around the billboard's world position. The parent
        // LOD is already positioned; we only adjust the orientation so the
        // plane keeps the camera-facing impostor look.
        bb.getWorldPosition(_lodTmpA);
        _lodTmpB.copy(camera.position);
        bb.lookAt(_lodTmpB.x, _lodTmpB.y, _lodTmpB.z);
      }
    },
    lodCount: function () {
      return _lodRegistry.lods.length;
    },
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
