/**
 * Extended check profile (`certify --extended`): instruments beyond the core
 * visual-vs-collider survey. Three new evidence families:
 *
 *  - visual SELF-consistency (floater census: splat clusters disconnected
 *    from the main structure);
 *  - plausibility PRIORS (level audit, anthropometric scale witnesses —
 *    a generated world has no ground truth, so "geometric accuracy of the
 *    visuals" can only be measured against the physics twin, against itself,
 *    or against priors about how worlds work);
 *  - solver HEALTH (settling test: boxes on confirmed floor must sit still —
 *    degenerate collider triangles make contacts jitter and silently poison
 *    RL training) and world-level reachability.
 *
 * INFORMATIONAL in v1: nothing here enters the grade, so a world grades
 * identically under both profiles and the default certificate stays
 * byte-identical. Every number is a Measurement with an uncertainty basis
 * and a methods line. Fully deterministic for a fixed (world, seed).
 */
import type { TriMesh } from "../core/geom.js";
import { hashSeed, mulberry32 } from "../core/prng.js";
import type { ExtendedChecks, Gravity, Measurement, Region } from "../core/types.js";
import { initRapier, FIXED_DT, PhysicsWorld } from "../physics/rapierWorld.js";
import type { MetrologyResult } from "./metrology.js";
import type { SurveyResult } from "./survey.js";

export interface ExtendedInput {
  collider: TriMesh;
  visualPoints: Float32Array;
  survey: SurveyResult;
  metrology: MetrologyResult;
  gravity: Gravity;
  seed: number;
  /** vendor-shipped metric scale factor, when the bundle carries one */
  vendorFactor?: number;
}

// ---------------------------------------------------------- level audit

function levelAudit(m: MetrologyResult, survey: SurveyResult): ExtendedChecks["levelAudit"] {
  const fp = m.floorPlane;
  const span = Math.max(
    survey.aabb.max.x - survey.aabb.min.x,
    survey.aabb.max.z - survey.aabb.min.z,
    1e-6,
  );
  // tilt uncertainty: the fit could lean by ~2x residual RMS across the footprint
  const tiltSd = (Math.atan2(2 * fp.inlierRms, span) * 180) / Math.PI;
  return {
    tilt: {
      name: "floor_tilt_from_gravity",
      value: fp.tiltDeg,
      unit: "deg",
      uncertainty: {
        low: Math.max(0, fp.tiltDeg - tiltSd),
        high: fp.tiltDeg + tiltSd,
        basis: `plane-fit residual RMS ${fp.inlierRms.toFixed(3)} m over ${span.toFixed(1)} m footprint`,
      },
      method:
        "angle between the fitted floor-plane normal and the gravity vector; a level floor reads 0 deg — tilt is invisible to the eye but constant to an IMU",
      n: fp.inliers,
    },
    planarityRms: {
      name: "floor_planarity_rms",
      value: fp.inlierRms,
      unit: "m",
      uncertainty: {
        low: fp.inlierRms * 0.8,
        high: fp.inlierRms * 1.2,
        basis: "sampling variability of the inlier set (±20%)",
      },
      method: "vertical residual RMS of virtual-LiDAR floor returns about the fitted plane — surface waviness a policy's feet will feel",
      n: fp.inliers,
    },
  };
}

// -------------------------------------------------------- floater census

const FLOATER_CELL_M = 0.25;
/** a component this share of total points (or larger) is structure, not debris */
const FLOATER_MAX_SHARE = 0.005;
const FLOATER_MAX_EXTENT_M = 1.5;
const FLOATER_MIN_ELEVATION_M = 0.4;
const FLOATER_MIN_POINTS = 8;

