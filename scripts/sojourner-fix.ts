/**
 * SOJOURNER FIX RUN — the three existing-tool repairs, executed end to end
 * on the Fouriesburg world, with a full before/after certification receipt.
 *
 *   FIX 1  CARVE the invisible rampart (E11): delete collider triangles
 *          whose centroids fall in the evidence-convicted box — same
 *          primitive as the engine's carve_opening, aimed by the
 *          density-gated audit.
 *   FIX 3  DELETE floaters from the visual layer (extended-repair).
 *   FIX 4  PATCH collider holes with slabs fitted to the LOCAL floor
 *          (median nearby surveyed surface), not the global plane —
 *          the single-level caveat, fixed the right way.
 *   (FIX 2, build_collider_from_splats for ghost rocks, is the pending
 *    new tool and is intentionally not in this run.)
 *
 * Writes <bundle>-fixed/ + fix-receipt.json. Source untouched.
 *
 *   npx tsx scripts/sojourner-fix.ts <bundle-dir>
 */
import { writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { certifyWorld } from "../src/certify/certificate.js";
import { removeFloaters } from "../src/certify/extended.js";
import { boxTriMesh, mergeTriMeshes, type TriMesh } from "../src/core/geom.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { saveTriMeshGlb } from "../src/ingest/glb.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: npx tsx scripts/sojourner-fix.ts <bundle-dir>"); process.exit(2); }

// E11's evidence-convicted rampart box (corrected frame): dense splats say
// flat ground ~+1 m; collider holds a ~+4 m wall. Carve only ABOVE the
// ground band so the real floor beneath survives.
// WORLD-SPECIFIC: these coordinates were measured on the Fouriesburg world —
// carving them on any other world would delete arbitrary triangles, so the
// carve step only runs when the worldId matches (patch + defloat are generic).
const CARVE_WORLD = "7f8eb141-3486-4b39-a546-eb98c47ba351";
const CARVE = { x0: 12.0, x1: 25.5, y0: 1.6, y1: 6.5, z0: -2.0, z1: 4.5 };

const world = await loadWorldBundle(dir);
const opts = { seed: 1234, survey: { probeCount: 2000 }, extended: true } as const;

console.log("[1/5] BEFORE survey (2000 probes)…");
let t0 = Date.now();
const before = await certifyWorld(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, visualScales: world.visualScales, metadata: world.metadata },
  opts,
);
console.log(`      grade ${before.certificate.grade} · ${before.certificate.defects.length} defects · floaters ${before.certificate.extendedChecks!.floaters.count} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

// ---------- FIX 1: carve the rampart (centroid rule, same as carve_opening)
console.log("[2/5] FIX 1 — carving the rampart…");
const { positions, indices } = world.collider;
let carved = 0;
let collider: TriMesh = world.collider;
if (world.worldId === CARVE_WORLD) {
  const keep: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const cx = (positions[i0] + positions[i1] + positions[i2]) / 3;
    const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
    const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
    const inside = cx >= CARVE.x0 && cx <= CARVE.x1 && cy >= CARVE.y0 && cy <= CARVE.y1 && cz >= CARVE.z0 && cz <= CARVE.z1;
    if (inside) carved++;
    else keep.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  collider = { positions, indices: new Uint32Array(keep) };
  console.log(`      ${carved} wall triangles removed (ground band below ${CARVE.y0} m preserved)`);
} else {
  console.log(`      SKIPPED: carve box was measured on world ${CARVE_WORLD.slice(0, 8)} — this is ${world.worldId.slice(0, 8)}; carving foreign coordinates would delete arbitrary geometry`);
}

// ---------- FIX 4: patch holes at the LOCAL floor
console.log("[3/5] FIX 4 — patching collider holes at the local floor…");
const rayGrid = before.survey.rayGrid;
const surfaceY = rayGrid.channel("surfaceY");
const standable = rayGrid.channel("standable");
const holes = before.certificate.defects.filter((d) => d.type === "collider_hole");
const patches: { id: string; topY: number; local: boolean }[] = [];
for (const h of holes) {
  const [x0, , z0] = h.region.min, [x1, , z1] = h.region.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // local floor: median surveyed standable surface within 6 m of the hole rim
  const heights: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (!standable[i]) continue;
    const [x, z] = rayGrid.center(i);
    const dx = Math.max(0, Math.max(x0 - x, x - x1)), dz = Math.max(0, Math.max(z0 - z, z - z1));
    if (dx * dx + dz * dz <= 36) heights.push(surfaceY[i]);
  }
  heights.sort((a, b) => a - b);
  const local = heights.length >= 8;
  const floorY = local ? heights[Math.floor(heights.length / 2)] : before.metrology.floorPlane.y;
  const topY = floorY + 0.1;
  const slab = boxTriMesh(
    { x: cx, y: topY - 0.06, z: cz },
    { x: x1 - x0 + 0.4, y: 0.12, z: z1 - z0 + 0.4 },
  );
  collider = mergeTriMeshes([collider, slab]);
  patches.push({ id: h.id, topY, local });
  console.log(`      ${h.id}: slab top y=${topY.toFixed(2)} (${local ? `LOCAL median of ${heights.length} nearby cells` : "global plane fallback"})`);
}
if (holes.length === 0) console.log("      (no collider_hole defects in this survey)");

// ---------- FIX 3: delete floaters from the visual layer
console.log("[4/5] FIX 3 — deleting floaters…");
const fl = removeFloaters(world.visualPoints, world.visualScales, before.survey);
console.log(`      ${fl.clustersRemoved} clusters / ${fl.pointsRemoved} points removed`);

// ---------- AFTER survey
console.log("[5/5] AFTER survey (2000 probes, same seed)…");
t0 = Date.now();
const after = await certifyWorld(
  { worldId: world.worldId, collider, visualPoints: fl.points, visualScales: fl.scales, metadata: world.metadata },
  opts,
);
console.log(`      done (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

const bExt = before.certificate.extendedChecks!, aExt = after.certificate.extendedChecks!;
const openOf = (c: typeof before.certificate) => c.defects.filter((d) => !d.outcome);
const holesOf = (c: typeof before.certificate) => openOf(c).filter((d) => d.type === "collider_hole").length;
const row = (l: string, b: string, a: string) => console.log(`  ${l.padEnd(24)} ${b.padEnd(30)} -> ${a}`);
console.log(`\n=== FIX RECEIPT (${world.worldId}) — carve + patch + defloat, no quarantining ===`);
row("grade", before.certificate.grade, after.certificate.grade);
row("open defects", `${openOf(before.certificate).length}`, `${openOf(after.certificate).length}`);
row("collider holes", `${holesOf(before.certificate)}`, `${holesOf(after.certificate)}`);
row("floaters", `${bExt.floaters.count} (${bExt.floaters.pointSharePct.toFixed(2)}%)`, `${aExt.floaters.count} (${aExt.floaters.pointSharePct.toFixed(2)}%)`);
row("trust: divergent", `${before.certificate.trust.lyingPct.toFixed(1)}%`, `${after.certificate.trust.lyingPct.toFixed(1)}%`);
row("settling", bExt.settling.verdict.split(".")[0], aExt.settling.verdict.split(".")[0]);
const fi = (c: typeof before.certificate) => c.robotVerdicts.filter((v) => v.check === "floor_integrity").map((v) => `${v.robotId}:${v.pass === true ? "PASS" : "FAIL"}`).join(" ");
row("floor integrity", fi(before.certificate), fi(after.certificate));

const outDir = dir.replace(/[\\/]+$/, "") + "-fixed";
mkdirSync(outDir, { recursive: true });
await saveTriMeshGlb(join(outDir, "collider.glb"), collider, "collider-fixed");
writeFileSync(join(outDir, "visual-points.f32"), Buffer.from(fl.points.buffer, fl.points.byteOffset, fl.points.byteLength));
if (fl.scales) writeFileSync(join(outDir, "visual-scales.f32"), Buffer.from(fl.scales.buffer, fl.scales.byteOffset, fl.scales.byteLength));
copyFileSync(join(dir, "metadata.json"), join(outDir, "metadata.json"));
if (existsSync(join(dir, "depth-audit.json"))) copyFileSync(join(dir, "depth-audit.json"), join(outDir, "depth-audit.json"));
writeFileSync(join(outDir, "certificate.json"), JSON.stringify(after.certificate, null, 2));
const { renderCertificateMd } = await import("../src/report/certificateMd.js");
writeFileSync(join(outDir, "certificate.md"), renderCertificateMd(after.certificate));
writeFileSync(join(outDir, "fix-receipt.json"), JSON.stringify({
  worldId: world.worldId, seed: 1234, probes: 2000,
  fixes: {
    carve_rampart: { box: CARVE, trianglesRemoved: carved },
    patch_holes: patches,
    delete_floaters: { clusters: fl.clustersRemoved, points: fl.pointsRemoved },
  },
  before: { grade: before.certificate.grade, open: openOf(before.certificate).length, holes: holesOf(before.certificate), floaters: bExt.floaters.count, divergentPct: before.certificate.trust.lyingPct },
  after: { grade: after.certificate.grade, open: openOf(after.certificate).length, holes: holesOf(after.certificate), floaters: aExt.floaters.count, divergentPct: after.certificate.trust.lyingPct },
}, null, 2));
console.log(`\nfixed bundle -> ${outDir} (source untouched)`);
console.log("FIX-RUN-DONE");
