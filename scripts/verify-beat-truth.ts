/**
 * Beat-truth verifier (ENDGAME C4): run the deterministic repair plan
 * headlessly on a bundle and check that every sentence the demo speaks is
 * rendered by the world's own certificate:
 *
 *  1. count consistency — a fresh engine certification equals the bundle's
 *     canonical certificate.json (grade, defect count, trust pcts);
 *  2. suspension truth — metric verdicts are not_evaluated while the scale
 *     error is open (the "certificate refuses to measure at the wrong
 *     scale" line);
 *  3. contrast truth — after apply_vendor_scale + repairs, the app's own
 *     verdictsSummary() renders the per-robot sill contrast (or says what
 *     it actually renders, so the demo script can quote it verbatim);
 *  4. F→A truth — the closing grade after the full plan.
 *
 * Usage: npx tsx scripts/verify-beat-truth.ts [bundle-dir]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verdictsSummary, trustSummary } from "../app/src/ui/humanize.js";
import type { Certificate } from "../src/core/types.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { RepairEngine } from "../src/repair/engine.js";

const dir = process.argv[2] ?? "assets/marble/7188e250-e2ff-43e7-babb-73834c22e932";

let failures = 0;
function check(cond: boolean, label: string): void {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

const world = await loadWorldBundle(dir);
const canonical = JSON.parse(readFileSync(join(dir, "certificate.json"), "utf8")) as Certificate;

console.log(`\n=== ${world.worldId} — beat truth ===\n`);
const engine = new RepairEngine(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, visualScales: world.visualScales, metadata: world.metadata },
  {},
);
const cert0 = await engine.init();

console.log("[1] count consistency: engine vs canonical certificate.json");
check(cert0.grade === canonical.grade, `grade ${cert0.grade} == canonical ${canonical.grade}`);
check(
  cert0.defects.length === canonical.defects.length,
  `defect count ${cert0.defects.length} == canonical ${canonical.defects.length}`,
);
check(
  Math.abs(cert0.trust.verifiedPct - canonical.trust.verifiedPct) < 0.05,
  `confirmed ${cert0.trust.verifiedPct.toFixed(1)}% == canonical ${canonical.trust.verifiedPct.toFixed(1)}%`,
);
check(
  Math.abs(cert0.trust.lyingPct - canonical.trust.lyingPct) < 0.05,
  `divergent ${cert0.trust.lyingPct.toFixed(1)}% == canonical ${canonical.trust.lyingPct.toFixed(1)}%`,
);
console.log(`  Beat-2 spoken line: "${trustSummary({ ...cert0.trust }).line}"`);

console.log("\n[2] suspension truth (raw world)");
const rawStep = cert0.robotVerdicts.filter((v) => v.check === "step_negotiation");
check(rawStep.every((v) => v.pass === "not_evaluated"), "step verdicts suspended while scale error is open");
console.log(`  Beat-3 verdict line (raw): "${verdictsSummary(cert0 as never)}"`);

console.log("\n[3] the plan: scale → holes → quarantine → accept");
const scaleDefect = cert0.defects.find((d) => d.type === "scale_error");
check(!!scaleDefect, "scale defect present on raw world");
engine.applyVendorScale();
let report = await engine.recertify("full");
console.log(`  after scale: grade ${report.certificate.grade}, ${report.resolvedDefectIds.length} resolved, ${report.newDefects.length} re-measured findings`);

let cert = engine.getCertificate();
// Re-certification legitimately DISCOVERS new findings (re-measured world
// at true scale, patch seams) and REOPENS fixed defects whose patches do
// not hold at full-survey scope — the certifier audits its own repairs.
// So the plan is a fixpoint loop, like the repair panel's replan flow:
// plan rounds until nothing is open, then a FULL recertify; if that
// reopens anything, plan again — second-time offenders get quarantined.
// Each full recertify can mint a few NEW borderline clusters (patches change
// the mesh, cluster boundaries shift, IoU matching misses) — the wave count
// decays fast (21 → 6 → 4 …), so iterate until it dries up.
const patchAttempts = new Map<string, number>();
for (let wave = 0; wave < 6; wave++) {
  for (let round = 0; round < 5 && engine.openDefects().length > 0; round++) {
    for (const d of engine.openDefects().filter((d) => d.type === "collider_hole")) {
      const attempts = patchAttempts.get(d.id) ?? 0;
      patchAttempts.set(d.id, attempts + 1);
      if (attempts >= 1) {
        engine.quarantine(d.id, "patch did not survive full re-certification — roped off, honest beats invisible");
        continue;
      }
      try {
        engine.patchHole(d.id, "mesh_fill");
        await engine.recertify("regional", d.id);
        if (engine.openDefects().some((x) => x.id === d.id)) {
          engine.quarantine(d.id, "patch did not pass regional re-certification");
        }
      } catch (err) {
        engine.quarantine(d.id, `patch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const d of engine.openDefects()) {
      if (d.type === "phantom_collider" || d.type === "visual_only_surface") {
        engine.quarantine(d.id, "cannot be honestly repaired — excluded from training space");
      } else if (d.type === "raised_sill") {
        engine.markOutcome(d.id, "accepted", "real terrain feature — negotiability is per-robot");
      } else if (d.type === "clearance_violation") {
        engine.quarantine(d.id, "too tight for the fleet — excluded from training space");
      }
    }
    console.log(`  wave ${wave + 1} round ${round + 1}: ${engine.openDefects().length} open (${engine.openDefects().map((d) => d.type).join(", ") || "none"})`);
  }
  report = await engine.recertify("full");
  console.log(`  wave ${wave + 1} full recertify: grade ${report.certificate.grade}, ${engine.openDefects().length} reopened/new`);
  if (engine.openDefects().length === 0) break;
}
const leftovers = engine.openDefects();
for (const d of leftovers) engine.markOutcome(d.id, "escalated", "outside the automated plan");
check(leftovers.length === 0, `no unexpected leftovers (${leftovers.map((d) => d.type).join(", ") || "none"})`);
cert = engine.getCertificate();

console.log("\n[4] closing truth (repaired world)");
console.log(`  final grade: ${cert.grade}`);
check(cert.grade === "A" || cert.grade === "B", `closing grade A/B (got ${cert.grade})`);
const stepVs = cert.robotVerdicts.filter((v) => v.check === "step_negotiation");
for (const v of stepVs) {
  console.log(`  step_negotiation ${v.robotId}: ${v.pass}${v.measured ? ` (${v.measured.value.toFixed(2)} ${v.measured.unit})` : ""}`);
}
const line = verdictsSummary(cert as never);
console.log(`  Beat-5 spoken line: "${line}"`);
check(stepVs.some((v) => v.pass !== "not_evaluated"), "metric verdicts unlocked after scale repair");
const contrast = line.startsWith("Same world, two answers");
console.log(contrast ? "  → sill contrast RENDERS — Beat 3/5 sentence is true on this world" : "  → NO sill contrast on this world — demo must quote the line above instead");

// --export <dir>: also produce the repaired bundle (collider, certificate
// with outcomes, verified spawns, quarantine zones, Isaac contract) — the
// input the USD pack assembler fills its Spawns/Quarantine scopes from.
const exportIdx = process.argv.indexOf("--export");
if (failures === 0 && exportIdx > -1) {
  const outDir = process.argv[exportIdx + 1];
  engine.rebuildNavmeshAndSpawns();
  const res = await engine.exportBundle(outDir);
  console.log(`exported repaired bundle → ${outDir} (${res.files.join(", ")}; ${res.openDefects} open defects)`);
}

console.log(`\n${failures === 0 ? "ALL TRUE" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
