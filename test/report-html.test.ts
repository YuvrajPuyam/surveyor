/**
 * report.html + CLI gate regression tests (ENDGAME C11).
 * The report must be fully self-contained (Ken opens it on an air-gapped
 * lab machine) and must speak the display vocabulary — never the frozen
 * internal schema word.
 */
import { describe, expect, it } from "vitest";
import { gradeGateExitCode } from "../src/cli/certifyMain.js";
import type { Certificate } from "../src/core/types.js";
import { certificateSha256, renderReportHtml } from "../src/report/reportHtml.js";

const cert: Certificate = {
  schemaVersion: "0.1",
  worldId: "test-world",
  seed: 1234,
  createdAt: "2026-07-06T00:00:00.000Z",
  gravity: { name: "moon", g: 1.62 },
  grade: "C",
  gradeRationale: "1 major, 1 minor unresolved defect(s); score 80/100.",
  trust: {
    cellSizeM: 0.25,
    cols: 40,
    rows: 40,
    counts: { unknown: 100, verified: 900, observed: 500, lying: 100 },
    verifiedPct: 60,
    lyingPct: 6.67,
  },
  measurements: [
    {
      name: "doorway_height",
      value: 2.01,
      unit: "m",
      uncertainty: { low: 1.98, high: 2.04, basis: "vertical ray quantization" },
      method: "min upward-ray headroom over doorway cells, measured from local surface",
    },
  ],
  defects: [
    {
      id: "d-phantom-0",
      type: "phantom_collider",
      region: { min: [0, 0, 0], max: [1, 2, 1] },
      severity: "major",
      confidence: 0.9,
      evidence: [{ kind: "divergence_physics_no_visual", detail: "40 samples unsupported", count: 40 }],
      description: "Collider surface with no visual counterpart.",
    },
    {
      id: "d-visual-0",
      type: "visual_only_surface",
      region: { min: [4, 0, 4], max: [5, 2, 5] },
      severity: "major",
      confidence: 0.95,
      evidence: [{ kind: "divergence_visual_no_physics", detail: "72 samples beyond the noise floor", count: 72 }],
      description: "Ghost geometry: a visual surface with no physics behind it.",
    },
    {
      id: "d-sill-0",
      type: "raised_sill",
      region: { min: [2, 0, 2], max: [3, 0.2, 3] },
      severity: "minor",
      confidence: 0.85,
      evidence: [{ kind: "floor_step_measurement", detail: "0.12 m discontinuity" }],
      description: "Raised step/sill of 0.12 m.",
      outcome: "quarantined",
      outcomeNote: "roped off",
    },
  ],
  robotVerdicts: [
    {
      robotId: "rover",
      check: "slope_capability",
      pass: true,
      requirement: "max slope 20 deg",
      gravitySensitivity: "unchanged_by_gravity",
      gravityNote: "UNCHANGED under moon gravity: slope limit is atan(mu); gravity cancels",
      defectIds: [],
    },
  ],
  scale: { vendorFactorApplied: false, vendorFactor: 1.449 },
  disclosures: [
    "Trust states cover robot-REACHABLE space only; 'observed' means no physical experiment touched the cell.",
  ],
  probeStats: {
    probesDropped: 2000,
    probesRested: 1800,
    probesFellThrough: 12,
    tunnelingArtifactsExcluded: 3,
    simSteps: 900,
    fixedTimestep: 1 / 60,
  },
};

describe("report.html", () => {
  const html = renderReportHtml(cert);

  it("is self-contained: no external requests of any kind", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script\s+src/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/url\(/);
  });

  it("speaks the display vocabulary, never the frozen schema word", () => {
    expect(html).toContain("confirmed");
    expect(html).toContain("observed");
    expect(html).toContain("divergent");
    expect(html).toContain("ghost geometry");
    expect(html).toContain("phantom collider");
    expect(html.toLowerCase()).not.toContain("lying");
  });

  it("renders the load-bearing content: grade, methods line, disclosure, denominator, hash", () => {
    expect(html).toContain(">C</div>");
    expect(html).toContain("min upward-ray headroom over doorway cells");
    expect(html).toContain("robot-REACHABLE space only");
    expect(html).toContain("1,500 surveyed cells"); // 900 + 500 + 100 known, unknown excluded
    expect(html).toContain(certificateSha256(cert));
  });

  it("is deterministic for the same certificate", () => {
    expect(renderReportHtml(cert)).toBe(html);
  });
});

describe("CLI grade gate", () => {
  it("maps grades to exit codes against --min-grade", () => {
    expect(gradeGateExitCode("A", "D")).toBe(0);
    expect(gradeGateExitCode("D", "D")).toBe(0);
    expect(gradeGateExitCode("F", "D")).toBe(3);
    expect(gradeGateExitCode("C", "B")).toBe(3);
    expect(gradeGateExitCode("B", "B")).toBe(0);
    expect(gradeGateExitCode("F", "F")).toBe(0);
  });
});
