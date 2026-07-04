/**
 * Where does the VISUAL floor extend vs the COLLIDER floor?
 * Histogram of floor-band splat density and collider standable coverage per
 * x-slice, over a few z bands. Decides whether wide "lying" bands are real
 * collider under-coverage or misread fuzz.
 */
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { aabbOfPositions } from "../src/core/geom.js";
import { initRapier, PhysicsWorld } from "../src/physics/rapierWorld.js";

const world = await loadWorldBundle(process.argv[2]);
await initRapier();
const pw = new PhysicsWorld(9.81);
pw.addStaticTriMesh(world.collider);
pw.step();
const aabb = aabbOfPositions(world.collider.positions);

const FLOOR_Y = -0.53; // from the fitted plane
const zBands: [number, number][] = [
  [1, 3],
  [5, 7],
  [9, 11],
];

for (const [z0, z1] of zBands) {
  console.log(`\n=== z in [${z0}, ${z1}] ===`);
  console.log("x-slice | floor-band splats | collider floor hit?");
  for (let x = -2.0; x <= 2.01; x += 0.25) {
    let band = 0;
    for (let i = 0; i < world.visualPoints.length; i += 3) {
      const px = world.visualPoints[i], py = world.visualPoints[i + 1], pz = world.visualPoints[i + 2];
      if (pz < z0 || pz > z1) continue;
      if (px < x || px >= x + 0.25) continue;
      if (Math.abs(py - FLOOR_Y) < 0.25) band++;
    }
    // collider: does a down-ray at slice center, mid-band hit near floor height?
    let colliderFloor = 0;
    for (const zz of [z0 + 0.3, (z0 + z1) / 2, z1 - 0.3]) {
      const profile = pw.castDownProfile(x + 0.125, aabb.max.y + 0.5, zz, aabb.max.y - aabb.min.y + 1);
      if (profile.some((h) => Math.abs(h.y - FLOOR_Y) < 0.25)) colliderFloor++;
    }
    const bar = "#".repeat(Math.min(40, Math.round(band / 25)));
    console.log(
      `${x.toFixed(2).padStart(6)} | ${String(band).padStart(5)} ${bar.padEnd(40)} | ${colliderFloor}/3`,
    );
  }
}
pw.free();
