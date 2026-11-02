#!/usr/bin/env node
/**
 * glTF / GLB Mesh & Scene Optimizer CLI (`@gltf-transform/core` + `@gltf-transform/functions`)
 *
 * Runs deduplication (`dedup`), unused resource pruning (`prune`), vertex welding (`weld`),
 * and pivot centering (`center`) on any `.glb` asset.
 *
 * Usage:
 *   node src/tools/gltf_optimize.js --in storage/cache/pro_builder/bazaar_stall.glb --out storage/cache/pro_builder/bazaar_stall_opt.glb
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { dedup, prune, weld, center } from "@gltf-transform/functions";

function parseArgs(argv) {
  const args = { in: "", out: "", centerPivot: "below" };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) {
      args.in = argv[++i];
    } else if (a === "--out" && argv[i + 1]) {
      args.out = argv[++i];
    } else if (a === "--center" && argv[i + 1]) {
      args.centerPivot = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.in) {
    console.error(
      "Usage: node src/tools/gltf_optimize.js --in <input.glb> [--out <output.glb>]",
    );
    process.exit(1);
  }
  const inPath = path.resolve(args.in);
  const outPath = path.resolve(args.out || args.in);

  if (!fs.existsSync(inPath)) {
    console.error(`Input GLB not found: ${inPath}`);
    process.exit(1);
  }

  const beforeBytes = fs.statSync(inPath).size;
  const io = new NodeIO();
  const document = await io.read(inPath);

  const root = document.getRoot();
  const meshesBefore = root.listMeshes().length;
  const accessorsBefore = root.listAccessors().length;

  await document.transform(
    dedup(),
    weld(),
    prune(),
    center({ pivot: args.centerPivot }),
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, document);

  const afterBytes = fs.statSync(outPath).size;
  const meshesAfter = root.listMeshes().length;
  const accessorsAfter = root.listAccessors().length;

  const summary = {
    ok: true,
    tool: "@gltf-transform/core + @gltf-transform/functions (dedup, weld, prune, center)",
    in: args.in,
    out: args.out || args.in,
    before_bytes: beforeBytes,
    after_bytes: afterBytes,
    delta_bytes: afterBytes - beforeBytes,
    meshes: { before: meshesBefore, after: meshesAfter },
    accessors: { before: accessorsBefore, after: accessorsAfter },
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("gltf_optimize error:", err);
  process.exit(1);
});
