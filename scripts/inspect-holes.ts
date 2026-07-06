/**
 * Inspect collider_hole regions of a certificate against the bundle's actual
 * geometry: is each "raycast void inside the floor footprint" an interior
 * hole (void enclosed by collider), or an open-edge sliver where the void
 * simply continues out of the world (a capture/collider boundary, not a
 * defect)? Prints one line per hole with the discriminating numbers.
 *
 * Usage: npx tsx scripts/inspect-holes.ts <bundle-dir> <certificate.json>
 */
import { readFileSync } from "node:fs";
import { initRapier, PhysicsWorld } from "../src/physics/rapierWorld.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { aabbOfPositions } from "../src/core/geom.js";
import { PointHash } from "../src/core/pointhash.js";
import type { Certificate } from "../src/core/types.js";

const [dir, certPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dir || !certPath) {
  console.error("usage: npx tsx scripts/inspect-holes.ts <bundle-dir> <certificate.json>");
  process.exit(1);
}

const cert = JSON.parse(readFileSync(certPath, "utf8")) as Certificate;
const world = await loadWorldBundle(dir);
await initRapier();
const pw = new PhysicsWorld(9.81);
pw.addStaticTriMesh(world.collider);
pw.step();
const aabb = aabbOfPositions(world.collider.positions);
const topY = aabb.max.y + 1.0;
const maxDist = aabb.max.y - aabb.min.y + 2.0;
const splats = new PointHash(world.visualPoints, 0.25);

const holes = cert.defects.filter((d) => d.type === "collider_hole");
console.log(`${holes.length} collider_hole defect(s) — probing each region:\n`);
console.log(
  "id                 size(m)      area   inHit%  splat%  ringVoid: -x   +x   -z   +z   edge?",
);

let interior = 0;
let edgeSliver = 0;
for (const d of holes) {
  const [minX, , minZ] = d.region.min;
  const [maxX, , maxZ] = d.region.max;
  const w = maxX - minX;
  const dz = maxZ - minZ;
  const N = 6;
  let inHit = 0;
  let inSplat = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = minX + ((i + 0.5) / N) * w;
      const z = minZ + ((j + 0.5) / N) * dz;
      if (pw.castDown(x, topY, z, maxDist)) inHit++;
      const y = pw.castDown(x, topY, z, maxDist)?.y ?? (aabb.min.y + aabb.max.y) / 2;
      if (splats.nearestDist2(x, y, z, 0.5) <= 0.25) inSplat++;
    }
  }
  // ring probes 0.4 m outside each side: does the void CONTINUE outward?
  const RING = 0.4;
  const K = 8;
  const sideVoid = (side: "-x" | "+x" | "-z" | "+z"): number => {
    let voids = 0;
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K;
      const x = side === "-x" ? minX - RING : side === "+x" ? maxX + RING : minX + t * w;
      const z = side === "-z" ? minZ - RING : side === "+z" ? maxZ + RING : minZ + t * dz;
      if (!pw.castDown(x, topY, z, maxDist)) voids++;
    }
    return voids / K;
  };
  const rv = { mx: sideVoid("-x"), px: sideVoid("+x"), mz: sideVoid("-z"), pz: sideVoid("+z") };
  const openSides = [rv.mx, rv.px, rv.mz, rv.pz].filter((f) => f >= 0.5).length;
  const isEdge = openSides >= 1;
  if (isEdge) edgeSliver++;
  else interior++;
  console.log(
    `${d.id.padEnd(18)} ${w.toFixed(1).padStart(4)}x${dz.toFixed(1).padEnd(6)} ${(w * dz).toFixed(1).padStart(6)}  ` +
      `${((100 * inHit) / (N * N)).toFixed(0).padStart(5)}%  ${((100 * inSplat) / (N * N)).toFixed(0).padStart(5)}%  ` +
      `        ${rv.mx.toFixed(1)}  ${rv.px.toFixed(1)}  ${rv.mz.toFixed(1)}  ${rv.pz.toFixed(1)}   ${isEdge ? "EDGE" : "interior"}`,
  );
}
console.log(
  `\n${interior} interior (void enclosed by collider on all sides) | ${edgeSliver} open-edge (void continues outward on >=1 side)`,
);
pw.free();
