/**
 * Regression tests for adversarial-review findings 3–6 (docs/review-triage-todo.md).
 * Three of the four are outdoor-terrain failure mechanisms the walled indoor
 * bench can never exercise: uniformly sloped worlds (no near-horizontal RANSAC
 * consensus), open world edges (probes roll off), and unsurveyable geometry.
 */
import { describe, expect, it } from "vitest";
import { certifyWorld } from "../src/certify/certificate.js";
import type { TriMesh, Vec3 } from "../src/core/geom.js";
import { boxTriMesh, mergeTriMeshes, sampleMeshSurface } from "../src/core/geom.js";
import { hashSeed, mulberry32 } from "../src/core/prng.js";
import { CertificateSchema } from "../src/core/types.js";
import { buildHabitat } from "../src/ingest/synthetic.js";

const FAST = { probeCount: 400, maxSettleSteps: 600 };

function transform(mesh: TriMesh, f: (p: Vec3) => Vec3): TriMesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const q = f({ x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
    positions[i] = q.x;
    positions[i + 1] = q.y;
    positions[i + 2] = q.z;
  }
  return { positions, indices: mesh.indices };
}

/** 10x10 m plate tilted `deg` about Z — a world that is ALL slope. */
function tiltedPlate(deg: number): { collider: TriMesh; visualPoints: Float32Array } {
  const t = (deg * Math.PI) / 180;
  const collider = transform(boxTriMesh({ x: 0, y: 0, z: 0 }, { x: 10, y: 0.1, z: 10 }), (p) => ({
    x: p.x * Math.cos(t) - p.y * Math.sin(t),
    y: p.x * Math.sin(t) + p.y * Math.cos(t),
    z: p.z,
  }));
  const visualPoints = sampleMeshSurface(collider, 60, mulberry32(hashSeed(1234, "tilted-plate")));
  return { collider, visualPoints };
}

/**
 * Open-edged terrain: a 6x6 m flat apron joined to a 10°-descending ramp that
 * ends at the world edge (x=10). Probes rest on the apron (seeding the claim
 * zone all the way down the ramp) while probes on the ramp roll off the open
 * edge — the moon/canyon failure shape in miniature.
 */
function openEdgeTerrain(): { collider: TriMesh; visualPoints: Float32Array } {
  const t = (10 * Math.PI) / 180;
  const run = 4; // ramp covers x 6..10
  const drop = run * Math.tan(t);
  const len = run / Math.cos(t);
  const flat = boxTriMesh({ x: 3, y: -0.05, z: 3 }, { x: 6, y: 0.1, z: 6 });
  const ramp = transform(boxTriMesh({ x: 0, y: 0, z: 0 }, { x: len, y: 0.1, z: 6 }), (p) => {
    // rotate -10° about Z (+x end tips down), translate so the top face runs (6,0) → (10,-drop)
    const x = p.x * Math.cos(t) + p.y * Math.sin(t);
    const y = -p.x * Math.sin(t) + p.y * Math.cos(t);
    return { x: x + 8 - 0.05 * Math.sin(t), y: y - drop / 2 - 0.05 * Math.cos(t), z: p.z + 3 };
  });
  const collider = mergeTriMeshes([flat, ramp]);
  const visualPoints = sampleMeshSurface(collider, 60, mulberry32(hashSeed(1234, "open-edge")));
  return { collider, visualPoints };
}

describe("review findings 3-6", () => {
  it("finding 3: uniformly sloped world gets a finite fallback plane and an honest tilt — no NaN, no false slope pass", async () => {
    const world = tiltedPlate(25);
    const { certificate } = await certifyWorld(
      { worldId: "t-slope-25", collider: world.collider, visualPoints: world.visualPoints },
      { survey: FAST },
    );
    // schema-valid end to end (Zod rejects NaN — this sweeps every number)
    CertificateSchema.parse(certificate);
    const floor = certificate.measurements.find((m) => m.name === "floor_plane_height")!;
    expect(Number.isFinite(floor.value)).toBe(true);
    expect(Number.isFinite(floor.uncertainty.low)).toBe(true);
    expect(floor.method).toContain("least-squares slope-plane");
    // the slope verdict sees the real tilt: fails the rover (20°), passes the quadruped (30°)
    const slope = (robot: string) =>
      certificate.robotVerdicts.find((v) => v.robotId === robot && v.check === "slope_capability")!;
    expect(slope("rover").measured!.value).toBeGreaterThan(22);
    expect(slope("rover").measured!.value).toBeLessThan(28);
    expect(slope("rover").pass).toBe(false);
    expect(slope("quadruped").pass).toBe(true);
  });

  it("finding 3 sibling: an unsurveyable world grades F with the reason disclosed instead of crashing", async () => {
    const cube = boxTriMesh({ x: 0, y: 0, z: 0 }, { x: 0.25, y: 0.25, z: 0.25 });
    const visualPoints = sampleMeshSurface(cube, 60, mulberry32(hashSeed(1234, "tiny-cube")));
    const { certificate } = await certifyWorld(
      { worldId: "t-unsurveyable", collider: cube, visualPoints },
      { survey: FAST },
    );
    CertificateSchema.parse(certificate);
    expect(certificate.grade).toBe("F");
    expect(certificate.gradeRationale).toContain("Unsurveyable");
    expect(certificate.defects).toHaveLength(0);
    expect(certificate.robotVerdicts).toHaveLength(0);
    expect(certificate.disclosures.some((d) => d.startsWith("UNSURVEYABLE"))).toBe(true);
  });

  it("finding 5: the cell budget coarsens the grid instead of over-allocating, and the certificate discloses it", async () => {
    const world = buildHabitat({ worldId: "t-coarse" });
    const result = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { survey: { ...FAST, maxGridCells: 2000 } },
    );
    CertificateSchema.parse(result.certificate);
    // habitat footprint 10x8 m: 0.1 m ray cells would be 8000 > 2000 → ~0.2 m
    expect(result.survey.rayGrid.cellSize).toBeGreaterThan(0.15);
    expect(result.survey.rayGrid.size).toBeLessThanOrEqual(2000 + result.survey.rayGrid.cols);
    expect(result.certificate.disclosures.some((d) => d.startsWith("Grid coarsened"))).toBe(true);
  });

  it("finding 6: probes rolling off an open world edge are never recorded as fall-throughs on the rim", async () => {
    const world = openEdgeTerrain();
    const result = await certifyWorld(
      { worldId: "t-open-edge", collider: world.collider, visualPoints: world.visualPoints },
      { survey: FAST },
    );
    CertificateSchema.parse(result.certificate);
    // solid terrain: nothing fell through claimed geometry, so zero confirmed
    // falls and zero divergent cells — even though ramp probes left the world
    const fall = result.survey.trustGrid.channel("fallConfirmed");
    let confirmed = 0;
    for (let i = 0; i < result.survey.trustGrid.size; i++) confirmed += fall[i];
    expect(confirmed).toBe(0);
    expect(result.certificate.trust.counts.lying).toBe(0);
    expect(result.certificate.defects.filter((d) => d.type === "collider_hole")).toHaveLength(0);
  });
});
