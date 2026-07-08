/**
 * paired-receipt.ts — C16 CLI. Same goals, same controller, raw vs repaired.
 *
 *   npx tsx scripts/paired-receipt.ts <raw-bundle-dir> <repaired-bundle-dir> [--n 15] [--seed 1234]
 *
 * Writes paired-receipt.json next to the repaired bundle (SIDECAR — no
 * certificate bytes are touched) and prints the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { runPairedReceipt } from "../src/validation/pairedGoals.js";

const args = process.argv.slice(2);
const flags = new Map<string, string>();
const dirs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith("--")) flags.set(a.slice(2), args[++i] ?? "");
  else dirs.push(a);
}
const [rawDir, repairedDir] = dirs;
if (!rawDir || !repairedDir) {
  console.error("usage: npx tsx scripts/paired-receipt.ts <raw-bundle-dir> <repaired-bundle-dir> [--n 15] [--seed 1234]");
  process.exit(2);
}
const n = parseInt(flags.get("n") ?? "15", 10);
const seed = parseInt(flags.get("seed") ?? "1234", 10);

const raw = await loadWorldBundle(rawDir);
const repaired = await loadWorldBundle(repairedDir);
const spawns = JSON.parse(readFileSync(join(repairedDir, "spawns.json"), "utf-8")) as {
  x: number; y: number; z: number;
}[];
// spawns.json may carry per-robot duplicates; dedupe by position
const seen = new Set<string>();
const uniq = spawns.filter((s) => {
  const k = `${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
console.log(`paired receipt: ${uniq.length} unique spawns, target n=${n}, seed ${seed}`);

const receipt = await runPairedReceipt(
  { collider: raw.collider },
  { collider: repaired.collider, visualPoints: repaired.visualPoints, metadata: repaired.metadata, worldId: repaired.worldId },
  uniq,
  n,
  seed,
);

console.log(`\nroute  dist(m)  raw            repaired`);
for (let i = 0; i < receipt.n; i++) {
  const g = receipt.goals[i]!;
  const a = receipt.raw[i]!;
  const b = receipt.repaired[i]!;
  console.log(
    `${String(g.id).padStart(4)}  ${String(g.distanceM).padStart(6)}  ` +
    `${a.outcome.padEnd(8)}(${a.simSeconds.toFixed(1)}s)  ${b.outcome.padEnd(8)}(${b.simSeconds.toFixed(1)}s)`,
  );
}
console.log(`\n${receipt.headline}`);
console.log(`caveat: ${receipt.caveat}`);

const outPath = join(repairedDir, "paired-receipt.json");
writeFileSync(outPath, JSON.stringify(receipt, null, 1));
console.log(`\nreceipt -> ${outPath}`);