function floaterCensus(visualPoints: Float32Array, survey: SurveyResult): ExtendedChecks["floaters"] {
  const nPts = Math.floor(visualPoints.length / 3);
  const cell = FLOATER_CELL_M;
  // occupied-voxel connected components (26-connectivity) via union-find
  const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
  const voxOf = new Map<string, number>(); // voxel -> component root index
  const parent: number[] = [];
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const voxCoords: [number, number, number][] = [];
  for (let p = 0; p < nPts; p++) {
    const cx = Math.floor(visualPoints[p * 3] / cell);
    const cy = Math.floor(visualPoints[p * 3 + 1] / cell);
    const cz = Math.floor(visualPoints[p * 3 + 2] / cell);
    const k = key(cx, cy, cz);
    if (!voxOf.has(k)) {
      const id = parent.length;
      parent.push(id);
      voxOf.set(k, id);
      voxCoords.push([cx, cy, cz]);
    }
  }
  for (let v = 0; v < voxCoords.length; v++) {
    const [cx, cy, cz] = voxCoords[v];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const n = voxOf.get(key(cx + dx, cy + dy, cz + dz));
          if (n !== undefined) union(v, n);
        }
  }
  // per-component stats from the points themselves
  interface Comp { pts: number; min: [number, number, number]; max: [number, number, number]; cx: number; cy: number; cz: number }
  const comps = new Map<number, Comp>();
  for (let p = 0; p < nPts; p++) {
    const x = visualPoints[p * 3], y = visualPoints[p * 3 + 1], z = visualPoints[p * 3 + 2];
    const root = find(voxOf.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)))!);
    let c = comps.get(root);
    if (!c) {
      c = { pts: 0, min: [x, y, z], max: [x, y, z], cx: 0, cy: 0, cz: 0 };
      comps.set(root, c);
    }
    c.pts++;
    c.cx += x; c.cy += y; c.cz += z;
    for (let a = 0; a < 3; a++) {
      const v = a === 0 ? x : a === 1 ? y : z;
      if (v < c.min[a]) c.min[a] = v;
      if (v > c.max[a]) c.max[a] = v;
    }
  }
  // a floater: small, compact, and elevated above the local collider surface
  const rayGrid = survey.rayGrid;
  const surfaceY = rayGrid.channel("surfaceY");
  const hasHit = rayGrid.channel("hasHit");
  const gcell = rayGrid.cellSize;
  const floaters: { pts: number; region: Region }[] = [];
  let floaterPts = 0;
  for (const c of comps.values()) {
    if (c.pts < FLOATER_MIN_POINTS || c.pts > FLOATER_MAX_SHARE * nPts) continue;
    const ext = Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]);
    if (ext > FLOATER_MAX_EXTENT_M) continue;
    const mx = c.cx / c.pts, my = c.cy / c.pts, mz = c.cz / c.pts;
    const col = Math.floor((mx - rayGrid.x0) / gcell);
    const row = Math.floor((mz - rayGrid.z0) / gcell);
    let elevated: boolean;
    if (col < 0 || col >= rayGrid.cols || row < 0 || row >= rayGrid.rows) {
      elevated = true; // debris outside the collider footprint entirely
    } else {
      const i = row * rayGrid.cols + col;
      elevated = !hasHit[i] || my - surfaceY[i] > FLOATER_MIN_ELEVATION_M;
    }
    if (!elevated) continue;
    floaterPts += c.pts;
    floaters.push({
      pts: c.pts,
      region: { min: [c.min[0], c.min[1], c.min[2]], max: [c.max[0], c.max[1], c.max[2]] },
    });
  }
  floaters.sort((a, b) => b.pts - a.pts);
  const sharePct = nPts > 0 ? (100 * floaterPts) / nPts : 0;
  return {
    count: floaters.length,
    pointSharePct: sharePct,
    examples: floaters.slice(0, 10).map((f) => f.region),
    measurement: {
      name: "floater_point_share",
      value: sharePct,
      unit: "%",
      uncertainty: {
        low: Math.max(0, sharePct * 0.7),
        high: sharePct * 1.3,
        basis: `voxel connectivity at ${cell} m — clusters split/merged at the voxel scale shift the census (±30%)`,
      },
      method:
        `26-connected components of splat centers on a ${cell} m voxel grid; a floater is a component with <${(FLOATER_MAX_SHARE * 100).toFixed(1)}% of points, <${FLOATER_MAX_EXTENT_M} m extent, elevated >${FLOATER_MIN_ELEVATION_M} m above the local collider surface (or outside the footprint)`,
      n: nPts,
    },
  };
}

// --------------------------------------- anthropometric scale consensus

