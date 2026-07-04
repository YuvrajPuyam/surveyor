/**
 * Empirical collider-behavior experiment (Day-2 science, keeper):
 * 1. Does a ball dropped INSIDE the world rest on the floor?
 * 2. Does a ball dropped ABOVE the roof pass through it (one-sided shell)?
 * 3. Hit-count parity per column: closed solid (even) vs open shell (odd/1)?
 * Usage: npx tsx scripts/probe-experiment.ts <bundle-dir>
 */
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { aabbOfPositions } from "../src/core/geom.js";
import { initRapier, PhysicsWorld } from "../src/physics/rapierWorld.js";

const dir = process.argv[2];
const world = await loadWorldBundle(dir);
await initRapier();
const pw = new PhysicsWorld(9.81);
pw.addStaticTriMesh(world.collider);
pw.step();

const aabb = aabbOfPositions(world.collider.positions);
console.log(`aabb y: ${aabb.min.y.toFixed(2)} .. ${aabb.max.y.toFixed(2)}`);

// sample a few interior columns near the world's XZ center line
const cx = (aabb.min.x + aabb.max.x) / 2;
const cz = (aabb.min.z + aabb.max.z) / 2;
const samples: [number, number][] = [
  [cx, cz],
  [cx, cz + 2],
  [cx, cz - 2],
  [cx + 0.8, cz],
  [cx - 0.8, cz + 4],
];

console.log("\n--- ray profiles (hit count parity) ---");
for (const [x, z] of samples) {
  const profile = pw.castDownProfile(x, aabb.max.y + 0.5, z, aabb.max.y - aabb.min.y + 1);
  console.log(
    `(${x.toFixed(1)}, ${z.toFixed(1)}): ${profile.length} hits at [${profile.map((h) => h.y.toFixed(2)).join(", ")}]`,
  );
}

console.log("\n--- ball drops ---");
function dropBall(x: number, y: number, z: number, label: string) {
  const body = pw.spawnProbe({ x, y, z }, 0.05);
  for (let i = 0; i < 600; i++) pw.step();
  const p = body.translation();
  const rested = p.y > aabb.min.y - 0.4;
  console.log(`${label}: dropped (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}) -> y=${p.y.toFixed(2)} ${rested ? "RESTED" : "FELL THROUGH"}`);
}

for (const [x, z] of samples) {
  // inside: 1 m above the lowest surface in this column
  const profile = pw.castDownProfile(x, aabb.max.y + 0.5, z, aabb.max.y - aabb.min.y + 1);
  const lowest = profile.length ? Math.min(...profile.map((h) => h.y)) : aabb.min.y;
  dropBall(x, lowest + 1.0, z, "inside ");
}
dropBall(cx, aabb.max.y + 1.0, cz, "above roof");

pw.free();
