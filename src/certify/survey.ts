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
  /**
   * Cap on cells per survey grid. A mis-scaled export (the scale-defect class
   * itself, e.g. centimeter units read as meters) would otherwise allocate
   * hundreds of millions of cells before the scale defect could ever be
   * synthesized. Above the cap the cell size coarsens proportionally; the
   * certificate discloses the coarser detection floor.
   */
  maxGridCells?: number;
  /**
   * Regional re-certification: concentrate the probe rain over this AABB
   * (expanded margin included by the caller). Rays and divergence stay
   * world-wide — they are cheap and catch global regressions.
   */
  focusRegion?: { min: { x: number; z: number }; max: { x: number; z: number } };
}

const MAX_GRID_CELLS_DEFAULT = 1_500_000;

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
    /** self-calibrated lie threshold: p99 x 1.5 of splat-to-collider distance on probe-verified cells */
    noiseFloorM: number;
    noiseFloorCalibrated: boolean;
  };
}

export async function runSurvey(
  collider: TriMesh,
  visualPoints: Float32Array,
  opts: SurveyOptions,
  /** optional per-splat max Gaussian scale (length = points/3), from SPZ */
  visualScales?: Float32Array,
): Promise<SurveyResult> {
  await initRapier();
  const pw = new PhysicsWorld(opts.gravityMps2);
  pw.addStaticTriMesh(collider);
  pw.step(); // one step so the query pipeline indexes the static collider before raycasting

  const aabb = aabbOfPositions(collider.positions);
  const extentX = aabb.max.x - aabb.min.x;
  const extentZ = aabb.max.z - aabb.min.z;
  const maxCells = opts.maxGridCells ?? MAX_GRID_CELLS_DEFAULT;
  const guardedCell = (requested: number): number => {
    const cells = Math.ceil(extentX / requested) * Math.ceil(extentZ / requested);
    return cells <= maxCells ? requested : Math.sqrt((extentX * extentZ) / maxCells);
  };
  const cellSize = guardedCell(opts.cellSize);
  const rayCellSize = guardedCell(opts.rayCellSize);
  const trustGrid = new Grid2D(aabb, cellSize);
  const rayGrid = new Grid2D(aabb, rayCellSize);
  const topY = aabb.max.y + 0.5;
  const worldHeight = aabb.max.y - aabb.min.y;

  // ------------------------------------------------ inspectable domain
  // Real colliders are open shells with NO exterior geometry: everything
  // outside the modeled rooms is void. The instrument only makes claims
  // where the world claims to exist — columns with collider hits or visual
  // support. Probing the void outside and calling it "lying" would be the
  // instrument inspecting empty space.
  const visualRayCells = rayGrid.channel("visualPts");
  for (let i = 0; i < visualPoints.length; i += 3) {
    const x = visualPoints[i], z = visualPoints[i + 2];
    // grid indexing clamps to the border — filter background scenery so it
    // can't pile up on edge cells and read as world coverage
    if (x < aabb.min.x - 0.25 || x > aabb.max.x + 0.25 || z < aabb.min.z - 0.25 || z > aabb.max.z + 0.25) continue;
    trustGrid.add("visualPts", x, z);
    visualRayCells[rayGrid.index(x, z)]++;
  }

  // ---------------------------------------------------- virtual LiDAR grid
  // Multi-hit profile per column. Walkable surface: the LOWEST hit with
  // >= 0.5 m of open gap above it, confirmed free by a projection query
  // (a point 0.4 m above a standable surface is far from any geometry; a
  // point inside a solid wall or slab is not). Works for open shells and
  // closed solids alike — crossing parity does not, and Rapier flips
  // trimesh normals toward the ray, so neither carries orientation.
  const hasHit = rayGrid.channel("hasHit");
  const surfaceY = rayGrid.channel("surfaceY");
  const headroom = rayGrid.channel("headroom");
  const domain = rayGrid.channel("domain");
  const standable = rayGrid.channel("standable");
  for (let i = 0; i < rayGrid.size; i++) {
    const [x, z] = rayGrid.center(i);
    const profile = pw.castDownProfile(x, topY, z, worldHeight + 1.0);
    if (visualRayCells[i] > 0 || profile.length > 0) domain[i] = 1;
    if (profile.length === 0) {
      surfaceY[i] = NaN;
      headroom[i] = 999;
      continue;
    }
    hasHit[i] = 1;
    // dedupe coincident faces (coplanar slab tops/bottoms)
    const hits: number[] = [];
    for (const h of profile) {
      if (hits.length === 0 || Math.abs(hits[hits.length - 1] - h.y) > 0.02) hits.push(h.y);
    }
    let walkY = NaN;
    let walkHead = 999;
    for (let k = hits.length - 1; k >= 0; k--) {
      const gapAbove = k === 0 ? 999 : hits[k - 1] - hits[k];
      if (gapAbove < 0.5) continue;
      const free = pw.distanceToCollider({ x, y: hits[k] + 0.4, z });
      if (free < 0.25) continue; // inside a solid, or hard against geometry
      walkY = hits[k];
      walkHead = gapAbove;
      break; // lowest standable wins
    }
    if (Number.isNaN(walkY)) {
      // no standable surface in this column (wall) — report the top
      surfaceY[i] = hits[0];
      headroom[i] = 999;
    } else {
      surfaceY[i] = walkY;
      headroom[i] = walkHead;
      standable[i] = 1;
    }
  }

  // -------------------------------------------------------- probe rain
  const rng = mulberry32(hashSeed(opts.seed, "probe-rain"));
  const inset = opts.probeRadius * 2;
  const rainMinX = opts.focusRegion ? Math.max(aabb.min.x, opts.focusRegion.min.x) : aabb.min.x;
  const rainMaxX = opts.focusRegion ? Math.min(aabb.max.x, opts.focusRegion.max.x) : aabb.max.x;
  const rainMinZ = opts.focusRegion ? Math.max(aabb.min.z, opts.focusRegion.min.z) : aabb.min.z;
  const rainMaxZ = opts.focusRegion ? Math.min(aabb.max.z, opts.focusRegion.max.z) : aabb.max.z;
  const spanX = rainMaxX - rainMinX - 2 * inset;
  const spanZ = rainMaxZ - rainMinZ - 2 * inset;
  const perRow = Math.ceil(Math.sqrt(opts.probeCount * (spanX / Math.max(spanZ, 1e-6))));
  const rows = Math.ceil(opts.probeCount / perRow);

  // Probes spawn INSIDE the inhabitable volume, just under the local ceiling
  // (real worlds have roofs — probes dropped from above the AABB would test
  // the roof, not the floor). Probes go only where a floor claim exists:
  // standable columns, and void columns whose splats are FLOOR-LIKE
  // (concentrated at floor height — the signature of a hole under intact
  // pixels). Void beyond the walls gets no probes: the instrument does not
  // inspect empty space and call it a defect.
  // Interior floors sit under ceilings; roof tops sit under sky. When enough
  // standable columns have finite headroom, those are the interior — without
  // this, a shell roof spanning the whole footprint out-populates the floor.
  const allStandable: number[] = [];
  const interiorStandable: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (!standable[i]) continue;
    allStandable.push(surfaceY[i]);
    if (headroom[i] < 990) interiorStandable.push(surfaceY[i]);
  }
  const floorHeights =
    interiorStandable.length >= 0.15 * allStandable.length ? interiorStandable : allStandable;
  floorHeights.sort((a, b) => a - b);
  const floorEst = floorHeights.length > 0 ? floorHeights[Math.floor(floorHeights.length * 0.2)] : aabb.min.y;

  // Local floor height per column: real floors slope and step (this world's
  // floor rises 0.8 m along the corridor). Each cell's floor reference is its
  // own walkable surface, or the nearest standable cell's within ~0.6 m, or
  // the global p20 estimate as a last resort. Computed by multi-source BFS.
  const localFloorY = rayGrid.channel("localFloorY");
  {
    const dist = new Int32Array(rayGrid.size).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < rayGrid.size; i++) {
      if (standable[i]) {
        localFloorY[i] = surfaceY[i];
        dist[i] = 0;
        queue.push(i);
      } else {
        localFloorY[i] = floorEst;
      }
    }
    let head = 0;
    const maxDepth = Math.round(0.6 / rayCellSize);
    while (head < queue.length) {
      const i = queue[head++];
      if (dist[i] >= maxDepth) continue;
      const [c, r] = rayGrid.colRow(i);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= rayGrid.cols || nr < 0 || nr >= rayGrid.rows) continue;
        const ni = nr * rayGrid.cols + nc;
        if (dist[ni] === -1) {
          dist[ni] = dist[i] + 1;
          localFloorY[ni] = localFloorY[i];
          queue.push(ni);
        }
      }
    }
  }

  // per-column visual height profile: total vs floor-band counts, smoothed
  // over a ±0.25 m window so sparse point clouds don't fragment coverage
  const visualBandRaw = new Float64Array(rayGrid.size);
  const visualTotalRaw = new Float64Array(rayGrid.size);
  for (let i = 0; i < visualPoints.length; i += 3) {
    const x = visualPoints[i], y = visualPoints[i + 1], z = visualPoints[i + 2];
    if (x < aabb.min.x - 0.25 || x > aabb.max.x + 0.25 || z < aabb.min.z - 0.25 || z > aabb.max.z + 0.25) continue;
    const idx = rayGrid.index(x, z);
    visualTotalRaw[idx]++;
    if (Math.abs(y - localFloorY[idx]) < 0.35) visualBandRaw[idx]++;
  }
  const visualBand = rayGrid.channel("visualFloorBand");
  const visualTotal = rayGrid.channel("visualTotal");
  const win = Math.max(1, Math.round(0.25 / rayCellSize));
  for (let r = 0; r < rayGrid.rows; r++) {
    for (let c = 0; c < rayGrid.cols; c++) {
      let band = 0;
      let total = 0;
      for (let dr = -win; dr <= win; dr++) {
        for (let dc = -win; dc <= win; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rayGrid.rows || cc < 0 || cc >= rayGrid.cols) continue;
          band += visualBandRaw[rr * rayGrid.cols + cc];
          total += visualTotalRaw[rr * rayGrid.cols + cc];
        }
      }
      const i = r * rayGrid.cols + c;
      visualBand[i] = band;
      visualTotal[i] = total;
    }
  }

  // Density calibration: a floor CLAIM must be about as splat-dense as real
  // floors in this world. Hallucinated fuzz beyond the walls is diffuse —
  // orders of magnitude sparser than actual surfaces — and must not draw
  // probes. Baseline: median floor-band density over standable columns.
  const standableBands: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (standable[i] && visualBand[i] > 0) standableBands.push(visualBand[i]);
  }
  standableBands.sort((a, b) => a - b);
  const medianFloorBand = standableBands.length > 0 ? standableBands[Math.floor(standableBands.length / 2)] : 0;
  const floorClaimThreshold = Math.max(2, 0.25 * medianFloorBand);

  const dropHeightAt = (x: number, z: number): number | null => {
    const i = rayGrid.index(x, z);
    if (standable[i]) {
      const head = headroom[i];
      const rise = head >= 990 ? 2.0 : Math.min(Math.max(head - 0.15, 0.3), 2.0);
      return surfaceY[i] + rise;
    }
    if (
      !hasHit[i] &&
      visualBand[i] >= floorClaimThreshold &&
      visualBand[i] / Math.max(1, visualTotal[i]) >= 0.3
    ) {
      return floorEst + 1.2; // floor-claiming void: the probe falls through the candidate hole
    }
    return null; // wall column, roof-only column, or fuzz/void outside the world
  };

  const probes: {
    body: import("@dimforge/rapier3d-compat").RigidBody;
    dropX: number;
    dropY: number;
    dropZ: number;
  }[] = [];
  let n = 0;
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow; c++) {
      if (n >= opts.probeCount) break outer;
      const jx = (rng() - 0.5) * (spanX / perRow);
      const jz = (rng() - 0.5) * (spanZ / rows);
      const x = rainMinX + inset + ((c + 0.5) / perRow) * spanX + jx;
      const z = rainMinZ + inset + ((r + 0.5) / rows) * spanZ + jz;
      const drop = dropHeightAt(x, z);
      n++; // grid slot consumed either way, so density stays uniform over the domain
      if (drop === null) continue;
      // small stagger so probes don't start interpenetrating
      const y = drop + rng() * 0.15;
      probes.push({ body: pw.spawnProbe({ x, y, z }, opts.probeRadius), dropX: x, dropY: y, dropZ: z });
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

  // ------------------------------------------------- reachability mask
  // The certificate makes claims about space a robot can REACH. Flood-fill
  // from physics-verified cells (where probes rested) across standable
  // columns; walls (non-standable) bound the fill; doorway gaps let it
  // through to adjacent rooms. Dilate by 0.3 m so holes at the floor edge
  // and doorway thresholds stay in scope. Dense splat fuzz beyond the walls
  // is unreachable and stops counting as evidence.
  const reachable = rayGrid.channel("reachable");
  {
    const queue: number[] = [];
    for (const p of probes) {
      const pos = p.body.translation();
      if (pos.y >= killY) {
        const i = rayGrid.index(pos.x, pos.z);
        if (standable[i] && !reachable[i]) {
          reachable[i] = 1;
          queue.push(i);
        }
      }
    }
    while (queue.length) {
      const i = queue.pop()!;
      const [c, r] = rayGrid.colRow(i);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= rayGrid.cols || nr < 0 || nr >= rayGrid.rows) continue;
        const ni = nr * rayGrid.cols + nc;
        if (!reachable[ni] && standable[ni]) {
          reachable[ni] = 1;
          queue.push(ni);
        }
      }
    }
  }
  // dilated claim zone (evidence within 0.3 m of reachable space counts)
  const claimZone = rayGrid.channel("claimZone");
  {
    const rad = Math.max(1, Math.round(0.3 / rayCellSize));
    for (let r = 0; r < rayGrid.rows; r++) {
      for (let c = 0; c < rayGrid.cols; c++) {
        if (!reachable[r * rayGrid.cols + c]) continue;
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= rayGrid.rows || cc < 0 || cc >= rayGrid.cols) continue;
            claimZone[rr * rayGrid.cols + cc] = 1;
          }
        }
      }
    }
  }
  const inClaimZone = (x: number, z: number) => claimZone[rayGrid.index(x, z)] > 0;

  // ------------------------------------------- probe outcome classification
  let rested = 0;
  let fell = 0;
  let artifacts = 0;
  for (const p of probes) {
    const pos = p.body.translation();
    if (pos.y < killY) {
      fell++;
      // cross-check at the probe's EXIT column (it may have rolled before
      // falling), from its drop height — casting from above the AABB would
      // hit the roof of an interior world and misread every genuine hole as
      // a tunneling artifact. The ray spans the probe's full travel down to
      // the kill plane: a worldHeight-based length stops above the surface
      // on low-relief worlds and lets tunneling masquerade as a hole.
      const ray = pw.castDown(pos.x, p.dropY, pos.z, p.dropY - killY);
      if (ray) {
        artifacts++; // engine tunneling — surface exists; excluded from hole evidence
      } else if (
        pos.x >= aabb.min.x && pos.x <= aabb.max.x &&
        pos.z >= aabb.min.z && pos.z <= aabb.max.z &&
        inClaimZone(pos.x, pos.z)
      ) {
        trustGrid.add("fallConfirmed", pos.x, pos.z);
      }
      // exits beyond the AABB footprint (grid indexing would clamp them onto
      // rim cells) or outside the claim zone: the probe rolled off the
      // world's open edge — it left the world; never fall-through evidence
    } else {
      rested++;
      trustGrid.add("probeContact", pos.x, pos.z);
    }
  }

  // (trustGrid visualPts binning happened before the LiDAR pass, for the domain mask)
  // Two-pass divergence with a SELF-CALIBRATED lie threshold: measure the
  // splat-to-collider distance distribution on cells where probes RESTED
  // (physics verified the visuals there) — that distribution IS this world's
  // simplification noise floor. "Lying" means divergence beyond the vendor's
  // own demonstrated tolerance, not beyond an arbitrary constant. Per-point
  // Gaussian scale (when available from SPZ) inflates the tolerance: a fat
  // splat's surface extends far from its center.
  const hasVisuals = visualPoints.length > 0;
  const contactCh = trustGrid.channel("probeContact");
  interface DivergenceSample {
    x: number;
    z: number;
    d: number;
    verified: boolean;
  }
  const samples: DivergenceSample[] = [];
  for (let i = 0; i < visualPoints.length; i += 3) {
    const x = visualPoints[i], y = visualPoints[i + 1], z = visualPoints[i + 2];
    // background scenery — splats beyond the collider's bounding volume (sky,
    // horizon, out-of-window vistas) — is not a claim about walkable space
    if (
      x < aabb.min.x - 0.25 || x > aabb.max.x + 0.25 ||
      z < aabb.min.z - 0.25 || z > aabb.max.z + 0.25 ||
      y < aabb.min.y - 0.5 || y > aabb.max.y + 0.5
    ) {
      continue;
    }
    if (!inClaimZone(x, z)) continue; // unreachable fuzz beyond the walls is not a claim
    let d = pw.distanceToCollider({ x, y, z });
    if (visualScales) d = Math.max(0, d - visualScales[i / 3]); // splat surface, not center
    samples.push({ x, z, d, verified: contactCh[trustGrid.index(x, z)] > 0 });
  }
  const verifiedDists = samples.filter((s) => s.verified).map((s) => s.d).sort((a, b) => a - b);
  let noiseFloorM = opts.divergenceThresholdM; // fallback when calibration is undersampled
  if (verifiedDists.length >= 200) {
    const p99 = verifiedDists[Math.floor(verifiedDists.length * 0.99)];
    noiseFloorM = Math.min(0.5, Math.max(0.05, p99 * 1.5));
  }
  let visualNoPhys = 0;
  for (const s of samples) {
    if (s.d > noiseFloorM) {
      visualNoPhys++;
      trustGrid.add("visualNoPhys", s.x, s.z);
    }
  }

  const sampleRng = mulberry32(hashSeed(opts.seed, "collider-samples"));
  const colliderSamples = hasVisuals ? sampleMeshSurface(collider, 30, sampleRng) : new Float32Array(0);
  const visualHash = new PointHash(visualPoints, 0.25);
  let physNoVisual = 0;
  const nearRadius = 0.2;
  for (let i = 0; i < colliderSamples.length; i += 3) {
    const x = colliderSamples[i], y = colliderSamples[i + 1], z = colliderSamples[i + 2];
    if (!inClaimZone(x, z)) continue; // collider beyond reachable space cannot ambush a robot
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
      noiseFloorM,
      noiseFloorCalibrated: verifiedDists.length >= 200,
    },
  };
}
