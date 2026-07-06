/**
 * Run the image-depth audit (instrument #3) on a bundle:
 *   npx tsx scripts/depth-audit.ts <bundle-dir> [--out file.json]
 * Needs pano.jpg in the bundle; uses certificate.json for per-defect
 * adjudication when present. First run downloads the depth model to the
 * local HF cache (~50 MB); afterwards fully offline.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { CertificateSchema, type Certificate } from "../src/core/types.js";
import { loadPano, panoDepthRays } from "../src/depth/panoDepth.js";
import { runDepthAudit } from "../src/depth/audit.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npx tsx scripts/depth-audit.ts <bundle-dir> [--out file.json]");
  process.exit(2);
}
const outIdx = args.indexOf("--out");
const outPath = outIdx > -1 ? args[outIdx + 1] : join(dir, "depth-audit.json");

const panoPath = join(dir, "pano.jpg");
if (!existsSync(panoPath)) {
  console.error(`no pano.jpg in ${dir} — the image-depth instrument needs the shipped panorama`);
  process.exit(1);
}

const world = await loadWorldBundle(dir);
let certificate: Certificate | undefined;
const certPath = join(dir, "certificate.json");
if (existsSync(certPath)) certificate = CertificateSchema.parse(JSON.parse(readFileSync(certPath, "utf8")));

console.log(`\nIMAGE-DEPTH AUDIT — ${world.worldId}\n`);
const pano = await loadPano(panoPath);
console.log(`pano ${pano.width}×${pano.height}, ${pano.channels}ch`);
const { rays, meta } = await panoDepthRays(pano, { onProgress: (m) => console.log(`  ${m}`) });

const report = await runDepthAudit({
  worldId: world.worldId,
  collider: world.collider,
  visualPoints: world.visualPoints,
  certificate,
  rays,
  rayMeta: meta,
  onProgress: (m) => console.log(`  ${m}`),
});

console.log("");
if (!report.conclusive) {
  console.log(`INCONCLUSIVE — ${report.inconclusiveReason}`);
  console.log(`(the instrument refuses to adjudicate on a calibration it cannot defend)`);
} else {
  const t = report.tallies;
  const measured = t.triple_confirmed + t.both_suspect + t.sides_with_splat + t.sides_with_collider + t.sides_with_neither;
  console.log(`verdicts over ${measured} measured rays:`);
  console.log(`  triple-confirmed (image ≈ splat ≈ collider): ${t.triple_confirmed}`);
  console.log(`  BOTH SUSPECT (image disagrees with agreeing assets): ${t.both_suspect}`);
  console.log(`  divergent rays — image sides with splat: ${t.sides_with_splat}, with collider: ${t.sides_with_collider}, with neither: ${t.sides_with_neither}`);
  if (report.bothSuspectRegions.length > 0) {
    console.log(`\nboth-suspect regions (top ${Math.min(5, report.bothSuspectRegions.length)}):`);
    for (const r of report.bothSuspectRegions.slice(0, 5)) {
      const rel = ((r.meanImageDepthM - r.meanAssetDepthM) / r.meanAssetDepthM) * 100;
      console.log(
        `  ${r.rays} rays near (${r.position.map((v) => v.toFixed(1)).join(", ")}) — imagery ${r.meanImageDepthM.toFixed(2)} m vs assets ${r.meanAssetDepthM.toFixed(2)} m (${rel > 0 ? "+" : ""}${rel.toFixed(0)}%)`,
      );
    }
  }
  if (report.adjudications.length > 0) {
    console.log(`\nper-defect adjudication:`);
    for (const a of report.adjudications) {
      console.log(
        `  ${a.defectId} (${a.type}, ${a.rays} rays, splat ${(a.supportsSplat * 100).toFixed(0)}% / collider ${(a.supportsCollider * 100).toFixed(0)}%):`,
      );
      console.log(`    → ${a.verdict}`);
    }
  }
}
console.log(`\nmethods:`);
for (const m of report.methods) console.log(`  § ${m}`);

writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nreport → ${outPath}`);
process.exit(0);
