/**
 * Drive the hero fail-and-adapt sequence through the AGENT tool dispatcher —
 * the exact JSON contract the LLM sees — with no LLM and no network.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dispatchTool, REPAIR_TOOLS } from "../src/agent/tools.js";
import { RepairEngine } from "../src/repair/engine.js";
import { heroWorld } from "../src/ingest/synthetic.js";

let engine: RepairEngine;

beforeAll(async () => {
  const world = heroWorld();
  engine = new RepairEngine(
    { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
    { probeCount: 600 },
  );
  await engine.init();
});

describe("agent tool dispatcher", () => {
  it("every tool in the menu has a strict schema", () => {
    for (const t of REPAIR_TOOLS) {
      expect((t.input_schema as { additionalProperties: boolean }).additionalProperties).toBe(false);
    }
  });

  it("runs the full fail-and-adapt sequence through the JSON contract", async () => {
    const cert = (await dispatchTool(engine, "get_certificate", {})) as {
      defects: { id: string; type: string; outcome: string }[];
    };
    const hole = cert.defects.find((d) => d.type === "collider_hole")!;
    const lie = cert.defects.find((d) => d.type === "visual_only_surface")!;
    const sill = cert.defects.find((d) => d.type === "raised_sill")!;

    const patch = (await dispatchTool(engine, "patch_hole", { defectId: hole.id, method: "fitted_slab" })) as {
      actionId: string;
    };
    const r1 = (await dispatchTool(engine, "recertify", { scope: "regional", defectId: hole.id })) as {
      resolvedDefectIds: string[];
      newDefects: { id: string; type: string }[];
    };
    expect(r1.resolvedDefectIds).toContain(hole.id);
    expect(r1.newDefects.some((d) => d.type === "raised_sill")).toBe(true);

    await dispatchTool(engine, "revert", { actionId: patch.actionId });
    await dispatchTool(engine, "recertify", { scope: "regional", defectId: hole.id });
    await dispatchTool(engine, "patch_hole", { defectId: hole.id, method: "mesh_fill" });
    const r2 = (await dispatchTool(engine, "recertify", { scope: "regional", defectId: hole.id })) as {
      resolvedDefectIds: string[];
      newDefects: { type: string }[];
    };
    expect(r2.resolvedDefectIds).toContain(hole.id);
    expect(r2.newDefects.filter((d) => d.type === "raised_sill")).toHaveLength(0);

    await dispatchTool(engine, "quarantine", { defectId: lie.id, reason: "visual lie, roped off" });
    await dispatchTool(engine, "accept_defect", { defectId: sill.id, reason: "robot-relative feature, verdict stands" });
    for (const d of engine.openDefects()) {
      await dispatchTool(engine, "accept_defect", { defectId: d.id, reason: "boundary artifact cleared by revert" });
    }

    const spawns = (await dispatchTool(engine, "rebuild_navmesh_and_spawns", {})) as { spawns: unknown[] };
    expect(spawns.spawns.length).toBeGreaterThan(0);
    expect(engine.openDefects()).toHaveLength(0);
  });

  it("unknown tools are rejected — the menu is closed", async () => {
    const r = (await dispatchTool(engine, "delete_world", {})) as { error?: string };
    expect(r.error).toMatch(/closed/);
  });
});