const DOOR_WIDTH_PRIOR_M = 0.9; // interior passage width, mid of 0.7–1.1
const DOOR_WIDTH_PRIOR_SD = 0.2;
const CEILING_PRIOR_M = 2.7; // interior ceiling height, mid of 2.2–3.2
const CEILING_PRIOR_SD = 0.5;

function scaleConsensus(m: MetrologyResult, survey: SurveyResult, vendorFactor?: number): ExtendedChecks["scaleConsensus"] {
  const witnesses: Measurement[] = [];
  if (m.scaleEstimate) witnesses.push(m.scaleEstimate);

  if (m.doorways.length > 0) {
    const widths = m.doorways.map((d) => d.widthM.value).sort((a, b) => a - b);
    const medW = widths[Math.floor(widths.length / 2)];
    if (medW > 0.05) {
      const est = DOOR_WIDTH_PRIOR_M / medW;
      const sd = est * (DOOR_WIDTH_PRIOR_SD / DOOR_WIDTH_PRIOR_M);
      witnesses.push({
        name: "scale_witness_door_width",
        value: est,
        unit: "x",
        uncertainty: { low: est - 2 * sd, high: est + 2 * sd, basis: `door-width prior ${DOOR_WIDTH_PRIOR_M}±${DOOR_WIDTH_PRIOR_SD} m (2 SD)` },
        method: `median measured doorway width ${medW.toFixed(2)} m vs interior-passage prior — independent of the door-HEIGHT witness`,
        n: m.doorways.length,
      });
    }
  }

  // median interior ceiling height over floor-class cells
  const rayGrid = survey.rayGrid;
  const headroom = rayGrid.channel("headroom");
  const heads: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (m.classes[i] === 1 && headroom[i] < 990) heads.push(headroom[i]);
  }
  if (heads.length >= 20) {
    heads.sort((a, b) => a - b);
    const medH = heads[Math.floor(heads.length / 2)];
    if (medH > 0.1) {
      const est = CEILING_PRIOR_M / medH;
      const sd = est * (CEILING_PRIOR_SD / CEILING_PRIOR_M);
      witnesses.push({
        name: "scale_witness_ceiling_height",
        value: est,
        unit: "x",
        uncertainty: { low: est - 2 * sd, high: est + 2 * sd, basis: `ceiling prior ${CEILING_PRIOR_M}±${CEILING_PRIOR_SD} m (2 SD)` },
        method: `median floor-to-ceiling headroom ${medH.toFixed(2)} m over ${heads.length} interior floor cells vs residential/industrial interior prior`,
        n: heads.length,
      });
    }
  }

  let agreement: string;
  if (witnesses.length === 0) {
    agreement = "no anthropometric structure detected (no doorways, no interior ceiling) — scale witnesses unavailable; vendor metadata stands alone";
  } else {
    const target = vendorFactor ?? 1.0;
    const agreeing = witnesses.filter((w) => target >= w.uncertainty.low && target <= w.uncertainty.high).length;
    const vals = witnesses.map((w) => `${w.name.replace("scale_witness_", "").replace("metric_scale_factor_estimate", "door_height")}=${w.value.toFixed(2)}x`).join(", ");
    agreement =
      `${agreeing}/${witnesses.length} independent witnesses contain ${vendorFactor !== undefined ? `the vendor factor ${target}` : "metric scale 1.0"} within 2 SD (${vals}). ` +
      (agreeing === witnesses.length
        ? "Scale corroborated by consensus."
        : agreeing === 0
          ? "NO witness agrees — treat metric scale as unverified until repaired."
          : "Partial consensus — cross-check before metric claims.");
  }
  return { witnesses, agreement };
}

// ----------------------------------------------------------- settling

const SETTLE_BOXES = 24;
const BOX_HALF_M = 0.125;
const SETTLE_STEPS = 120; // 2 s grace to come to rest
const MEASURE_STEPS = 60; // 1 s observation window
const DRIFT_STABLE_M = 0.02;
const VEL_STABLE_MPS = 0.05;
const EJECT_DELTA_M = 1.0;

