/**
 * Assemble the Certified World Pack's USD stage from a bundle directory
 * (ENDGAME C8): world/<worldId>.usda + SimReady validator report.
 *
 * Usage: npx tsx scripts/usd-pack.ts <bundle-dir> [--out <dir>]
 * The bundle needs collider.glb + certificate.json; spawns.json and
 * quarantine.json (from a repaired-bundle export) are used when present —
 * absent ones produce an empty scope and a visible validator detail, never
 * a silent fabrication.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aabbOfPositions } from "../src/core/geom.js";
import { CertificateSchema } from "../src/core/types.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import type { QuarantineZone } from "../src/export/isaacContract.js";
import type { SpawnPoint } from "../src/repair/engine.js";
import { buildUsdaStage } from "../src/export/usdPack.js";
import { reportToMarkdown, validateUsdaStage } from "../src/export/usdValidate.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npx tsx scripts/usd-pack.ts <bundle-dir> [--out <dir>]");
  process.exit(2);
}
const outIdx = args.indexOf("--out");
const outDir = outIdx > -1 ? args[outIdx + 1] : join(dir, "pack");

const world = await loadWorldBundle(dir);
const certificate = CertificateSchema.parse(JSON.parse(readFileSync(join(dir, "certificate.json"), "utf8")));
const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined);
const spawns = readJson<SpawnPoint[]>(join(dir, "spawns.json")) ?? [];
const quarantine = readJson<QuarantineZone[]>(join(dir, "quarantine.json")) ?? [];

const usda = buildUsdaStage({ collider: world.collider, certificate, spawns, quarantine });
const report = validateUsdaStage(usda, {
  colliderAabb: aabbOfPositions(world.collider.positions),
  pointCount: world.collider.positions.length / 3,
  triCount: world.collider.indices.length / 3,
  spawnCount: spawns.length,
  quarantineCount: quarantine.length,
  gravityMps2: certificate.gravity.g,
});

mkdirSync(join(outDir, "world"), { recursive: true });
const stagePath = join(outDir, "world", `${certificate.worldId}.usda`);
writeFileSync(stagePath, usda);
writeFileSync(join(outDir, "validator-report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "validator-report.md"), reportToMarkdown(report, certificate.worldId));

console.log(`stage     → ${stagePath} (${(usda.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`validator → ${join(outDir, "validator-report.md")}`);
for (const r of report.rules) console.log(`  ${r.pass ? "✓" : "✗ FAIL"} ${r.id}: ${r.detail}`);
if (spawns.length === 0) console.log("  (no spawns.json in this bundle — export a repaired bundle to fill /World/Spawns)");
console.log(report.pass ? "ALL RULES PASS" : "FAILURES PRESENT");
process.exit(report.pass ? 0 : 1);
