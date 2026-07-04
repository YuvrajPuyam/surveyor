/**
 * Inspect a world bundle: collider stats, splat stats, coordinate-frame
 * agreement, and scale sanity. The Day-2 science tool.
 * Usage: npx tsx scripts/inspect-bundle.ts assets/marble/<worldId>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { aabbOfPositions } from "../src/core/geom.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: inspect-bundle <bundle-dir>");
  process.exit(1);
}

const world = await loadWorldBundle(dir);
const cA = aabbOfPositions(world.collider.positions);
const fmt = (v: { x: number; y: number; z: number }) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

console.log(`world: ${world.worldId}`);
console.log(`metadata: ${JSON.stringify(world.metadata)}`);
console.log(`\ncollider: ${world.collider.indices.length / 3} tris, ${world.collider.positions.length / 3} verts`);
console.log(`  aabb ${fmt(cA.min)} .. ${fmt(cA.max)}`);
console.log(`  extents x=${(cA.max.x - cA.min.x).toFixed(2)} y=${(cA.max.y - cA.min.y).toFixed(2)} z=${(cA.max.z - cA.min.z).toFixed(2)}`);

if (world.visualPoints.length > 0) {
  const vA = aabbOfPositions(world.visualPoints);
  console.log(`\nsplats: ${world.visualPoints.length / 3} centers`);
  console.log(`  aabb ${fmt(vA.min)} .. ${fmt(vA.max)}`);
  console.log(`  extents x=${(vA.max.x - vA.min.x).toFixed(2)} y=${(vA.max.y - vA.min.y).toFixed(2)} z=${(vA.max.z - vA.min.z).toFixed(2)}`);

  // frame agreement: center offset and per-axis extent ratios
  const cC = { x: (cA.min.x + cA.max.x) / 2, y: (cA.min.y + cA.max.y) / 2, z: (cA.min.z + cA.max.z) / 2 };
  const vC = { x: (vA.min.x + vA.max.x) / 2, y: (vA.min.y + vA.max.y) / 2, z: (vA.min.z + vA.max.z) / 2 };
  console.log(`\nframe check:`);
  console.log(`  center offset (collider - splats): ${fmt({ x: cC.x - vC.x, y: cC.y - vC.y, z: cC.z - vC.z })}`);
  const ratio = (a: number, b: number) => (b > 1e-6 ? (a / b).toFixed(2) : "inf");
  console.log(
    `  extent ratios collider/splats: x=${ratio(cA.max.x - cA.min.x, vA.max.x - vA.min.x)} y=${ratio(cA.max.y - cA.min.y, vA.max.y - vA.min.y)} z=${ratio(cA.max.z - cA.min.z, vA.max.z - vA.min.z)}`,
  );
  console.log(`  (a y<->z extent swap between the two suggests the -90 deg X rotation quirk)`);
}

// splat height histogram: where does the mass sit vertically? (floor detection sanity)
if (world.visualPoints.length > 0) {
  const ys: number[] = [];
  for (let i = 1; i < world.visualPoints.length; i += 3) ys.push(world.visualPoints[i]);
  ys.sort((a, b) => a - b);
  const q = (p: number) => ys[Math.floor(p * (ys.length - 1))].toFixed(2);
  console.log(`\nsplat y-quantiles: p05=${q(0.05)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p95=${q(0.95)}`);
}

try {
  const raw = JSON.parse(readFileSync(join(dir, "raw.json"), "utf-8"));
  const cap = raw?.assets?.caption;
  if (cap) console.log(`\ncaption: ${String(cap).slice(0, 160)}...`);
} catch {
  /* synthetic bundles have no raw.json */
}