async function settlingTest(input: ExtendedInput): Promise<ExtendedChecks["settling"]> {
  const { survey, metrology, collider, gravity, seed } = input;
  const rayGrid = survey.rayGrid;
  const surfaceY = rayGrid.channel("surfaceY");
  // candidate sites: floor-class cells, deterministically strided
  const floorCells: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) if (metrology.classes[i] === 1) floorCells.push(i);
  if (floorCells.length === 0) {
    return {
      boxes: 0, stable: 0, jitter: 0, ejected: 0,
      maxDriftM: {
        name: "settling_max_drift", value: 0, unit: "m",
        uncertainty: { low: 0, high: 0, basis: "not measured — no floor cells" },
        method: "no floor-class cells to place boxes on; placeholder, not a claim",
      },
      verdict: "not run: no confirmed floor",
    };
  }
  const rng = mulberry32(hashSeed(seed, "settling"));
  const count = Math.min(SETTLE_BOXES, floorCells.length);
  const stride = floorCells.length / count;
  const sites = Array.from({ length: count }, (_, k) => floorCells[Math.min(floorCells.length - 1, Math.floor(k * stride + rng() * stride))]);

  const R = await initRapier();
  const phys = new PhysicsWorld(gravity.g);
  phys.addStaticTriMesh(collider);
  const bodies = sites.map((i) => {
    const [x, z] = rayGrid.center(i);
    const y = surfaceY[i] + BOX_HALF_M + 0.2;
    const body = phys.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true));
    phys.world.createCollider(R.ColliderDesc.cuboid(BOX_HALF_M, BOX_HALF_M, BOX_HALF_M).setFriction(0.6).setRestitution(0.0).setDensity(300), body);
    return { body, startY: y };
  });
  for (let s = 0; s < SETTLE_STEPS; s++) phys.step();
  const marks = bodies.map(({ body }) => {
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  });
  let maxVel = 0;
  for (let s = 0; s < MEASURE_STEPS; s++) {
    phys.step();
    for (const { body } of bodies) {
      const v = body.linvel();
      maxVel = Math.max(maxVel, Math.hypot(v.x, v.y, v.z));
    }
  }
  let stable = 0, jitter = 0, ejected = 0, maxDrift = 0;
  bodies.forEach(({ body, startY }, k) => {
    const t = body.translation();
    const drift = Math.hypot(t.x - marks[k].x, t.y - marks[k].y, t.z - marks[k].z);
    maxDrift = Math.max(maxDrift, drift);
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (Math.abs(t.y - startY) > EJECT_DELTA_M + 0.2 + BOX_HALF_M) ejected++;
    else if (drift <= DRIFT_STABLE_M && speed <= VEL_STABLE_MPS) stable++;
    else jitter++;
  });
  phys.free();
  const verdict =
    ejected > 0
      ? `SOLVER HEALTH FAIL: ${ejected} box(es) ejected — degenerate contact geometry; RL training on this collider will see phantom impulses`
      : jitter > 0
        ? `marginal: ${jitter} box(es) still moving after ${((SETTLE_STEPS * FIXED_DT)).toFixed(0)} s grace — contacts do not fully converge`
        : `stable: all ${bodies.length} boxes at rest — resting contacts converge cleanly`;
  return {
    boxes: bodies.length,
    stable,
    jitter,
    ejected,
    maxDriftM: {
      name: "settling_max_drift",
      value: maxDrift,
      unit: "m",
      uncertainty: { low: 0, high: maxDrift + VEL_STABLE_MPS * MEASURE_STEPS * FIXED_DT, basis: "one observation window; velocity bound extrapolation" },
      method: `max positional drift of ${bodies.length} boxes (${BOX_HALF_M * 2} m, seeded stride placement on floor cells) during a ${(MEASURE_STEPS * FIXED_DT).toFixed(0)} s window after ${(SETTLE_STEPS * FIXED_DT).toFixed(0)} s settle, fixed dt ${FIXED_DT.toFixed(4)}`,
      n: bodies.length,
    },
    verdict,
  };
}

// -------------------------------------------------------- reachability

