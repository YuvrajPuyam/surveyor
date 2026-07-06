/**
 * Regression tests for the outdoor recalibration (ENDGAME C1).
 *
 * The instrument's indoor assumptions misfired on open rolling terrain:
 *  - collider "skirts" beyond the splat capture read as phantom walls,
 *  - balls that never sleep on slopes starved rest-based verification,
 *  - probes rolling off open edges read as fall-throughs.
 * The recalibration: claims only inside the splat capture envelope,
 * sustained rolling contact counts as surface confirmation, exits are
 * exits, and the phantom radius self-calibrates to the cloud's density —
 * WITHOUT losing in-envelope true positives (hole under intact pixels,
 * invisible barrier rising from a rolled floor).
 */
import { describe, expect, it } from "vitest";
import { certifyWorld } from "../src/certify/certificate.js";
import type { TriMesh } from "../src/core/geom.js";
import { boxTriMesh, mergeTriMeshes } from "../src/core/geom.js";
import { hashSeed, mulberry32 } from "../src/core/prng.js";

const FAST = { probeCount: 400, maxSettleSteps: 600 };

const SIZE = 24; // m, square footprint
const DX = 0.5; // vertex spacing
const SLOPE = Math.tan((10 * Math.PI) / 180); // 10° — rolls balls, keeps RANSAC in play
const terrainY = (x: number) => SLOPE * x;

/** Envelope region: splats cover only the central 12x12 m of a 24x24 m collider. */
const ENV_MIN = 6;
const ENV_MAX = 18;

interface OutdoorOpts {
  /** cut collider triangles inside [10,12]x[10,12] while splats keep covering it */
  hole?: boolean;
  /** stand an invisible (splat-free) barrier mid-envelope at (12, 12) */
  phantomBarrier?: boolean;
}

function makeOutdoorWorld(opts: OutdoorOpts = {}): { collider: TriMesh; visualPoints: Float32Array } {
  const n = Math.round(SIZE / DX) + 1;
  const positions = new Float32Array(n * n * 3);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = (r * n + c) * 3;
      const x = c * DX;
      const z = r * DX;
      positions[i] = x;
      positions[i + 1] = terrainY(x);
      positions[i + 2] = z;
    }
  }
  const inHole = (x: number, z: number) => x >= 10 && x <= 12 && z >= 10 && z <= 12;
  const indices: number[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const x0 = c * DX, z0 = r * DX;
      if (opts.hole && inHole(x0 + DX / 2, z0 + DX / 2)) continue;
      const a = r * n + c;
      const b = r * n + c + 1;
      const d = (r + 1) * n + c;
      const e = (r + 1) * n + c + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  let collider: TriMesh = { positions, indices: new Uint32Array(indices) };
  if (opts.phantomBarrier) {
    const bx = 12, bz = 12;
    const base = terrainY(bx);
    // 0.3 m thin, 2 m tall, 1.5 m long — rises from the rolled floor
    collider = mergeTriMeshes([collider, boxTriMesh({ x: bx, y: base + 1.0, z: bz }, { x: 0.3, y: 2.0, z: 1.5 })]);
  }

  // Splats cover ONLY the central capture region — including over the hole
  // (the floor LOOKS intact there) and never on the barrier (it is invisible).
  const rng = mulberry32(hashSeed(7, "outdoor-splats"));
  const pts: number[] = [];
  const STEP = 0.12;
  for (let x = ENV_MIN; x <= ENV_MAX; x += STEP) {
    for (let z = ENV_MIN; z <= ENV_MAX; z += STEP) {
      pts.push(x + (rng() - 0.5) * 0.02, terrainY(x) + (rng() - 0.5) * 0.02, z + (rng() - 0.5) * 0.02);
    }
  }
  return { collider, visualPoints: new Float32Array(pts) };
}

describe("outdoor recalibration (capture envelope + sustained contact)", () => {
  it("clean open terrain: no spurious defects, exits are exits, slope cells verify by rolling contact", async () => {
    const { collider, visualPoints } = makeOutdoorWorld();
    const { certificate, survey } = await certifyWorld(
      { worldId: "outdoor-clean", collider, visualPoints },
      { seed: 42, survey: FAST },
    );

    // the collider skirt beyond the splats is OUTSIDE THE SURVEYED AREA — not a defect
    expect(survey.envelope.active).toBe(true);
    expect(survey.envelope.colliderOutsideEnvelope).toBeGreaterThan(0);
    expect(certificate.defects).toHaveLength(0);
    expect(certificate.grade).toBe("A");

    // balls roll off the open edge: exits, never fall-throughs
    expect(certificate.probeStats.probesFellThrough).toBe(0);
    expect(survey.probeStats.leftSurveyedArea).toBeGreaterThan(0);

    // probe accounting is complete and disjoint
    const s = survey.probeStats;
    expect(s.probesDropped).toBe(s.probesRested + s.probesFellThrough + s.tunnelingArtifactsExcluded + s.leftSurveyedArea);

    // rest starves on a slope — sustained rolling contact must verify anyway
    expect(certificate.trust.verifiedPct).toBeGreaterThan(10);
    expect(certificate.trust.lyingPct).toBeLessThan(5);

    // the certificate SAYS what it excluded
    expect(certificate.disclosures.some((d) => d.includes("Capture envelope"))).toBe(true);
    expect(certificate.disclosures.some((d) => d.includes("exited the surveyed area"))).toBe(true);
  });

  it("hole under intact pixels INSIDE the envelope is still found", async () => {
    const { collider, visualPoints } = makeOutdoorWorld({ hole: true });
    const { certificate } = await certifyWorld(
      { worldId: "outdoor-hole", collider, visualPoints },
      { seed: 42, survey: FAST },
    );
    const holes = certificate.defects.filter((d) => d.type === "collider_hole");
    expect(holes.length).toBeGreaterThan(0);
    // the detected region overlaps the planted patch [10,12]x[10,12]
    const hit = holes.some(
      (d) => d.region.min[0] <= 12.5 && d.region.max[0] >= 9.5 && d.region.min[2] <= 12.5 && d.region.max[2] >= 9.5,
    );
    expect(hit).toBe(true);
  });

  it("invisible barrier rising from rolled terrain INSIDE the envelope is still found", async () => {
    const { collider, visualPoints } = makeOutdoorWorld({ phantomBarrier: true });
    const { certificate } = await certifyWorld(
      { worldId: "outdoor-phantom", collider, visualPoints },
      { seed: 42, survey: FAST },
    );
    const phantoms = certificate.defects.filter((d) => d.type === "phantom_collider");
    expect(phantoms.length).toBeGreaterThan(0);
    const hit = phantoms.some(
      (d) => d.region.min[0] <= 12.6 && d.region.max[0] >= 11.4 && d.region.min[2] <= 13.2 && d.region.max[2] >= 10.8,
    );
    expect(hit).toBe(true);
  });
});
