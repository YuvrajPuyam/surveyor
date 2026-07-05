import { describe, expect, it } from "vitest";
import { certificateToIsaac } from "../src/export/isaacContract.js";
import type { Certificate } from "../src/core/types.js";

const baseCert = {
  schemaVersion: "0.1",
  worldId: "t-world",
  seed: 1,
  createdAt: "frozen",
  gravity: { name: "moon", g: 1.62 },
  grade: "A",
  gradeRationale: "",
  trust: { cellSizeM: 0.25, cols: 1, rows: 1, counts: { unknown: 0, verified: 1, observed: 0, lying: 0 }, verifiedPct: 100, lyingPct: 0 },
  measurements: [],
  defects: [],
  robotVerdicts: [],
  scale: { vendorFactorApplied: true },
  disclosures: ["d1"],
  probeStats: { probesDropped: 1, probesRested: 1, probesFellThrough: 0, tunnelingArtifactsExcluded: 0, simSteps: 1, fixedTimestep: 1 / 60 },
} as unknown as Certificate;

describe("isaac training contract", () => {
  it("carries gravity, spawns, and quarantine into the python fragment", () => {
    const { python, sidecar } = certificateToIsaac(
      baseCert,
      [{ x: 1, y: 0, z: 2, robotId: "rover", clearanceM: 0.8 }],
      [{ region: { min: [0, 0, 0], max: [1, 2, 1] }, reason: "visual lie" }],
    );
    expect(python).toContain("-1.6200");
    expect(python).toContain("(1.0000, 0.0000, 2.0000)");
    expect(python).toContain("visual lie");
    expect(sidecar.friction.static[0]).toBeCloseTo(0.6); // verified scale -> standard prior
  });

  it("widens friction and refuses spawns while scale is unverified", () => {
    const cert = {
      ...baseCert,
      defects: [{ id: "d", type: "scale_error", region: { min: [0, 0, 0], max: [1, 1, 1] }, severity: "critical", confidence: 0.8, evidence: [], description: "" }],
    } as unknown as Certificate;
    const { python, sidecar } = certificateToIsaac(cert, [], []);
    expect(sidecar.friction.basis).toMatch(/scale unverified/);
    expect(python).toContain("do not train");
  });
});
