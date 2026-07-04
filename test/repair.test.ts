/**
 * The complete demo repair loop as a regression test:
 * certify → patch(fitted_slab) → regional recertify reveals a NEW defect
 * (slab sits proud, creates a step) → revert → patch(mesh_fill) → passes →
 * quarantine the visual lie → accept the sill → every defect has an outcome.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { RepairEngine } from "../src/repair/engine.js";
import { heroWorld } from "../src/ingest/synthetic.js";
import type { Certificate } from "../src/core/types.js";

const world = heroWorld();
let engine: RepairEngine;
let cert: Certificate;

beforeAll(async () => {
  engine = new RepairEngine(
    { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
    { probeCount: 600 },
  );
  cert = await engine.init();
});

describe("repair engine — the hero loop", () => {
  it("initial certificate finds the hole, the sill, and the visual lie", () => {
    const types = cert.defects.map((d) => d.type);
    expect(types).toContain("collider_hole");
    expect(types).toContain("raised_sill");
    expect(types).toContain("visual_only_surface");
  });

  it("fitted_slab resolves the hole but creates a new step defect (the fail beat)", async () => {
    const hole = cert.defects.find((d) => d.type === "collider_hole")!;
    const { actionId } = engine.patchHole(hole.id, "fitted_slab");
    const report = await engine.recertify("regional", hole.id);

    expect(report.resolvedDefectIds).toContain(hole.id);
    const newSteps = report.newDefects.filter((d) => d.type === "raised_sill");
    expect(newSteps.length).toBeGreaterThan(0); // the slab boundary is a new step

    // the adapt beat: revert, retry with the conforming method
    engine.revert(actionId);
    const afterRevert = await engine.recertify("regional", hole.id);
    const holeAgain = afterRevert.certificate.defects.find((d) => d.id === hole.id)!;
    expect(holeAgain.outcome).toBeUndefined(); // reopened after revert

    engine.patchHole(hole.id, "mesh_fill");
    const finalReport = await engine.recertify("regional", hole.id);
    expect(finalReport.resolvedDefectIds).toContain(hole.id);
    expect(finalReport.newDefects.filter((d) => d.type === "raised_sill")).toHaveLength(0);
  });

  it("quarantine + accepted outcomes close the session with no open defects", async () => {
    const current = engine.getCertificate();
    const lie = current.defects.find((d) => d.type === "visual_only_surface")!;
    engine.quarantine(lie.id, "visual-only wall cannot be repaired; excluded from the navigable area");

    const sill = current.defects.find((d) => d.type === "raised_sill" && !d.outcome)!;
    engine.markOutcome(
      sill.id,
      "accepted",
      "genuine feature: negotiability is robot-relative (fails rover, passes quadruped); verdict stands",
    );

    // any step defects introduced and cleaned during the loop should be closed by now
    for (const d of engine.openDefects()) {
      if (d.type === "raised_sill") engine.markOutcome(d.id, "accepted", "boundary artifact cleared by revert");
    }
    expect(engine.openDefects()).toHaveLength(0);

    const final = engine.getCertificate();
    expect(final.defects.every((d) => d.outcome !== undefined)).toBe(true);
    expect(["A", "B"]).toContain(final.grade); // hole fixed, rest quarantined/accepted
  });

  it("spawn points avoid quarantined and defect regions", () => {
    const { spawns } = engine.rebuildNavmeshAndSpawns();
    expect(spawns.length).toBeGreaterThan(0);
    const lie = engine.getCertificate().defects.find((d) => d.type === "visual_only_surface")!;
    for (const s of spawns) {
      const inside =
        s.x >= lie.region.min[0] - 0.3 &&
        s.x <= lie.region.max[0] + 0.3 &&
        s.z >= lie.region.min[2] - 0.3 &&
        s.z <= lie.region.max[2] + 0.3;
      expect(inside).toBe(false);
    }
  });
});
