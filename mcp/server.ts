/**
 * Surveyor MCP server — the second front door. The same headless certify
 * core, exposed over MCP stdio so Claude Desktop (or any MCP client) can
 * certify worlds over localhost with no network dependency (wifi-immune).
 *
 * SDK pinned to v1.x per the plan — do NOT chase the v2 spec during hack week.
 *
 * Claude Desktop config (claude_desktop_config.json):
 *   "surveyor": { "command": "npx", "args": ["tsx", "D:/worlds-in-action/mcp/server.ts"] }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { certifyWorld } from "../src/certify/certificate.js";
import { GRAVITY, ROBOT_PRESETS, type Certificate } from "../src/core/types.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";

const ASSET_ROOT = join(process.cwd(), "assets", "generated");
const certificates = new Map<string, Certificate>();

const server = new McpServer({ name: "surveyor", version: "0.1.0" });

server.tool(
  "list_worlds",
  "List world bundles available for certification. Call this first to discover valid worldId values.",
  {},
  async () => {
    const worlds = existsSync(ASSET_ROOT)
      ? readdirSync(ASSET_ROOT, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(join(ASSET_ROOT, d.name, "collider.glb")))
          .map((d) => d.name)
      : [];
    return { content: [{ type: "text", text: JSON.stringify({ worlds, assetRoot: ASSET_ROOT }) }] };
  },
);

server.tool(
  "certify_world",
  "Run the full physical inspection of a world (probe rain, virtual LiDAR, divergence, metrology) and grade it for a specific robot class. Takes ~10-30 s. Call when asked to certify, inspect, or grade a world; re-call with a different gravity to re-certify under Moon/Mars conditions.",
  {
    worldId: z.string().describe("A worldId from list_worlds"),
    gravity: z.enum(["earth", "moon", "mars"]).default("earth"),
    robot: z.enum(["rover", "quadruped", "both"]).default("both"),
    probes: z.number().int().min(100).max(5000).default(2000),
    seed: z.number().int().default(1234),
  },
  async ({ worldId, gravity, robot, probes, seed }) => {
    const dir = join(ASSET_ROOT, worldId);
    if (!existsSync(dir)) {
      return { content: [{ type: "text", text: `Unknown world '${worldId}'. Call list_worlds first.` }], isError: true };
    }
    const world = await loadWorldBundle(dir);
    const robots =
      robot === "both" ? [ROBOT_PRESETS.rover, ROBOT_PRESETS.quadruped] : [ROBOT_PRESETS[robot]];
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
      { gravity: GRAVITY[gravity], robots, seed, survey: { probeCount: probes } },
    );
    certificates.set(`${worldId}:${gravity}`, certificate);

    // compact summary for the model; full JSON via get_certificate
    const failing = certificate.robotVerdicts.filter((v) => v.pass === false);
    const summary = {
      worldId,
      gravity,
      grade: certificate.grade,
      gradeRationale: certificate.gradeRationale,
      trust: certificate.trust,
      defects: certificate.defects.map((d) => ({
        id: d.id,
        type: d.type,
        severity: d.severity,
        confidence: d.confidence,
        description: d.description,
      })),
      failingVerdicts: failing.map((v) => ({
        robot: v.robotId,
        check: v.check,
        measured: v.measured ? `${v.measured.value.toFixed(2)} ${v.measured.unit} (${v.measured.uncertainty.low.toFixed(2)}..${v.measured.uncertainty.high.toFixed(2)})` : undefined,
        requirement: v.requirement,
      })),
      gravityNotes: certificate.robotVerdicts
        .filter((v) => v.robotId === certificate.robotVerdicts[0]?.robotId)
        .map((v) => `${v.check}: ${v.gravityNote}`),
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },
);

server.tool(
  "get_certificate",
  "Return the full certificate JSON (all measurements with uncertainty and methods lines, evidence, disclosures, probe stats) for a world already certified this session. Call after certify_world when you need the complete evidence trail.",
  {
    worldId: z.string(),
    gravity: z.enum(["earth", "moon", "mars"]).default("earth"),
  },
  async ({ worldId, gravity }) => {
    const cert = certificates.get(`${worldId}:${gravity}`);
    if (!cert) {
      return {
        content: [{ type: "text", text: `No certificate for '${worldId}' under ${gravity} gravity in this session — call certify_world first.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(cert, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("surveyor MCP server ready (stdio)");
