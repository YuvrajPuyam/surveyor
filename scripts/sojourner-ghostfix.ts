/**
 * FIX 2 driver — build colliders for every ghost-geometry defect (visible
 * matter with no physics) from the splat evidence inside its footprint.
 *
 *   npx tsx scripts/sojourner-ghostfix.ts <bundle-dir> [--out <collider.glb>]
 *
 * Default output: <bundle>/collider.glb IN PLACE with the original backed up
 * to collider.pre-ghostfix.glb (the bundle is itself a derived artifact).
 * --out writes elsewhere and touches nothing. Receipt: ghostfix-receipt.json.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeTriMeshes, type TriMesh } from "../src/core/geom.js";
import { CertificateSchema } from "../src/core/types.js";
import { loadColliderGlb, saveTriMeshGlb } from "../src/ingest/glb.js";
import { buildColliderFromSplats } from "../src/repair/splatCollider.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: npx tsx scripts/sojourner-ghostfix.ts <bundle-dir> [--out <path>]"); process.exit(2); }
const oi = process.argv.indexOf("--out");
const outPath = oi > -1 ? process.argv[oi + 1] : join(dir, "collider.glb");

const collider = await loadColliderGlb(join(dir, "collider.glb"));
const raw = readFileSync(join(dir, "visual-points.f32"));
const points = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const cert = CertificateSchema.parse(JSON.parse(readFileSync(join(dir, "certificate.json"), "utf-8")));
const ghosts = cert.defects.filter((d) => d.type === "visual_only_surface" && (!d.outcome || d.outcome === "escalated"));
console.log(`${ghosts.length} open ghost-geometry defects in the certificate`);

// local ground raster from the collider (0.5 m columns, max surface height)
const CELL = 0.5;
let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
for (let i = 0; i < collider.positions.length; i += 3) {
  const x = collider.positions[i], z = collider.positions[i + 2];
  if (x < mnx) mnx = x; if (z < mnz) mnz = z;
  if (x > mxx) mxx = x; if (z > mxz) mxz = z;
}
const gnx = Math.ceil((mxx - mnx) / CELL), gnz = Math.ceil((mxz - mnz) / CELL);
const groundTop = new Float32Array(gnx * gnz).fill(NaN);
const idx = collider.indices, pos = collider.positions;
let rng = 9241;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const markG = (x: number, y: number, z: number) => {
  const cx = Math.floor((x - mnx) / CELL), cz = Math.floor((z - mnz) / CELL);
  if (cx < 0 || cx >= gnx || cz < 0 || cz >= gnz) return;
  const ci = cx * gnz + cz;
  if (Number.isNaN(groundTop[ci]) || y > groundTop[ci]) groundTop[ci] = y;
};
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  markG(pos[a], pos[a + 1], pos[a + 2]);
  markG(pos[b], pos[b + 1], pos[b + 2]);
  markG(pos[c], pos[c + 1], pos[c + 2]);
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  const extra = Math.min(32, Math.ceil(area * 4));
  for (let s = 0; s < extra; s++) {
    let r1 = rand(), r2 = rand();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    markG(pos[a] + r1 * ux + r2 * vx, pos[a + 1] + r1 * uy + r2 * vy, pos[a + 2] + r1 * uz + r2 * vz);
  }
}
const groundYAt = (x: number, z: number): number | undefined => {
  const cx = Math.floor((x - mnx) / CELL), cz = Math.floor((z - mnz) / CELL);
  // nearest defined column within a 1-cell ring (torn shells have pinholes)
  for (let ring = 0; ring <= 1; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        const gx = cx + dx, gz = cz + dz;
        if (gx < 0 || gx >= gnx || gz < 0 || gz >= gnz) continue;
        const v = groundTop[gx * gnz + gz];
        if (!Number.isNaN(v)) return v;
      }
    }
  }
  return undefined;
};

// build a patch per ghost footprint
const patches: TriMesh[] = [];
const receipt: { id: string; cells: number; pts: number; tris: number }[] = [];
let skipped = 0;
for (const g of ghosts) {
  const [x0, , z0] = g.region.min, [x1, , z1] = g.region.max;
  const pad = 0.3;
  const res = buildColliderFromSplats(points, { minX: x0 - pad, maxX: x1 + pad, minZ: z0 - pad, maxZ: z1 + pad }, groundYAt);
  if (!res) { skipped++; continue; }
  patches.push(res.mesh);
  receipt.push({ id: g.id, cells: res.cellsBuilt, pts: res.pointsUsed, tris: res.mesh.indices.length / 3 });
}
if (patches.length === 0) {
  console.log("nothing to build (no ghost produced a patch)");
  process.exit(0);
}
const before = collider.indices.length / 3;
const mergedMesh = mergeTriMeshes([collider, ...patches]);
if (outPath === join(dir, "collider.glb") && !existsSync(join(dir, "collider.pre-ghostfix.glb"))) {
  copyFileSync(join(dir, "collider.glb"), join(dir, "collider.pre-ghostfix.glb"));
  console.log("original backed up to collider.pre-ghostfix.glb");
}
await saveTriMeshGlb(outPath, mergedMesh, "collider-ghostfixed");
writeFileSync(
  join(dir, "ghostfix-receipt.json"),
  JSON.stringify({ ghostsOpen: ghosts.length, patched: patches.length, skippedNoEvidence: skipped, trianglesBefore: before, trianglesAfter: mergedMesh.indices.length / 3, perGhost: receipt }, null, 2),
);
const added = mergedMesh.indices.length / 3 - before;
console.log(`${patches.length}/${ghosts.length} ghosts solidified (+${added} triangles, ${skipped} skipped for thin evidence)`);
console.log(`collider → ${outPath}`);
console.log("GHOSTFIX-DONE");
