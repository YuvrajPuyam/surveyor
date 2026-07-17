/**
 * Sojourner repair demo — the physical layer updated to match the
 * photovisual layer, WITH the honesty policy the Fouriesburg world forces:
 *
 *   collider_hole   -> patch_hole(fitted_slab): visuals claim floor, physics
 *                      has nothing -> BUILD physical up to the visual claim.
 *   visual_only     -> quarantine: a visible rock with no collider. v1 does
 *                      not fabricate walls from splats; flagged, not faked.
 *   phantom ring    -> quarantine, NOT carve: occlusion shadows have no
 *                      visual evidence EITHER WAY (the camera never saw
 *                      there). Deleting 15k phantom ground tris would drop
 *                      a drone through terrain that probably exists.
 *                      Physical layer retained, demoted to UNKNOWN.
 *
 *   npx tsx scripts/sojourner-repair.ts <bundle-dir> [--probes N]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { RepairEngine } from "../src/repair/engine.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/sojourner-repair.ts <bundle-dir> [--probes N]");
  process.exit(2);
}
const pi = process.argv.indexOf("--probes");
const probeCount = pi > -1 ? parseInt(process.argv[pi + 1], 10) : 2000;
if (!Number.isFinite(probeCount) || probeCount <= 0) {
  console.error(`invalid --probes "${process.argv[pi + 1]}" — must be a positive integer`);
  process.exit(2);
}

const world = await loadWorldBundle(dir);
console.log(`[1/4] init survey (${probeCount} probes) — this is the slow part…`);
const t0 = Date.now();
const engine = new RepairEngine(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, visualScales: world.visualScales, metadata: world.metadata },
  { probeCount, seed: 1234 },
);
const before = await engine.init();
console.log(`      grade ${before.grade}, ${before.defects.length} defects (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

console.log(`[2/4] repairs — physical layer edited toward the visual record where evidence supports it`);
const open = before.defects.filter((d) => !d.outcome);
let patched = 0, ghostsQ = 0, phantomsQ = 0;
for (const d of open) {
  if (d.type === "collider_hole") {
    const { slabTopY } = engine.patchHole(d.id, "fitted_slab");
    console.log(`      patch_hole ${d.id}: slab built at y=${slabTopY.toFixed(2)} — physics now matches the visual floor claim`);
    patched++;
  } else if (d.type === "visual_only_surface") {
    engine.quarantine(d.id, "ghost geometry — visible surface with no collider; flagged for the vision layer, not fabricated");
    ghostsQ++;
  } else if (d.type === "phantom_collider") {
    engine.quarantine(d.id, "occlusion shadow — single-pano capture never saw this region; collider retained, demoted to UNKNOWN for planning");
    phantomsQ++;
  }
  // raised sills stay open: real terrain features, judged per robot
}
console.log(`      ${patched} hole(s) patched · ${ghostsQ} ghost(s) quarantined · ${phantomsQ} phantom(s) quarantined (retained as UNKNOWN)`);

console.log(`[3/4] verdict after outcomes`);
const after = engine.getCertificate();
console.log(`      grade ${before.grade} -> ${after.grade}; open defects ${open.length} -> ${after.defects.filter((d) => !d.outcome || d.outcome === "escalated").length}`);

console.log(`[4/4] export repaired bundle`);
const outDir = dir.replace(/[\\/]+$/, "") + "-repaired";
const res = await engine.exportBundle(outDir);
writeFileSync(
  join(outDir, "repair-summary.json"),
  JSON.stringify(
    {
      worldId: world.worldId,
      probeCount,
      gradeBefore: before.grade,
      gradeAfter: after.grade,
      patched,
      ghostsQuarantined: ghostsQ,
      phantomsQuarantined: phantomsQ,
      policy:
        "physical edited toward visual ONLY where visual evidence exists (holes patched at the visual floor claim); absent evidence (occlusion shadows) -> quarantine to UNKNOWN, never fabricate, never delete blindly",
    },
    null,
    2,
  ),
);
console.log(`      ${res.files.length + 1} files -> ${outDir}`);
console.log(`REPAIR-DEMO-DONE`);
