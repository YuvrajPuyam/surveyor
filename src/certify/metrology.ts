/**
 * Metrology: floor-plane fit, occupancy classification, doorway detection and
 * clearance measurement, step/sill detection, interior-hole regions, and the
 * metric-scale estimate.
 *
 * Every exported number is a Measurement: value + uncertainty range + a
 * methods line. The schema makes raw centimeter claims unrepresentable.
 */
import type { Aabb } from "../core/geom.js";
import type { Grid2D } from "../core/grid.js";
import { hashSeed, mulberry32 } from "../core/prng.js";
import type { Measurement, WorldMetadata } from "../core/types.js";

export interface DoorwayInfo {
  region: Aabb;
  widthM: Measurement;
  heightM: Measurement;
  floorY: number;
}

export interface StepInfo {
  region: Aabb;
  heightM: Measurement;
}

export interface MetrologyResult {
  floorPlane: {
    y: number;
    tiltDeg: number;
    inlierRms: number;
    inliers: number;
    measurement: Measurement;
  };
  doorways: DoorwayInfo[];
  steps: StepInfo[];
  /** interior regions where downward rays hit nothing (candidate collider holes) */
  interiorVoids: Aabb[];
  scaleEstimate: Measurement | null;
  measurements: Measurement[];
  /** cell classification channel written back into rayGrid: 0 void, 1 floor, 2 lowObstacle, 3 wall */
  classes: Float64Array;
}

const DOOR_HEIGHT_PRIOR_M = 2.03; // standard interior passage; basis stated on the measurement
const DOOR_HEIGHT_PRIOR_SD = 0.1;

