/**
 * apply_vendor_scale must carry the defect ledger with the transform: after
 * scaling, identity matching still works, the scale defect resolves, and the
 * ledger does NOT balloon with re-discovered duplicates at new coordinates.
 */
import { describe, expect, it } from "vitest";
import { RepairEngine } from "../src/repair/engine.js";
import { buildHabitat } from "../src/ingest/synthetic.js";

describe("apply_vendor_scale ledger coherence", () => {
  it("scales regions with the world; scale defect resolves; no duplicate ledger entries", async () => {
    const world = buildHabitat({ worldId: "t-scale-repair", scaleError: 2 });
    const engine = new RepairEngine(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
      { probeCount: 500 },
    );
    const baseline = await engine.init();
    const baselineCount = baseline.defects.length;
    expect(baseline.defects.some((d) => d.type === "scale_error")).toBe(true);

    const { factorApplied } = engine.applyVendorScale();
    expect(factorApplied).toBeCloseTo(0.5, 5);

    const report = await engine.recertify("full");
    const scaleDefect = report.certificate.defects.find((d) => d.type === "scale_error")!;
    expect(scaleDefect.outcome).toBe("fixed");
    // no coordinate-shift double counting: ledger grows by at most a couple
    // of genuinely new findings, not by a re-discovered copy of everything
    expect(report.certificate.defects.length).toBeLessThanOrEqual(baselineCount + 2);
    // the world should now grade well: it was a clean habitat, just mis-scaled
    expect(["A", "B"]).toContain(report.certificate.grade);
  });
});
