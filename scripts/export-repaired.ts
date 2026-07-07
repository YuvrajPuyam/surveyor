/**
 * Re-execute a recorded repair cassette against a live engine and export the
 * repaired bundle (collider + spawns + quarantine + contract + certificate).
 * No network, no LLM: the cassette's tool calls drive the same deterministic
 * engine the agent drove — this is how the canonical pack's world/ inputs are
 * (re)produced from the repo alone.
 *
 *   npx tsx scripts/export-repaired.ts <bundle-dir> <cassette.jsonl> --out <dir>
 */
import { readFileSync } from "node:fs";
import { RepairEngine } from "../src/repair/engine.js";
import { dispatchTool } from "../src/agent/tools.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
const [bundleDir, cassettePath] = args.filter((a, i) => i !== outIdx && i !== outIdx + 1);
if (!bundleDir || !cassettePath || !outDir) {
  console.error("usage: npx tsx scripts/export-repaired.ts <bundle-dir> <cassette.jsonl> --out <dir>");
  process.exit(2);
}

const world = await loadWorldBundle(bundleDir);
// 2000 probes = the canonical certification budget (same everywhere)
const engine = new RepairEngine(
  {
    worldId: world.worldId,
    collider: world.collider,
    visualPoints: world.visualPoints,
    visualScales: "visualScales" in world ? (world as { visualScales?: Float32Array }).visualScales : undefined,
    metadata: world.metadata,
  },
  { probeCount: 2000 },
);
const baseline = await engine.init();
console.log(`baseline grade ${baseline.grade}: ${baseline.defects.length} defect(s)`);

const events = readFileSync(cassettePath, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { kind: string; name?: string; args?: unknown });

let calls = 0;
let errs = 0;
for (const ev of events) {
  if (ev.kind !== "tool_call" || !ev.name) continue;
  // errors are part of the episode: the live runner catches them and the
  // agent adapts (fail-and-adapt). Replay must do the same, not die.
  try {
    await dispatchTool(engine, ev.name, ev.args ?? {});
  } catch (e) {
    errs += 1;
    console.log(`  (tool error, as in the live episode) ${ev.name}: ${(e as Error).message}`);
  }
  calls += 1;
}
console.log(`tool errors during replay: ${errs}`);
const cert = engine.getCertificate();
console.log(`replayed ${calls} tool calls — final grade ${cert.grade} (baseline ${baseline.grade})`);

const res = await engine.exportBundle(outDir);
console.log(`exported ${res.files.length} files to ${outDir} (${res.openDefects} open defects)`);
for (const f of res.files) console.log(`  ${f}`);
