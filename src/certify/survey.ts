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

/**
 * Capture envelope: a column is surveyable when its smoothed splat count
 * reaches this fraction of the world's own median coverage on standable
 * columns (self-calibrated — absolute point counts vary by export density).
 */
const ENVELOPE_DENSITY_FRACTION = 0.05;
const ENVELOPE_MIN_POINTS = 4;
/**
 * Sustained-contact surface confirmation: sample contact every N steps; M
 * consecutive in-contact samples (N*M steps = 0.5 s at 60 Hz) confirm the
 * collider surface along the probe's path. On sloped terrain a ball never
 * sleeps — its contact record is the experiment.
 */
const CONTACT_SAMPLE_EVERY_STEPS = 5;
const CONTACT_CONFIRM_SAMPLES = 6;
const CONTACT_DISTANCE_FACTOR = 1.6;

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
    /** exited beyond the AABB footprint, claim zone, or capture envelope — never defect evidence */
    leftSurveyedArea: number;
    simSteps: number;
    fixedTimestep: number;
    stepsPerSecond: number;
  };
  /** splat capture envelope: where the visual record permits claims at all */
  envelope: {
    /** false when the bundle ships no visual points (nothing to bound the survey with) */
    active: boolean;
    thresholdPts: number;
    envelopeCells: number;
    colliderCells: number;
    colliderOutsideEnvelope: number;
  };
  divergence: {
    visualPointsChecked: number;
    visualNoPhysCount: number;
    colliderSamplesChecked: number;
    physNoVisualCount: number;
    /** self-calibrated lie threshold: p99 x 1.5 of splat-to-collider distance on probe-verified cells */
    noiseFloorM: number;
    noiseFloorCalibrated: boolean;
    /** "no visual support" radius for phantom evidence — self-calibrated to the shipped cloud's density */
    pnvRadiusM: number;
    /** mean 2D point spacing of the visual cloud over the surveyed area */
    meanPointSpacingM: number;
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
  const hasVisuals = visualPoints.length > 0;
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

  // ---------------------------------------------------- capture envelope
  // The splats are the record of what the capture actually observed; the
  // collider often extends beyond it (terrain skirts, shell backs). Out there
  // "no visual support" is a capture limit, not an invisible wall, and a
  // probe exit is "left the surveyed area", not a hole. The survey makes
  // claims only inside the envelope: columns whose smoothed splat coverage
  // reaches a fraction of this world's own median surface coverage. The gate
  // is column-level (2D) on purpose: an invisible barrier standing on a
  // splat-covered floor keeps its column's floor splats, stays in-envelope,
  // and remains detectable as a phantom collider.
  const envelope = rayGrid.channel("envelope");
  let envelopeThresholdPts = 0;
  if (hasVisuals) {
    const standableTotals: number[] = [];
    for (let i = 0; i < rayGrid.size; i++) {
      if (standable[i] && visualTotal[i] > 0) standableTotals.push(visualTotal[i]);
    }
    standableTotals.sort((a, b) => a - b);
    const medianTotal = standableTotals.length > 0 ? standableTotals[Math.floor(standableTotals.length / 2)] : 0;
    envelopeThresholdPts = Math.max(ENVELOPE_MIN_POINTS, ENVELOPE_DENSITY_FRACTION * medianTotal);
    for (let i = 0; i < rayGrid.size; i++) {
      if (visualTotal[i] >= envelopeThresholdPts) envelope[i] = 1;
    }
  } else {
    envelope.fill(1); // no visual record shipped — nothing to bound the survey with
  }
  let envelopeCells = 0;
  let colliderCells = 0;
  let colliderOutsideEnvelope = 0;
  for (let i = 0; i < rayGrid.size; i++) {
    if (envelope[i]) envelopeCells++;
    if (hasHit[i]) {
      colliderCells++;
      if (!envelope[i]) colliderOutsideEnvelope++;
    }
  }

  const dropHeightAt = (x: number, z: number): number | null => {
    const i = rayGrid.index(x, z);
    if (!envelope[i]) return null; // outside the surveyed area: no claims, so no probes
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
  // Sustained-contact surface confirmation. Rest-based verification starves
  // on rolling terrain (a ball on a slope never sleeps), which starves the
  // noise-floor calibration in turn. A probe that stays in contact with the
  // collider for CONTACT_CONFIRM_SAMPLES consecutive samples is physically
  // riding the surface — every cell under its path from then on is a
  // completed experiment, same epistemic standing as a rest.
  const pathContactCh = trustGrid.channel("pathContact");
  const pathSeed = rayGrid.channel("pathSeed");
  const contactStreak = new Int16Array(probes.length);
  const t0 = performance.now();
  let steps = 0;
  for (; steps < opts.maxSettleSteps; steps++) {
    pw.step();
    if (steps % CONTACT_SAMPLE_EVERY_STEPS === CONTACT_SAMPLE_EVERY_STEPS - 1) {
      for (let pi = 0; pi < probes.length; pi++) {
        const body = probes[pi].body;
        if (body.isSleeping()) continue;
        const pos = body.translation();
        if (
          pos.y <= killY ||
          pos.x < aabb.min.x || pos.x > aabb.max.x ||
          pos.z < aabb.min.z || pos.z > aabb.max.z
        ) {
          contactStreak[pi] = 0; // outside the footprint: grid indexing would clamp to rim cells
          continue;
        }
        if (pw.distanceToCollider(pos) <= opts.probeRadius * CONTACT_DISTANCE_FACTOR) {
          if (++contactStreak[pi] >= CONTACT_CONFIRM_SAMPLES) {
            pathContactCh[trustGrid.index(pos.x, pos.z)]++;
            pathSeed[rayGrid.index(pos.x, pos.z)]++;
          }
        } else {
          contactStreak[pi] = 0;
        }
      }
    }
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
    // cells a probe physically rolled across (sustained contact) are
    // traversed space — they seed reachability even when nothing rested
    for (let i = 0; i < rayGrid.size; i++) {
      if (pathSeed[i] > 0 && standable[i] && !reachable[i]) {
        reachable[i] = 1;
        queue.push(i);
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
  let leftSurveyedArea = 0;
  for (const p of probes) {
    const pos = p.body.translation();
    if (pos.y < killY) {
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
        inClaimZone(pos.x, pos.z) &&
        envelope[rayGrid.index(pos.x, pos.z)] > 0
      ) {
        fell++;
        trustGrid.add("fallConfirmed", pos.x, pos.z);
      } else {
        // rolled off the world's open edge (beyond the AABB footprint, where
        // grid indexing would clamp onto rim cells), out of the claim zone,
        // or past the capture envelope: it LEFT the surveyed area — an exit,
        // never fall-through evidence
        leftSurveyedArea++;
      }
    } else {
      rested++;
      trustGrid.add("probeContact", pos.x, pos.z);
    }
  }

  // fold sustained-contact confirmations into probe contact: >= 2 samples in
  // a trust cell means the probe spent real time riding the surface there —
  // the cell is physics-confirmed for the trust map and for noise-floor
  // calibration, exactly like a rest
  {
    const contactFold = trustGrid.channel("probeContact");
    for (let i = 0; i < trustGrid.size; i++) {
      if (pathContactCh[i] >= 2) contactFold[i] += pathContactCh[i];
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
    if (envelope[rayGrid.index(x, z)] === 0) continue; // outside the surveyed area
    let d = pw.distanceToCollider({ x, y, z });
    if (visualScales) d = Math.max(0, d - visualScales[i / 3]); // splat surface, not center
    // Calibration samples are height-banded around the contacted surface:
    // a probe rolling a canyon floor verifies the FLOOR — splats on the
    // canyon wall high above that column must not enter the noise-floor
    // estimate (they'd balloon p99 to meters and blind the ghost gate).
    const sY = surfaceY[rayGrid.index(x, z)];
    const nearContactedSurface = !Number.isFinite(sY) || Math.abs(y - sY) <= 0.75;
    samples.push({ x, z, d, verified: nearContactedSurface && contactCh[trustGrid.index(x, z)] > 0 });
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
  // "No visual support" is only meaningful relative to the cloud's own
  // density: the shipped point cloud is a downsampled stand-in for the
  // splats, and a fixed radius below its mean spacing reads EVERY surface
  // as invisible (moon: 12 pts/m² ≈ 0.29 m spacing vs the old 0.2 m).
  // Radius = 1.5x the mean 2D spacing over the surveyed area, floored at
  // the old constant, capped so a genuinely bare barrier still shows.
  let pointsInEnvelope = 0;
  for (let i = 0; i < rayGrid.size; i++) if (envelope[i]) pointsInEnvelope += visualRayCells[i];
  const surveyedAreaM2 = envelopeCells * rayCellSize * rayCellSize;
  const meanPointSpacingM =
    pointsInEnvelope > 0 && surveyedAreaM2 > 0 ? Math.sqrt(surveyedAreaM2 / pointsInEnvelope) : 0.2;
  const nearRadius = Math.min(0.6, Math.max(0.2, 1.5 * meanPointSpacingM));
  for (let i = 0; i < colliderSamples.length; i += 3) {
    const x = colliderSamples[i], y = colliderSamples[i + 1], z = colliderSamples[i + 2];
    if (!inClaimZone(x, z)) continue; // collider beyond reachable space cannot ambush a robot
    // collider beyond the capture envelope: the visual record never reached
    // this far — "no visual support" out here is a capture limit, not an
    // invisible wall. Outside the surveyed area, never phantom evidence.
    const rIdx = rayGrid.index(x, z);
    if (envelope[rIdx] === 0) continue;
    // The experiment defeats phantom evidence AT THE SURFACE IT VALIDATED:
    // a sample on terrain a probe rested on or rolled across is real by
    // experiment, however sparse the splats there. Height-banded on purpose —
    // an invisible barrier RISING from a rolled floor keeps its samples
    // (they sit far above the validated surface) and stays detectable.
    const sYp = surfaceY[rIdx];
    if (contactCh[trustGrid.index(x, z)] > 0 && Number.isFinite(sYp) && Math.abs(y - sYp) <= 0.75) continue;
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
      leftSurveyedArea,
      simSteps: steps,
      fixedTimestep: FIXED_DT,
      stepsPerSecond: elapsed > 0 ? steps / elapsed : 0,
    },
    envelope: {
      active: hasVisuals,
      thresholdPts: envelopeThresholdPts,
      envelopeCells,
      colliderCells,
      colliderOutsideEnvelope,
    },
    divergence: {
      visualPointsChecked: visualPoints.length / 3,
      visualNoPhysCount: visualNoPhys,
      colliderSamplesChecked: colliderSamples.length / 3,
      physNoVisualCount: physNoVisual,
      noiseFloorM,
      noiseFloorCalibrated: verifiedDists.length >= 200,
      pnvRadiusM: nearRadius,
      meanPointSpacingM,
    },
  };
}