export function runMetrology(rayGrid: Grid2D, seed: number, metadata?: WorldMetadata): MetrologyResult {
  const hasHit = rayGrid.channel("hasHit");
  const surfaceY = rayGrid.channel("surfaceY");
  const headroom = rayGrid.channel("headroom");
  const cell = rayGrid.cellSize;

  // ------------------------------------------------- RANSAC floor plane
  // Fit on STANDABLE columns only, preferring those with a finite ceiling
  // above them: interior floors sit under ceilings, roof tops under sky. A
  // shell roof spanning the footprint would otherwise out-populate the floor
  // and the "floor plane" would be the roof. Ceilingless worlds (synthetic
  // bench) have almost no finite-headroom cells and fall back to all
  // standable columns.
  const standableCh = rayGrid.channel("standable");
  const allStandable: number[] = [];
  const interiorStandable: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (!standableCh[i]) continue;
    allStandable.push(i);
    if (headroom[i] < 990) interiorStandable.push(i);
  }
  const hitIdx = interiorStandable.length >= 0.15 * allStandable.length ? interiorStandable : allStandable;
  if (hitIdx.length < 10) throw new Error("Too few standable columns to fit a floor plane");

  const rng = mulberry32(hashSeed(seed, "ransac-floor"));
  let bestInliers: number[] = [];
  let bestPlane = { a: 0, b: 1, c: 0, d: 0 }; // ax+by+cz = d with (a,b,c) unit normal
  const INLIER_TOL = 0.03;
  for (let iter = 0; iter < 200; iter++) {
    const pick = () => hitIdx[Math.floor(rng() * hitIdx.length)];
    const [i1, i2, i3] = [pick(), pick(), pick()];
    const p = (i: number) => {
      const [x, z] = rayGrid.center(i);
      return { x, y: surfaceY[i], z };
    };
    const p1 = p(i1), p2 = p(i2), p3 = p(i3);
    const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z;
    const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len; ny /= len; nz /= len;
    if (Math.abs(ny) < 0.95) continue; // floors are near-horizontal
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d = nx * p1.x + ny * p1.y + nz * p1.z;
    const inliers: number[] = [];
    for (const i of hitIdx) {
      const [x, z] = rayGrid.center(i);
      const dist = Math.abs(nx * x + ny * surfaceY[i] + nz * z - d);
      if (dist < INLIER_TOL) inliers.push(i);
    }
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestPlane = { a: nx, b: ny, c: nz, d };
    }
  }

  const planeYat = (x: number, z: number) => (bestPlane.d - bestPlane.a * x - bestPlane.c * z) / bestPlane.b;
  let rmsAcc = 0;
  let ySum = 0;
  for (const i of bestInliers) {
    const [x, z] = rayGrid.center(i);
    const r = surfaceY[i] - planeYat(x, z);
    rmsAcc += r * r;
    ySum += surfaceY[i];
  }
  const inlierRms = Math.sqrt(rmsAcc / bestInliers.length);
  const floorY = ySum / bestInliers.length;
  const tiltDeg = (Math.acos(Math.min(1, bestPlane.b)) * 180) / Math.PI;

  const floorMeasurement: Measurement = {
    name: "floor_plane_height",
    value: floorY,
    unit: "m",
    uncertainty: { low: floorY - 2 * inlierRms, high: floorY + 2 * inlierRms, basis: "2x RANSAC inlier RMS" },
    method: `RANSAC plane fit on ${bestInliers.length} virtual-LiDAR returns (tol ${INLIER_TOL} m, 200 iters); tilt ${tiltDeg.toFixed(2)} deg`,
    n: bestInliers.length,
  };

  // ------------------------------------------------- cell classification
  const classes = rayGrid.channel("class");
  for (let i = 0; i < rayGrid.size; i++) {
    if (!hasHit[i]) {
      classes[i] = 0; // void
      continue;
    }
    const [x, z] = rayGrid.center(i);
    const dy = surfaceY[i] - planeYat(x, z);
    if (Math.abs(dy) <= 0.06) classes[i] = 1; // floor at the fitted plane
    else if (dy < -0.06) classes[i] = standableCh[i] ? 1 : 2; // sunken but standable = still floor
    else if (dy < 0.6) classes[i] = 2; // low obstacle / sill / furniture
    else classes[i] = 3; // wall (or roof-only column)
  }

  // ------------------------------------------------- floor-claiming voids
  // A hole is a void column whose splats CLAIM floor: visual points
  // concentrated at floor height (a wall-line void has splats spread over
  // the wall's full height; void beyond the walls has no splats at all).
  // Real colliders are open shells with no exterior, so "inside vs outside"
  // must come from the visual evidence, not from grid geometry.
  const visualBand = rayGrid.channel("visualFloorBand");
  const visualTotal = rayGrid.channel("visualTotal");
  // density-relative floor-claim gate (same calibration as probe placement):
  // a hole claim must be about as splat-dense as this world's real floors
  const stBands: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) if (standableCh[i] && visualBand[i] > 0) stBands.push(visualBand[i]);
  stBands.sort((a, b) => a - b);
  const medianFloorBand = stBands.length > 0 ? stBands[Math.floor(stBands.length / 2)] : 0;
  const claimThreshold = Math.max(2, 0.25 * medianFloorBand);
  const claimZone = rayGrid.channel("claimZone");
  const holeCell = (i: number) =>
    classes[i] === 0 &&
    claimZone[i] > 0 &&
    visualBand[i] >= claimThreshold &&
    visualBand[i] / Math.max(1, visualTotal[i]) >= 0.3;
  const voidRegions = rayGrid.regions(holeCell);
  const interiorVoids: Aabb[] = [];
  for (const r of voidRegions) {
    const areaCells = ((r.max.x - r.min.x) / cell) * ((r.max.z - r.min.z) / cell);
    if (areaCells >= 3) interiorVoids.push(r);
  }

  // ------------------------------------------------- doorway detection
  // Structural, not metric: a doorway is a traversable constriction. Defining
  // it metrically ("< 2.6 m") would be circular — doorways are how we
  // ESTIMATE the scale. Two regimes:
  //  - interior worlds (most floor cells have a ceiling): a doorway is
  //    headroom noticeably below the prevailing ceiling;
  //  - ceilingless worlds (synthetic bench): any finite headroom well under
  //    the prevailing wall height is a header.
  let floorCells = 0;
  const floorHeads: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (classes[i] !== 1) continue;
    floorCells++;
    if (headroom[i] < 990) floorHeads.push(headroom[i]);
  }
  floorHeads.sort((a, b) => a - b);
  const interiorWorld = floorHeads.length >= 0.3 * Math.max(1, floorCells);
  let headLimit: number;
  if (interiorWorld) {
    const medianHead = floorHeads[Math.floor(floorHeads.length / 2)];
    headLimit = Math.min(0.93 * medianHead, medianHead - 0.05);
  } else {
    const wallHeights: number[] = [];
    for (let i = 0; i < rayGrid.size; i++) {
      if (classes[i] !== 3) continue;
      const [x, z] = rayGrid.center(i);
      wallHeights.push(surfaceY[i] - planeYat(x, z));
    }
    wallHeights.sort((a, b) => a - b);
    const wallH = wallHeights.length > 0 ? wallHeights[Math.floor(wallHeights.length * 0.9)] : 3.0;
    headLimit = Math.max(2.6, 0.8 * wallH);
  }
  const doorPred = (i: number) =>
    (classes[i] === 1 || classes[i] === 2) && headroom[i] > 0.5 && headroom[i] < headLimit && headroom[i] < 990;
  const doorRegions = rayGrid.regions(doorPred);
  const doorways: DoorwayInfo[] = [];
  for (const r of doorRegions) {
    // reject tiny clusters (single-cell noise)
    const areaCells = ((r.max.x - r.min.x) / cell) * ((r.max.z - r.min.z) / cell);
    if (areaCells < 3) continue;
    const spanX = r.max.x - r.min.x;
    const spanZ = r.max.z - r.min.z;
    // passage width is the larger horizontal span of the header footprint
    // (the smaller span is the wall thickness the doorway pierces)
    const width = Math.max(spanX, spanZ);
    // minimal header height over the region
    let minHead = Infinity;
    let floorAt = floorY;
    for (let i = 0; i < rayGrid.size; i++) {
      if (!doorPred(i)) continue;
      const [x, z] = rayGrid.center(i);
      if (x < r.min.x || x > r.max.x || z < r.min.z || z > r.max.z) continue;
      if (headroom[i] < minHead) {
        minHead = headroom[i];
        floorAt = surfaceY[i];
      }
    }
    doorways.push({
      region: r,
      floorY: floorAt,
      widthM: {
        name: "doorway_width",
        value: width,
        unit: "m",
        uncertainty: { low: width - cell, high: width + cell, basis: `raycast grid resolution ${cell} m` },
        method: `header-footprint extent on ${cell} m virtual-LiDAR grid`,
      },
      heightM: {
        name: "doorway_height",
        value: minHead,
        unit: "m",
        uncertainty: { low: minHead - 0.03, high: minHead + 0.03, basis: "vertical ray quantization" },
        method: "min upward-ray headroom over doorway cells, measured from local surface",
      },
    });
  }

  // ------------------------------------------------- step / sill detection
  // Adjacent traversable cells whose surface heights differ by a step-like amount.
  const stepEdge = rayGrid.channel("stepEdge");
  for (let i = 0; i < rayGrid.size; i++) {
    if (classes[i] !== 1 && classes[i] !== 2) continue;
    const [c, r] = rayGrid.colRow(i);
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const nc = c + dc, nr = r + dr;
      if (nc >= rayGrid.cols || nr >= rayGrid.rows) continue;
      const ni = nr * rayGrid.cols + nc;
      if (classes[ni] !== 1 && classes[ni] !== 2) continue;
      const dy = Math.abs(surfaceY[i] - surfaceY[ni]);
      if (dy > 0.04 && dy < 0.5) {
        stepEdge[i] = Math.max(stepEdge[i], dy);
        stepEdge[ni] = Math.max(stepEdge[ni], dy);
      }
    }
  }
  const stepRegions = rayGrid.regions((i) => stepEdge[i] > 0);
  // Natural terrain produces THOUSANDS of step edges (every rock and crater
  // lip); a certificate with 1,500 sill defects is noise, not measurement.
  // Merge step regions that lie within 0.5 m of each other — one terrain
  // feature, one region — before emitting.
  const merged: Aabb[] = [];
  const GAP = 0.5;
  for (const r of stepRegions) {
    const near = merged.find(
      (m) =>
        r.min.x <= m.max.x + GAP && r.max.x >= m.min.x - GAP &&
        r.min.z <= m.max.z + GAP && r.max.z >= m.min.z - GAP,
    );
    if (near) {
      near.min.x = Math.min(near.min.x, r.min.x);
      near.min.z = Math.min(near.min.z, r.min.z);
      near.max.x = Math.max(near.max.x, r.max.x);
      near.max.z = Math.max(near.max.z, r.max.z);
    } else {
      merged.push({ min: { ...r.min }, max: { ...r.max } });
    }
  }
  const steps: StepInfo[] = [];
  for (const r of merged) {
    let maxH = 0;
    for (let i = 0; i < rayGrid.size; i++) {
      const [x, z] = rayGrid.center(i);
      if (x < r.min.x || x > r.max.x || z < r.min.z || z > r.max.z) continue;
      maxH = Math.max(maxH, stepEdge[i]);
    }
    if (maxH < 0.04) continue;
    steps.push({
      region: r,
      heightM: {
        name: "step_height",
        value: maxH,
        unit: "m",
        uncertainty: { low: maxH - 0.02, high: maxH + 0.02, basis: "adjacent-cell surface delta quantization" },
        method: `max surface discontinuity between adjacent traversable cells (${cell} m grid; nearby edges merged within ${GAP} m)`,
      },
    });
  }

  // ------------------------------------------------- scale estimate
  let scaleEstimate: Measurement | null = null;
  if (doorways.length > 0) {
    // use the tallest doorway (sills reduce measured height; prior is header-to-floor)
    const doorH = Math.max(...doorways.map((d) => d.heightM.value));
    const est = DOOR_HEIGHT_PRIOR_M / doorH;
    const sd = est * (DOOR_HEIGHT_PRIOR_SD / DOOR_HEIGHT_PRIOR_M);
    scaleEstimate = {
      name: "metric_scale_factor_estimate",
      value: est,
      unit: "x",
      uncertainty: { low: est - 2 * sd, high: est + 2 * sd, basis: `door-height prior ${DOOR_HEIGHT_PRIOR_M}±${DOOR_HEIGHT_PRIOR_SD} m (2 SD)` },
      method: `tallest measured doorway height ${doorH.toFixed(2)} m vs standard-passage prior; single-cue estimate — cross-check against vendor metadata`,
      n: doorways.length,
    };
  }

  const measurements: Measurement[] = [floorMeasurement];
  for (const d of doorways) measurements.push(d.widthM, d.heightM);
  for (const s of steps) measurements.push(s.heightM);
  if (scaleEstimate) measurements.push(scaleEstimate);
  if (metadata?.metricScaleFactor !== undefined) {
    measurements.push({
      name: "vendor_metric_scale_factor",
      value: metadata.metricScaleFactor,
      unit: "x",
      uncertainty: { low: metadata.metricScaleFactor, high: metadata.metricScaleFactor, basis: "vendor-shipped metadata (exact as shipped)" },
      method: "read from world metadata; accuracy unverified until cross-checked",
    });
  }

  return {
    floorPlane: { y: floorY, tiltDeg, inlierRms, inliers: bestInliers.length, measurement: floorMeasurement },
    doorways,
    steps,
    interiorVoids,
    scaleEstimate,
    measurements,
    classes,
  };
}
