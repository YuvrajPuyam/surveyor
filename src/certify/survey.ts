/**
 * The survey: seeded probe rain + virtual-LiDAR raycast grid + two-way
 * splat-vs-collider divergence. Produces the raw evidence every downstream
 * module (trust map, metrology, defects) consumes.
 *
 * Honesty invariant: a probe falling through the floor is only ever reported
 * as a collider hole if an independent raycast at the same (x,z) ALSO passes
 * through — engine tunneling can never masquerade as a hole.
 */
import type { Aabb, TriMesh } from "../core/geom.js";
import { aabbOfPositions, sampleMeshSurface } from "../core/geom.js";
import { Grid2D } from "../core/grid.js";
import { PointHash } from "../core/pointhash.js";
import { hashSeed, mulberry32 } from "../core/prng.js";
import { FIXED_DT, initRapier, PhysicsWorld } from "../physics/rapierWorld.js";

export interface SurveyOptions {
  seed: number;
  gravityMps2: number;
  probeCount: number;
  probeRadius: number;
  /** coarse trust-map cell size */
  cellSize: number;
  /** fine raycast/occupancy cell size */
  rayCellSize: number;
  maxSettleSteps: number;
  /** visual point flagged as "physics missing" beyond this distance to any collider */
  divergenceThresholdM: number;
}

export const DEFAULT_SURVEY: SurveyOptions = {
  seed: 1234,
  gravityMps2: 9.81,
  probeCount: 2000,
  probeRadius: 0.05,
  cellSize: 0.25,
  rayCellSize: 0.1,
  maxSettleSteps: 900, // 15 s at 60 Hz
  divergenceThresholdM: 0.15,
};

export interface SurveyResult {
  aabb: Aabb;
  /** coarse grid: probeContact, fallConfirmed, visualPts, visualNoPhys, physNoVisual */
  trustGrid: Grid2D;
  /** fine grid: hasHit, surfaceY, headroom (999 = open) */
  rayGrid: Grid2D;
  probeStats: {
    probesDropped: number;
    probesRested: number;
    probesFellThrough: number;
    tunnelingArtifactsExcluded: number;
    simSteps: number;
    fixedTimestep: number;
    stepsPerSecond: number;
  };
  divergence: {
    visualPointsChecked: number;
    visualNoPhysCount: number;
    colliderSamplesChecked: number;
    physNoVisualCount: number;
  };
}

