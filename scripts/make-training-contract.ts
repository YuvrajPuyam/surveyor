/**
 * Pipeline v2 Stage B, one command: bundle -> certify -> spawns -> exported
 * training contract. For repaired worlds, run a repair episode first (the
 * MCP export_bundle tool exports the post-repair state instead).
 *
 *   npx tsx scripts/make-training-contract.ts assets/marble/<id> [--gravity moon] [--probes 1500] [--out dir]
 */
import { join } from "node:path";
import { RepairEngine } from "../src/repair/engine.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { GRAVITY } from "../src/core/types.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: make-training-contract <bundle-dir> [--gravity earth|moon|mars] [--probes n] [--out dir]");
  process.exit(1);
}
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 ? args[i + 1] : undefined;
};

const world = await loadWorldBundle(dir);
const gravity = GRAVITY[(flag("gravity") ?? "earth") as keyof typeof GRAVITY];
const engine = new RepairEngine(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
  { probeCount: flag("probes") ? parseInt(flag("probes")!, 10) : 1500, gravity },
);
console.log(`certifying ${world.worldId} under ${gravity.name} gravity...`);
const cert = await engine.init();
engine.rebuildNavmeshAndSpawns();
const outDir = flag("out") ?? join("assets", "exports", world.worldId);
const { files, openDefects } = await engine.exportBundle(outDir);
console.log(`grade ${cert.grade}, ${openDefects} open defect(s) — exported ${files.length} files to ${outDir}`);
console.log(`\nnext (cluster, per pipeline-v2 Stage A):`);
console.log(`  npx splat-transform <splat.spz> world.ply  # bake certificate scale/rotation with -s/-r`);
console.log(`  python -m threedgrut.export.scripts.ply_to_usd world.ply --output_file world.usdz`);
