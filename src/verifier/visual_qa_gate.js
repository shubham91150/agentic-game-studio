#!/usr/bin/env node
/**
 * Visual QA Gate — Hard Static + Structural Verifier for 3D WebGL Games
 *
 * Runnable via:
 *   node src/verifier/visual_qa_gate.js [dir]
 *
 * Scans HTML + JS files in `<dir>` (default: `public/live-preview`) and FAILS if:
 * 1. Any inline `<script>` without `src=` or inline event handlers (`onclick=`) exist (CSP check).
 * 2. `GLTFLoader` / `.glb` (or `WorldRealism.loadGlbModel`) is NOT loaded anywhere (no real 3D models used).
 * 3. Primitive geometries (`BoxGeometry`, `ConeGeometry`, `CylinderGeometry`, `SphereGeometry`)
 *    are used to fake cars, trees, buildings, or characters (checks occurrence count, bans
 *    `function box(` wrappers, bans `MeshLambertMaterial`, and bans procedural tree/car assembly).
 * 4. Grass is a flat `PlaneGeometry` without `InstancedMesh` 3D blades (`create3DGrassField`
 *    or `InstancedMesh` tapered blade `BufferGeometry` required when grass is present).
 * 5. `ACESFilmicToneMapping` is missing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class VisualQualityGate {
  constructor(options = {}) {
    this.maxAllowedPrimitives = options.maxAllowedPrimitives ?? 3;
  }

  collectFiles(targetDir) {
    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`Target directory does not exist: ${absDir}`);
    }

    const htmlFiles = [];
    const jsFiles = [];

    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith("."))
            continue;
          walk(full);
        } else if (entry.isFile()) {
          if (entry.name.endsWith(".html") || entry.name.endsWith(".htm")) {
            htmlFiles.push({
              path: full,
              rel: path.relative(absDir, full),
              content: fs.readFileSync(full, "utf8"),
            });
          } else if (
            entry.name.endsWith(".js") ||
            entry.name.endsWith(".mjs")
          ) {
            jsFiles.push({
              path: full,
              rel: path.relative(absDir, full),
              content: fs.readFileSync(full, "utf8"),
            });
          }
        }
      }
    };

    walk(absDir);
    return { absDir, htmlFiles, jsFiles };
  }

  stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  /**
   * Check 1: CSP — zero inline <script> without src= and zero inline onclick=
   */
  verifyNoInlineScripts(htmlFiles) {
    const violations = [];
    for (const file of htmlFiles) {
      const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(file.content)) !== null) {
        const attrs = match[1] || "";
        const body = (match[2] || "").trim();
        const hasSrc = /\bsrc\s*=\s*["'][^"']+["']/i.test(attrs);
        if (!hasSrc) {
          violations.push(
            `${file.rel}: inline <script> tag without src= attribute (${body.slice(0, 48).replace(/\s+/g, " ")}...)`,
          );
        }
      }

      const inlineHandlerRegex =
        /\bon(click|load|error|keydown|keyup|mousedown|touchstart)\s*=/gi;
      let handlerMatch;
      while ((handlerMatch = inlineHandlerRegex.exec(file.content)) !== null) {
        violations.push(
          `${file.rel}: inline event attribute '${handlerMatch[0]}' violates CSP`,
        );
      }
    }

    const passed = violations.length === 0 && htmlFiles.length > 0;
    return {
      testName: "CSP Strict External Scripts (No Inline <script>)",
      passed,
      violations,
      proof: passed
        ? `Scanned ${htmlFiles.length} HTML file(s); all <script> tags use external src=.`
        : htmlFiles.length === 0
          ? "No HTML files found in target directory."
          : `Found ${violations.length} CSP violation(s): ${violations.join("; ")}`,
    };
  }

  /**
   * Check 2: Real 3D .glb Models via GLTFLoader / WorldRealism.loadGlbModel
   */
  verifyGlbModelsLoaded(htmlFiles, jsFiles) {
    const allSources = [
      ...htmlFiles.map((f) => f.content),
      ...jsFiles.map((f) => this.stripComments(f.content)),
    ].join("\n");

    const hasGLTFLoaderRef =
      /\bGLTFLoader\b/.test(allSources) || /\bloadGlbModel\b/.test(allSources);
    const glbMatches = allSources.match(/['"`][^'"`]*\.glb['"`]/gi) || [];
    const zeroDownloadClaim = jsFiles.some((f) =>
      /zero\s+downloads|100%\s+procedural\s+geometry|no\s+external\s+assets/i.test(
        f.content,
      ),
    );

    const issues = [];
    if (!hasGLTFLoaderRef) {
      issues.push(
        "Neither THREE.GLTFLoader nor WorldRealism.loadGlbModel is used anywhere",
      );
    }
    if (glbMatches.length === 0) {
      issues.push("No .glb 3D model URLs referenced in code");
    }
    if (zeroDownloadClaim) {
      issues.push(
        "Code comments still claim '100% procedural geometry / zero downloads' instead of loading real .glb models",
      );
    }

    const passed = issues.length === 0;
    return {
      testName: "Real 3D Models (.glb + GLTFLoader) Required",
      passed,
      glbCount: glbMatches.length,
      issues,
      proof: passed
        ? `GLTFLoader active with ${glbMatches.length} .glb asset reference(s).`
        : `Missing real 3D models: ${issues.join("; ")}.`,
    };
  }

  /**
   * Check 3: Ban Primitive Fakes (Box/Cone/Cylinder/Sphere cars, trees, buildings, characters,
   * `function box(`, and `MeshLambertMaterial`)
   */
  verifyNoPrimitiveFakes(jsFiles) {
    const issues = [];
    let totalPrimitives = 0;
    const primitiveBreakdown = {
      BoxGeometry: 0,
      ConeGeometry: 0,
      CylinderGeometry: 0,
      SphereGeometry: 0,
    };

    for (const file of jsFiles) {
      if (
        file.rel.endsWith("world_realism.js") ||
        file.rel.endsWith("GLTFLoader.js")
      ) {
        continue;
      }
      const clean = this.stripComments(file.content);

      for (const prim of Object.keys(primitiveBreakdown)) {
        const regex = new RegExp(`\\b(?:new\\s+THREE\\.)?${prim}\\b`, "g");
        const matches = clean.match(regex) || [];
        primitiveBreakdown[prim] += matches.length;
        totalPrimitives += matches.length;
      }

      if (/function\s+box\s*\(/.test(clean)) {
        issues.push(
          `${file.rel}: banned 'function box(' helper wrapper used to assemble box primitives`,
        );
      }

      if (/\bMeshLambertMaterial\b/.test(clean)) {
        issues.push(
          `${file.rel}: banned 'MeshLambertMaterial' found (use PBR MeshStandardMaterial or WorldRealism.createProceduralPBRMaterial)`,
        );
      }

      if (
        /\b(?:pineM|trunkM|leafM)\s*=\s*new\s+THREE\.InstancedMesh\s*\(\s*new\s+THREE\.(?:ConeGeometry|CylinderGeometry|SphereGeometry)/.test(
          clean,
        )
      ) {
        issues.push(
          `${file.rel}: procedural Cone/Cylinder/Sphere trees detected (must use real .glb tree models)`,
        );
      }

      if (
        /\bcreateCarMesh\b/.test(clean) &&
        (/\bBoxGeometry\b/.test(clean) ||
          /\bCylinderGeometry\b/.test(clean) ||
          /\bmodelGeo\b/.test(clean))
      ) {
        issues.push(
          `${file.rel}: procedural/box car mesh assembly detected in createCarMesh (must load real .glb vehicle models)`,
        );
      }
    }

    if (totalPrimitives > this.maxAllowedPrimitives) {
      issues.push(
        `Excessive primitive geometries (${totalPrimitives} total > max ${this.maxAllowedPrimitives}: ` +
          `Box=${primitiveBreakdown.BoxGeometry}, Cone=${primitiveBreakdown.ConeGeometry}, ` +
          `Cylinder=${primitiveBreakdown.CylinderGeometry}, Sphere=${primitiveBreakdown.SphereGeometry})`,
      );
    }

    const passed = issues.length === 0;
    return {
      testName: "Ban Primitive Geometry Fakes (Cars/Trees/Buildings/Lambert)",
      passed,
      totalPrimitives,
      primitiveBreakdown,
      issues,
      proof: passed
        ? `Zero banned primitive fakes or MeshLambertMaterial (${totalPrimitives} primitive(s) within budget <= ${this.maxAllowedPrimitives}).`
        : `Primitive fake violations: ${issues.join(" | ")}`,
    };
  }

  /**
   * Check 4: 3D Tapered Shader Grass Blades (never a flat PlaneGeometry grass without 3D InstancedMesh blades)
   */
  verify3DGrassBlades(jsFiles) {
    const cleanFiles = jsFiles
      .filter(
        (f) =>
          !f.rel.endsWith("world_realism.js") &&
          !f.rel.endsWith("GLTFLoader.js"),
      )
      .map((f) => ({ rel: f.rel, clean: this.stripComments(f.content) }));

    const combined = cleanFiles.map((f) => f.clean).join("\n");

    const mentionsGrass = /\bgrass\b|\bgrassMat\b|\bgrassTex\b/i.test(combined);
    const hasFlatPlaneGrass =
      /var\s+grass\s*=\s*new\s+THREE\.Mesh\s*\(\s*new\s+THREE\.PlaneGeometry/i.test(
        combined,
      ) ||
      /new\s+THREE\.Mesh\s*\(\s*new\s+THREE\.PlaneGeometry[^)]*\)\s*,\s*grassMat\s*\)/i.test(
        combined,
      );
    const has3DGrassHelper = /\bcreate3DGrassField\b/.test(combined);
    const hasCustomInstancedGrass =
      /\bInstancedMesh\b/.test(combined) &&
      /\bonBeforeCompile\b/.test(combined) &&
      /\buTime\b/.test(combined);

    const issues = [];
    if (hasFlatPlaneGrass && !has3DGrassHelper && !hasCustomInstancedGrass) {
      issues.push(
        "Grass is rendered as a flat PlaneGeometry without 3D InstancedMesh shader blades (use WorldRealism.create3DGrassField)",
      );
    } else if (mentionsGrass && !has3DGrassHelper && !hasCustomInstancedGrass) {
      issues.push(
        "Grass material/texture detected without 3D InstancedMesh grass blades (use WorldRealism.create3DGrassField)",
      );
    }

    const passed = issues.length === 0;
    return {
      testName: "3D Instanced Wind-Sway Grass Blades (No Flat Box/Plane Grass)",
      passed,
      issues,
      proof: passed
        ? has3DGrassHelper || hasCustomInstancedGrass
          ? "3D InstancedMesh wind-sway grass blades verified."
          : "No flat PlaneGeometry grass violations found."
        : `Grass realism failure: ${issues.join("; ")}`,
    };
  }

  /**
   * Check 5: ACESFilmicToneMapping present
   */
  verifyToneMapping(jsFiles) {
    const combined = jsFiles
      .map((f) => this.stripComments(f.content))
      .join("\n");
    const hasACES =
      /\bACESFilmicToneMapping\b/.test(combined) ||
      /\bcreateRealisticSkyAndLighting\b/.test(combined);

    return {
      testName: "ACESFilmicToneMapping Enabled",
      passed: hasACES,
      proof: hasACES
        ? "ACESFilmicToneMapping (or WorldRealism.createRealisticSkyAndLighting) is configured."
        : "Missing THREE.ACESFilmicToneMapping on WebGLRenderer.",
    };
  }

  runGate(targetDir = "public/live-preview") {
    const { absDir, htmlFiles, jsFiles } = this.collectFiles(targetDir);
    const checks = [
      this.verifyNoInlineScripts(htmlFiles),
      this.verifyGlbModelsLoaded(htmlFiles, jsFiles),
      this.verifyNoPrimitiveFakes(jsFiles),
      this.verify3DGrassBlades(jsFiles),
      this.verifyToneMapping(jsFiles),
    ];

    const passedCount = checks.filter((c) => c.passed).length;
    const gatePassed = passedCount === checks.length;

    return {
      gatePassed,
      targetDir: absDir,
      timestamp: new Date().toISOString(),
      score: Math.round((passedCount / checks.length) * 100),
      checks,
    };
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const targetDir = process.argv[2] || "public/live-preview";
  const gate = new VisualQualityGate();
  try {
    const report = gate.runGate(targetDir);
    console.log("==========================================================");
    console.log(`VISUAL QA GATE REPORT — ${report.targetDir}`);
    console.log(
      `Status: ${report.gatePassed ? "PASS" : "FAIL"} (Score: ${report.score}%)`,
    );
    console.log("==========================================================");
    for (const check of report.checks) {
      const badge = check.passed ? "[PASS]" : "[FAIL]";
      console.log(`${badge} ${check.testName}`);
      console.log(`       ${check.proof}`);
    }
    console.log("==========================================================");
    if (!report.gatePassed) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`[FAIL] Visual QA Gate error: ${err.message}`);
    process.exit(1);
  }
}