export async function runSurvey(
  collider: TriMesh,
  visualPoints: Float32Array,
  opts: SurveyOptions,
): Promise<SurveyResult> {
  await initRapier();
  const pw = new PhysicsWorld(opts.gravityMps2);
  pw.addStaticTriMesh(collider);
  pw.step(); // one step so the query pipeline indexes the static collider before raycasting

  const aabb = aabbOfPositions(collider.positions);
  const trustGrid = new Grid2D(aabb, opts.cellSize);
  const rayGrid = new Grid2D(aabb, opts.rayCellSize);
  const topY = aabb.max.y + 0.5;
  const worldHeight = aabb.max.y - aabb.min.y;

  // ---------------------------------------------------- virtual LiDAR grid
  // Multi-hit profile per column. The walkable surface is the LOWEST
  // upward-facing hit with at least 0.5 m of headroom to the next
  // downward-facing surface above it — this sees under doorway headers.
  const hasHit = rayGrid.channel("hasHit");
  const surfaceY = rayGrid.channel("surfaceY");
  const headroom = rayGrid.channel("headroom");
  for (let i = 0; i < rayGrid.size; i++) {
    const [x, z] = rayGrid.center(i);
    const profile = pw.castDownProfile(x, topY, z, worldHeight + 1.0);
    if (profile.length === 0) {
      surfaceY[i] = NaN;
      headroom[i] = 999;
      continue;
    }
    hasHit[i] = 1;
    // Crossing parity: descending from open sky, surfaces alternate
    // enter-solid / exit-solid. Even-indexed hits are top faces (air above,
    // solid below) — the only standable candidates. Rapier flips trimesh
    // normals toward the ray, so parity, not normals, carries orientation.
    let walkY = NaN;
    let walkHead = 999;
    for (let k = 0; k < profile.length; k += 2) {
      const head = k === 0 ? 999 : profile[k - 1].y - profile[k].y;
      if (head < 0.5) continue; // crawl space / slab interior — not standable
      if (Number.isNaN(walkY) || profile[k].y < walkY) {
        walkY = profile[k].y;
        walkHead = head;
      }
    }
    if (Number.isNaN(walkY)) {
      // no standable surface in this column (solid wall) — report the top
      surfaceY[i] = profile[0].y;
      headroom[i] = 999;
    } else {
      surfaceY[i] = walkY;
      headroom[i] = walkHead;
    }
  }

  // -------------------------------------------------------- probe rain
  const rng = mulberry32(hashSeed(opts.seed, "probe-rain"));
  const inset = opts.probeRadius * 2;
  const spanX = aabb.max.x - aabb.min.x - 2 * inset;
  const spanZ = aabb.max.z - aabb.min.z - 2 * inset;
  const perRow = Math.ceil(Math.sqrt(opts.probeCount * (spanX / Math.max(spanZ, 1e-6))));
  const rows = Math.ceil(opts.probeCount / perRow);

  const probes: { body: import("@dimforge/rapier3d-compat").RigidBody; dropX: number; dropZ: number }[] = [];
  let n = 0;
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow; c++) {
      if (n >= opts.probeCount) break outer;
      const jx = (rng() - 0.5) * (spanX / perRow);
      const jz = (rng() - 0.5) * (spanZ / rows);
      const x = aabb.min.x + inset + ((c + 0.5) / perRow) * spanX + jx;
      const z = aabb.min.z + inset + ((r + 0.5) / rows) * spanZ + jz;
      // stagger drop height slightly so probes don't start interpenetrating
      const y = topY + 0.2 + rng() * 0.4;
      probes.push({ body: pw.spawnProbe({ x, y, z }, opts.probeRadius), dropX: x, dropZ: z });
      n++;
    }
  }

  const killY = aabb.min.y - 0.5;
  const t0 = performance.now();
  let steps = 0;
  for (; steps < opts.maxSettleSteps; steps++) {
    pw.step();
    if (steps % 60 === 59) {
      let active = 0;
      for (const p of probes) {
        const y = p.body.translation().y;
        if (y > killY && !p.body.isSleeping()) active++;
      }
      if (active === 0) {
        steps++;
        break;
      }
    }
  }
  const elapsed = (performance.now() - t0) / 1000;

  let rested = 0;
  let fell = 0;
  let artifacts = 0;
  for (const p of probes) {
    const pos = p.body.translation();
    if (pos.y < killY) {
      fell++;
      // cross-check: does an independent ray at the drop point also pass through?
      const ray = pw.castDown(p.dropX, topY, p.dropZ, worldHeight + 1.0);
      if (ray) {
        artifacts++; // engine tunneling — surface exists; excluded from hole evidence
      } else {
        trustGrid.add("fallConfirmed", p.dropX, p.dropZ);
      }
    } else {
      rested++;
      trustGrid.add("probeContact", pos.x, pos.z);
    }
  }

  // ------------------------------------------- divergence, both directions
  const threshold = opts.divergenceThresholdM;
  let visualNoPhys = 0;
  for (let i = 0; i < visualPoints.length; i += 3) {
    const x = visualPoints[i], y = visualPoints[i + 1], z = visualPoints[i + 2];
    trustGrid.add("visualPts", x, z);
    const d = pw.distanceToCollider({ x, y, z });
    if (d > threshold) {
      visualNoPhys++;
      trustGrid.add("visualNoPhys", x, z);
    }
  }

  const sampleRng = mulberry32(hashSeed(opts.seed, "collider-samples"));
  const colliderSamples = sampleMeshSurface(collider, 30, sampleRng);
  const visualHash = new PointHash(visualPoints, 0.25);
  let physNoVisual = 0;
  const nearRadius = 0.2;
  for (let i = 0; i < colliderSamples.length; i += 3) {
    const x = colliderSamples[i], y = colliderSamples[i + 1], z = colliderSamples[i + 2];
    const d2 = visualHash.nearestDist2(x, y, z, nearRadius);
    if (d2 > nearRadius * nearRadius) {
      physNoVisual++;
      trustGrid.add("physNoVisual", x, z);
    }
  }

  pw.free();

  return {
    aabb,
    trustGrid,
    rayGrid,
    probeStats: {
      probesDropped: probes.length,
      probesRested: rested,
      probesFellThrough: fell,
      tunnelingArtifactsExcluded: artifacts,
      simSteps: steps,
      fixedTimestep: FIXED_DT,
      stepsPerSecond: elapsed > 0 ? steps / elapsed : 0,
    },
    divergence: {
      visualPointsChecked: visualPoints.length / 3,
      visualNoPhysCount: visualNoPhys,
      colliderSamplesChecked: colliderSamples.length / 3,
      physNoVisualCount: physNoVisual,
    },
  };
}
