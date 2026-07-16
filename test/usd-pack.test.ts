/**
 * USD pack assembler regression tests (ENDGAME C8): the generated stage is
 * structurally SimReady (text-level rules), deterministic, and carries the
 * certificate's own numbers.
 */
import { describe, expect, it } from "vitest";
import { aabbOfPositions, boxTriMesh } from "../src/core/geom.js";
import type { Certificate } from "../src/core/types.js";
import { buildUsdaStage } from "../src/export/usdPack.js";
import { validateUsdaStage } from "../src/export/usdValidate.js";

const collider = boxTriMesh({ x: 5, y: 0, z: 5 }, { x: 10, y: 0.2, z: 10 });

const cert: Certificate = {
  schemaVersion: "0.1",
  worldId: "usd-test-world",
  seed: 1234,
  createdAt: "2026-07-06T00:00:00.000Z",
  gravity: { name: "moon", g: 1.62 },
  grade: "A",
  gradeRationale: "clean",
  trust: {
    cellSizeM: 0.25,
    cols: 40,
    rows: 40,
    counts: { unknown: 0, verified: 1600, observed: 0, lying: 0 },
    verifiedPct: 100,
    lyingPct: 0,
  },
  measurements: [],
  defects: [
    {
      id: "d-hole-7",
      type: "collider_hole",
      region: { min: [1, -0.3, 1], max: [2, 0.3, 2] },
      severity: "critical",
      confidence: 0.95,
      evidence: [{ kind: "probe_fallthrough", detail: "…", count: 4 }],
      description: "patched",
      outcome: "fixed",
      outcomeNote: "mesh_fill held",
    },
  ],
  robotVerdicts: [],
  scale: { vendorFactorApplied: true, vendorFactor: 1.449 },
  disclosures: ["test disclosure"],
  probeStats: {
    probesDropped: 100,
    probesRested: 100,
    probesFellThrough: 0,
    tunnelingArtifactsExcluded: 0,
    simSteps: 60,
    fixedTimestep: 1 / 60,
  },
};

const spawns = [
  { x: 5, y: 0.2, z: 5, robotId: "rover", clearanceM: 1.2 },
  { x: 7, y: 0.2, z: 3, robotId: "quadruped", clearanceM: 0.9 },
];
const quarantine = [{ region: { min: [8, 0, 8] as [number, number, number], max: [9, 2, 9] as [number, number, number] }, reason: "ghost geometry" }];

describe("USD pack assembler", () => {
  const usda = buildUsdaStage({ collider, certificate: cert, spawns, quarantine });
  const expectations = {
    colliderAabb: aabbOfPositions(collider.positions),
    pointCount: collider.positions.length / 3,
    triCount: collider.indices.length / 3,
    spawnCount: spawns.length,
    quarantineCount: quarantine.length,
    gravityMps2: cert.gravity.g,
  };

  it("passes every SimReady text rule", () => {
    const report = validateUsdaStage(usda, expectations);
    for (const r of report.rules) expect(r.pass, `${r.id}: ${r.detail}`).toBe(true);
    expect(report.pass).toBe(true);
  });

  it("is deterministic: same inputs, byte-identical stage", () => {
    expect(buildUsdaStage({ collider, certificate: cert, spawns, quarantine })).toBe(usda);
  });

  it("declares units and orientation explicitly and carries certificate provenance", () => {
    expect(usda).toContain('upAxis = "Z"');
    expect(usda).toContain("metersPerUnit = 1");
    // -90 is the film-validated source rotation (the shipped hero pack);
    // +90 was the original guess the cluster had to hand-patch (G8 history)
    expect(usda).toContain("xformOp:rotateXYZ = (-90.00000, 0, 0)");
    expect(usda).toContain('surveyorGrade = "A"');
    expect(usda).toContain("physics:gravityMagnitude = 1.62000");
    expect(usda).toContain('surveyorPatchedDefects = ["d-hole-7"]');
  });

  it("emits the measured visuals alignment nudge with provenance, and omits it when absent", () => {
    expect(usda).not.toContain("surveyorVisualsAlignBasis");
    const nudged = buildUsdaStage({
      collider,
      certificate: cert,
      spawns,
      quarantine,
      visualsAlignOffset: { x: 0, y: 0.5757, z: 0, basis: "G8 floor-face offset, measured on the composed stage" },
    });
    expect(nudged).toContain("double3 xformOp:translate = (0.00000, 0.57570, 0.00000)");
    expect(nudged).toContain('surveyorVisualsAlignBasis = "G8 floor-face offset, measured on the composed stage"');
  });

  it("does not add a root scale when the vendor factor is already applied", () => {
    expect(usda).not.toContain("xformOp:scale = (1.44900, 1.44900, 1.44900)");
    const unapplied = buildUsdaStage({
      collider,
      certificate: { ...cert, scale: { vendorFactorApplied: false, vendorFactor: 1.449 } },
      spawns,
      quarantine,
    });
    // unapplied vendor factor would make metersPerUnit a lie — it gets baked as a root scale
    expect(unapplied).toContain("xformOp:scale = (1.44900, 1.44900, 1.44900)");
  });

  it("validator catches a broken mesh", () => {
    const broken = usda.replace(/int\[\] faceVertexIndices = \[\d+/, "int[] faceVertexIndices = [999999");
    const report = validateUsdaStage(broken, expectations);
    expect(report.rules.find((r) => r.id === "mesh-integrity")?.pass).toBe(false);
  });
});
