/**
 * Run (or replay) a repair-agent episode.
 *
 *   npx tsx scripts/repair-agent.ts --hero                     # live episode on the built-in hero world
 *   npx tsx scripts/repair-agent.ts --world assets/marble/<id> # live episode on a downloaded Marble world
 *   npx tsx scripts/repair-agent.ts --replay traces/hero.jsonl # zero-network playback
 *
 * Live mode needs ANTHROPIC_API_KEY (or an `ant auth` profile). Default model
 * claude-sonnet-5; override with --model or SURVEYOR_AGENT_MODEL.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RepairEngine } from "../src/repair/engine.js";
import { heroWorld } from "../src/ingest/synthetic.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { replayEpisode, runRepairEpisode } from "../src/agent/runner.js";

// minimal .env support
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};

if (args.includes("--replay")) {
  const path = flag("replay");
  if (!path) throw new Error("--replay <cassette.jsonl>");
  replayEpisode(path, flag("delay") ? parseInt(flag("delay")!, 10) : 0);
  process.exit(0);
}

let world;
if (args.includes("--hero")) {
  const bundle = heroWorld();
  world = { worldId: bundle.worldId, collider: bundle.collider, visualPoints: bundle.visualPoints, metadata: bundle.metadata };
} else if (flag("world")) {
  world = await loadWorldBundle(flag("world")!);
} else {
  console.error("usage: repair-agent --hero | --world <bundle-dir> | --replay <cassette.jsonl> [--model m] [--probes n]");
  process.exit(1);
}

// 2000 probes = the canonical certification (browser count == certificate
// count == cassette count demands one probe budget everywhere)
const probeCount = flag("probes") ? parseInt(flag("probes")!, 10) : 2000;
console.log(`Certifying ${world.worldId} (baseline, ${probeCount} probes)...`);
const engine = new RepairEngine(
  {
    worldId: world.worldId,
    collider: world.collider,
    visualPoints: world.visualPoints,
    visualScales: "visualScales" in world ? world.visualScales : undefined,
    metadata: world.metadata,
  },
  { probeCount },
);
const baseline = await engine.init();
console.log(`Baseline grade ${baseline.grade}: ${baseline.defects.length} defect(s). Starting agent episode...\n`);

const cassette = join(process.cwd(), "traces", `${world.worldId}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const result = await runRepairEpisode(engine, { model: flag("model"), cassettePath: cassette });

console.log(`\n=== EPISODE COMPLETE ===`);
console.log(`turns ${result.turns}, tool calls ${result.toolCalls}, open defects ${result.openDefects}, stop ${result.stopReason}`);
console.log(`final grade: ${engine.getCertificate().grade} (baseline ${baseline.grade})`);
console.log(`cassette: ${cassette}`);
console.log(`replay anytime with: npx tsx scripts/repair-agent.ts --replay ${cassette}`);
