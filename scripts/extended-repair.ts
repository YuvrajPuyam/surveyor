/**
 * EXTENDED REPAIR — the fix lane for what `certify --extended` finds.
 * Mirrors the extended-check profile the way the 11-tool agent mirrors the
 * core survey (the agent's closed menu stays closed; this is a separate,
 * deterministic CLI lane):
 *
 *   settling FAIL (boxes ejected)  → mesh hygiene: weld + drop degenerate
 *                                    and duplicate collider triangles
 *   floater census > 0             → remove disconnected splat clusters
 *                                    from the visual point evidence
 *
 * Non-destructive by construction: writes a NEW bundle directory and never
 * touches the source. Prints a before/after receipt and writes it into the
 * cleaned bundle as extended-repair-receipt.json.
 *
 *   npx tsx scripts/extended-repair.ts <bundle-dir> [--out <dir>]
 *                                      [--seed N] [--gravity earth|moon|mars]
 *
 * Exit codes: 0 = settling improved or already clean · 1 = repairs written
 * but settling did NOT improve (bundle + receipt still produced) · 2 = usage.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { certifyWorld } from "../src/certify/certificate.js";
import { removeFloaters } from "../src/certify/extended.js";
import { GRAVITY } from "../src/core/types.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { saveTriMeshGlb } from "../src/ingest/glb.js";
import { meshHygiene } from "../src/repair/meshHygiene.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
if (!dir) {
  console.error("usage: npx tsx scripts/extended-repair.ts <bundle-dir> [--out <dir>] [--seed N] [--gravity earth|moon|mars]");
  process.exit(2);
}
const gravityName = (flag("gravity") ?? "earth") as keyof typeof GRAVITY;
if (!GRAVITY[gravityName]) {
  console.error(`unknown gravity "${gravityName}" — earth|moon|mars`);
  process.exit(2);
}
const seed = flag("seed") ? parseInt(flag("seed")!, 10) : 1234;
if (!Number.isFinite(seed)) {
  console.error(`invalid --seed "${flag("seed")}" — must be an integer`);
  process.exit(2);
}
const outDir = flag("out") ?? join(dirname(dir), `${basename(dir.replace(/[\\/]+$/, ""))}-cleaned`);

const world = await loadWorldBundle(dir);
const certOpts = { seed, gravity: GRAVITY[gravityName], extended: true } as const;

console.log(`BEFORE — certifying ${world.worldId} (extended profile)...`);
const before = await certifyWorld(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, visualScales: world.visualScales, metadata: world.metadata },
  certOpts,
);
const extB = before.certificate.extendedChecks!;

// ---- repair 1: mesh hygiene (targets settling failures)
const { mesh: cleanedCollider, report: hygiene } = meshHygiene(world.collider);
// ---- repair 2: floater removal (targets the census)
const floaterFix = removeFloaters(world.visualPoints, world.visualScales, before.survey);

console.log(
  `\nrepairs:\n` +
    `  mesh hygiene: ${hygiene.trianglesBefore - hygiene.trianglesAfter} triangle(s) removed ` +
    `(${hygiene.degenerateRemoved} degenerate, ${hygiene.duplicateRemoved} duplicate), ` +
    `${hygiene.verticesBefore - hygiene.verticesAfter} vertice(s) welded/orphaned (eps ${hygiene.weldEpsM} m)\n` +
    `  floaters: ${floaterFix.clustersRemoved} cluster(s) removed, ${floaterFix.pointsRemoved} point(s)`,
);

console.log(`\nAFTER — re-certifying the cleaned world (same seed, same gravity)...`);
const after = await certifyWorld(
  { worldId: world.worldId, collider: cleanedCollider, visualPoints: floaterFix.points, visualScales: floaterFix.scales, metadata: world.metadata },
  certOpts,
);
const extA = after.certificate.extendedChecks!;

// ---- receipt
const row = (label: string, b: string, a: string) => console.log(`  ${label.padEnd(22)} ${b.padEnd(34)} → ${a}`);
console.log(`\n=== EXTENDED-REPAIR RECEIPT (${world.worldId}) ===`);
row("grade", before.certificate.grade, after.certificate.grade);
row(
  "settling",
  `${extB.settling.stable}/${extB.settling.boxes} stable, ${extB.settling.ejected} ejected, ${extB.settling.fellThrough} fell-through, ${extB.settling.leftWorld} left-world`,
  `${extA.settling.stable}/${extA.settling.boxes} stable, ${extA.settling.ejected} ejected, ${extA.settling.fellThrough} fell-through, ${extA.settling.leftWorld} left-world`,
);
row("floaters", `${extB.floaters.count} (${extB.floaters.pointSharePct.toFixed(2)}%)`, `${extA.floaters.count} (${extA.floaters.pointSharePct.toFixed(2)}%)`);
row("reachability", `${extB.reachability.fractionPct.value.toFixed(1)}%`, `${extA.reachability.fractionPct.value.toFixed(1)}%`);
row(
  "open defects",
  `${before.certificate.defects.filter((d) => !d.outcome).length}`,
  `${after.certificate.defects.filter((d) => !d.outcome).length}`,
);

// ---- write the cleaned bundle (never mutate the source)
mkdirSync(outDir, { recursive: true });
await saveTriMeshGlb(join(outDir, "collider.glb"), cleanedCollider, "collider");
writeFileSync(join(outDir, "visual-points.f32"), Buffer.from(floaterFix.points.buffer, floaterFix.points.byteOffset, floaterFix.points.byteLength));
if (floaterFix.scales) {
  writeFileSync(join(outDir, "visual-scales.f32"), Buffer.from(floaterFix.scales.buffer, floaterFix.scales.byteOffset, floaterFix.scales.byteLength));
}
copyFileSync(join(dir, "metadata.json"), join(outDir, "metadata.json"));
for (const side of ["manifest.json", "depth-audit.json"]) {
  if (existsSync(join(dir, side))) copyFileSync(join(dir, side), join(outDir, side));
}
writeFileSync(
  join(outDir, "extended-repair-receipt.json"),
  JSON.stringify(
    {
      worldId: world.worldId,
      source: dir,
      seed,
      gravity: gravityName,
      repairs: { meshHygiene: hygiene, floaters: { clustersRemoved: floaterFix.clustersRemoved, pointsRemoved: floaterFix.pointsRemoved } },
      before: { grade: before.certificate.grade, settling: extB.settling, floaters: { count: extB.floaters.count }, reachabilityPct: extB.reachability.fractionPct.value },
      after: { grade: after.certificate.grade, settling: extA.settling, floaters: { count: extA.floaters.count }, reachabilityPct: extA.reachability.fractionPct.value },
      scope:
        "Cleans the certified point evidence (visual-points.f32) and the collider; re-exporting the .spz splat itself is vendor-side. Splat files are not copied — reference the source bundle for rendering.",
    },
    null,
    2,
  ),
);
console.log(`\ncleaned bundle → ${outDir} (source untouched; receipt inside)`);

// exit 0 when the settling verdict improved or was already clean
const improved = extA.settling.ejected < extB.settling.ejected || (extB.settling.ejected === 0 && extA.settling.ejected === 0);
process.exit(improved ? 0 : 1);
