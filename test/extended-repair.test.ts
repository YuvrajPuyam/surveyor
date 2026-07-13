import { describe, expect, it } from "vitest";
import { analyzeFloaters, removeFloaters } from "../src/certify/extended.js";
import { DEFAULT_SURVEY, runSurvey } from "../src/certify/survey.js";
import { buildHabitat } from "../src/ingest/synthetic.js";
import { meshHygiene } from "../src/repair/meshHygiene.js";

const FAST = { ...DEFAULT_SURVEY, probeCount: 400, maxSettleSteps: 600 };

describe("mesh hygiene", () => {
  it("welds coincident vertices, drops degenerate and duplicate triangles, keeps the rest", () => {
    // two good triangles + one degenerate (repeated vertex) + one duplicate
    // (same vertex set, other winding) + a vertex pair 0.01 mm apart
    const positions = new Float32Array([
      0, 0, 0, //  0
      1, 0, 0, //  1
      0, 0, 1, //  2
      1, 0, 1, //  3
      1, 0, 1.00000001, // 4 — coincident with 3 at weld eps
    ]);
    const indices = new Uint32Array([
      0, 1, 2, // good
      1, 3, 2, // good
      1, 1, 2, // degenerate: repeated vertex
      2, 1, 0, // duplicate of the first (reverse winding)
      1, 4, 2, // duplicate of the second AFTER welding 4 -> 3
    ]);
    const { mesh, report } = meshHygiene({ positions, indices });
    expect(report.trianglesBefore).toBe(5);
    expect(report.trianglesAfter).toBe(2);
    expect(report.degenerateRemoved).toBe(1);
    expect(report.duplicateRemoved).toBe(2);
    expect(report.verticesAfter).toBe(4); // vertex 4 welded away
    expect(mesh.indices.length).toBe(6);
  });

  it("leaves an already-clean mesh untouched", () => {
    const world = buildHabitat({ worldId: "h-clean-mesh" });
    const { report } = meshHygiene(world.collider);
    expect(report.degenerateRemoved).toBe(0);
    expect(report.duplicateRemoved).toBe(0);
    expect(report.trianglesAfter).toBe(report.trianglesBefore);
  });
});

describe("floater removal", () => {
  it("removes exactly the injected cluster and the census reads clean afterwards", async () => {
    const world = buildHabitat({ worldId: "h-defloat" });
    const cluster: number[] = [];
    for (let i = 0; i < 30; i++) {
      cluster.push(2 + 0.2 * Math.sin(i * 1.7), 1.8 + 0.2 * Math.cos(i * 2.3), 2 + 0.2 * Math.sin(i * 0.9));
    }
    const dirty = new Float32Array(world.visualPoints.length + cluster.length);
    dirty.set(world.visualPoints);
    dirty.set(cluster, world.visualPoints.length);

    const survey = await runSurvey(world.collider, dirty, FAST);
    expect(analyzeFloaters(dirty, survey).floaters.length).toBeGreaterThanOrEqual(1);

    const fixed = removeFloaters(dirty, undefined, survey);
    expect(fixed.pointsRemoved).toBe(30);
    expect(fixed.clustersRemoved).toBeGreaterThanOrEqual(1);
    expect(fixed.points.length).toBe(world.visualPoints.length);

    // the cleaned evidence certifies floater-free (fresh survey on cleaned points)
    const survey2 = await runSurvey(world.collider, fixed.points, FAST);
    expect(analyzeFloaters(fixed.points, survey2).floaters.length).toBe(0);
  });

  it("is a no-op on clean evidence (returns the same arrays)", async () => {
    const world = buildHabitat({ worldId: "h-noop" });
    const survey = await runSurvey(world.collider, world.visualPoints, FAST);
    const fixed = removeFloaters(world.visualPoints, undefined, survey);
    expect(fixed.pointsRemoved).toBe(0);
    expect(fixed.points).toBe(world.visualPoints);
  });
});
