/**
 * Repair-session MCP server — the repair engine's 11-tool closed menu over
 * stdio, stateful for the lifetime of one session. Lets ANY MCP client run a
 * repair episode: Claude Desktop, or headless Claude Code (`claude -p`),
 * which bills a Claude subscription instead of an API key.
 *
 *   npx tsx mcp/repair-server.ts --world assets/marble/<id> [--probes 800]
 *   npx tsx mcp/repair-server.ts --hero
 *
 * Every tool call is recorded to traces/<worldId>-mcp-<n>.jsonl (the replay
 * cassette). The baseline certification runs at startup.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { z } from "zod";
import { dispatchTool, REPAIR_TOOLS } from "../src/agent/tools.js";
import { RepairEngine } from "../src/repair/engine.js";
import { heroWorld } from "../src/ingest/synthetic.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { TraceRecorder } from "../src/trace/cassette.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};

let world;
if (args.includes("--hero")) {
  const bundle = heroWorld();
  world = { worldId: bundle.worldId, collider: bundle.collider, visualPoints: bundle.visualPoints, metadata: bundle.metadata };
} else if (flag("world")) {
  world = await loadWorldBundle(flag("world")!);
} else {
  console.error("usage: repair-server --world <bundle-dir> | --hero [--probes n]");
  process.exit(1);
}

const probeCount = flag("probes") ? parseInt(flag("probes")!, 10) : 800;
const engine = new RepairEngine(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
  { probeCount },
);
console.error(`[repair-server] certifying baseline for ${world.worldId} (${probeCount} probes)...`);
const baseline = await engine.init();
console.error(`[repair-server] baseline grade ${baseline.grade}, ${baseline.defects.length} defect(s). Ready.`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const recorder = new TraceRecorder(
  `mcp-${world.worldId}`,
  join(process.cwd(), "traces", `${world.worldId}-mcp-${stamp}.jsonl`),
);
recorder.note(`baseline grade ${baseline.grade}, ${baseline.defects.length} defects, probes ${probeCount}`);

const server = new McpServer({ name: "surveyor-repair", version: "0.1.0" });

// zod shapes mirroring src/agent/tools.ts JSON schemas (kept in lockstep)
const ZOD_SHAPES: Record<string, z.ZodRawShape> = {
  get_certificate: {},
  inspect_region: { defectId: z.string() },
  query_measurement: { name: z.string() },
  apply_vendor_scale: {},
  patch_hole: { defectId: z.string(), method: z.enum(["fitted_slab", "mesh_fill"]) },
  carve_opening: { defectId: z.string() },
  quarantine: { defectId: z.string().optional(), defectIds: z.array(z.string()).optional(), reason: z.string() },
  accept_defect: { defectId: z.string().optional(), defectIds: z.array(z.string()).optional(), reason: z.string() },
  rebuild_navmesh_and_spawns: {},
  revert: { actionId: z.string() },
  recertify: { scope: z.enum(["regional", "full"]), defectId: z.string().optional() },
};

for (const tool of REPAIR_TOOLS) {
  server.tool(tool.name, tool.description, ZOD_SHAPES[tool.name] ?? {}, async (input: Record<string, unknown>) => {
    try {
      const result = await recorder.record(tool.name, input, () => dispatchTool(engine, tool.name, input));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = (e as Error).message;
      recorder.note(`ERROR ${tool.name}: ${msg}`);
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
    }
  });
}

// pipeline v2 Stage B: export the post-repair state as a training contract
server.tool(
  "export_bundle",
  "Export the repaired world as a certified training bundle: corrected collider, certificate with all outcomes, verified spawns, quarantine zones, and the generated Isaac Lab training contract. Call once, after every defect has an outcome and a final recertify(full).",
  { outDir: z.string().optional() },
  async ({ outDir }) => {
    const dir = outDir ?? join(process.cwd(), "assets", "exports", world.worldId);
    const result = await recorder.record("export_bundle", { outDir: dir }, () => engine.exportBundle(dir));
    return { content: [{ type: "text", text: JSON.stringify({ dir, ...result }) }] };
  },
);

await server.connect(new StdioServerTransport());
console.error(`[repair-server] listening on stdio; cassette: ${recorder.path}`);