function reachability(m: MetrologyResult, survey: SurveyResult): ExtendedChecks["reachability"] {
  const rayGrid = survey.rayGrid;
  const visualBand = rayGrid.channel("visualFloorBand");
  const visualTotal = rayGrid.channel("visualTotal");
  const standable = rayGrid.channel("standable");
  const claimZone = rayGrid.channel("claimZone");

  // "looks walkable" = physics-confirmed floor (class 1) PLUS void columns
  // whose splats claim floor (metrology's own hole gate: floor-band density
  // at this world's floor calibration + band-dominance ratio, inside the
  // claim zone). Wall/obstacle columns are EXCLUDED from the denominator —
  // their visual band describes the obstacle's surface, not walkable floor.
  const stBands: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) if (standable[i] && visualBand[i] > 0) stBands.push(visualBand[i]);
  stBands.sort((a, b) => a - b);
  const medianFloorBand = stBands.length > 0 ? stBands[Math.floor(stBands.length / 2)] : 0;
  const claimThreshold = Math.max(2, 0.25 * medianFloorBand);
  const holeClaim = (i: number) =>
    m.classes[i] === 0 &&
    claimZone[i] > 0 &&
    visualBand[i] >= claimThreshold &&
    visualBand[i] / Math.max(1, visualTotal[i]) >= 0.3;

  // Connectivity: flood-fill over floor (class 1) AND low-obstacle (class 2)
  // cells — sills and furniture-height cells conduct connectivity (a sill
  // splits nothing; whether it is NEGOTIABLE is the per-robot verdict's job),
  // but only FLOOR cells count as area. Walls (class 3) and voids block.
  const passable = (i: number) => m.classes[i] === 1 || m.classes[i] === 2;
  const comp = new Int32Array(rayGrid.size).fill(-1);
  const compFloorCells: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (!passable(i) || comp[i] !== -1) continue;
    const id = compFloorCells.length;
    let floorCount = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (m.classes[cur] === 1) floorCount++;
      const [c, r] = rayGrid.colRow(cur);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= rayGrid.cols || nr < 0 || nr >= rayGrid.rows) continue;
        const ni = nr * rayGrid.cols + nc;
        if (passable(ni) && comp[ni] === -1) {
          comp[ni] = id;
          stack.push(ni);
        }
      }
    }
    compFloorCells.push(floorCount);
  }
  let mainComp = -1, mainFloor = 0;
  compFloorCells.forEach((s, id) => {
    if (s > mainFloor) { mainFloor = s; mainComp = id; }
  });

  let visualFloorCells = 0;
  let reachableCells = 0;
  for (let i = 0; i < rayGrid.size; i++) {
    const looksWalkable = m.classes[i] === 1 || holeClaim(i);
    if (!looksWalkable) continue;
    visualFloorCells++;
    if (m.classes[i] === 1 && comp[i] === mainComp && mainComp !== -1) reachableCells++;
  }
  const pct = visualFloorCells > 0 ? (100 * reachableCells) / visualFloorCells : 100;
  const cellUncPct = visualFloorCells > 0 ? (100 * Math.sqrt(visualFloorCells)) / visualFloorCells : 0;
  return {
    visualFloorCells,
    reachableCells,
    fractionPct: {
      name: "reachable_visual_floor",
      value: pct,
      unit: "%",
      uncertainty: {
        low: Math.max(0, pct - 2 * cellUncPct),
        high: Math.min(100, pct + 2 * cellUncPct),
        basis: `cell-count statistics over ${visualFloorCells} walkable-looking cells (2 SD)`,
      },
      method:
        "walkable-looking = physics-confirmed floor + floor-claiming void columns (metrology's hole gate); reachable = floor cells in the largest component connected through floor/low-obstacle cells (sills conduct — negotiability is the per-robot verdict's job). Holes subtract via the denominator, isolated islands via the numerator: 'how much of the floor you SEE can a robot actually REACH'",
      n: visualFloorCells,
    },
  };
}

// --------------------------------------------------------------- build

export async function buildExtendedChecks(input: ExtendedInput): Promise<ExtendedChecks> {
  return {
    profile: "extended-v1",
    note:
      "Extended checks are INFORMATIONAL in v1: they do not enter the grade, so the grade matches the default profile. " +
      "Families: plausibility priors (level, anthropometric scale), visual self-consistency (floaters), solver health (settling), world-level reachability.",
    levelAudit: levelAudit(input.metrology, input.survey),
    floaters: floaterCensus(input.visualPoints, input.survey),
    scaleConsensus: scaleConsensus(input.metrology, input.survey, input.vendorFactor),
    settling: await settlingTest(input),
    reachability: reachability(input.metrology, input.survey),
  };
}
