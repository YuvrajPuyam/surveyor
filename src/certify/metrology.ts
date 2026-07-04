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
  // Candidate floor points: lowest mode of surface heights.
  const hitIdx: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) if (hasHit[i]) hitIdx.push(i);
  if (hitIdx.length < 10) throw new Error("Too few raycast hits to fit a floor plane");

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
    if (dy < 0.04) classes[i] = 1; // floor
    else if (dy < 0.6) classes[i] = 2; // low obstacle / sill / furniture
    else classes[i] = 3; // wall
  }

  // ------------------------------------------------- interior void regions
  // A void region counts as interior (candidate hole) if it touches floor cells
  // on at least two sides — border void (outside the world) touches the grid edge.
  const voidRegions = rayGrid.regions((i) => classes[i] === 0);
  const interiorVoids: Aabb[] = [];
  for (const r of voidRegions) {
    const touchesEdge =
      r.min.x <= rayGrid.x0 + cell ||
      r.min.z <= rayGrid.z0 + cell ||
      r.max.x >= rayGrid.x0 + rayGrid.cols * cell - cell ||
      r.max.z >= rayGrid.z0 + rayGrid.rows * cell - cell;
    if (!touchesEdge) interiorVoids.push(r);
  }

  // ------------------------------------------------- doorway detection
  // Structural, not metric: a doorway is a traversable constriction — finite
  // headroom well below the prevailing wall height. Defining it metrically
  // ("< 2.6 m") would be circular: doorways are how we ESTIMATE the scale.
  const wallHeights: number[] = [];
  for (let i = 0; i < rayGrid.size; i++) {
    if (classes[i] !== 3) continue;
    const [x, z] = rayGrid.center(i);
    wallHeights.push(surfaceY[i] - planeYat(x, z));
  }
  wallHeights.sort((a, b) => a - b);
  const wallH = wallHeights.length > 0 ? wallHeights[Math.floor(wallHeights.length * 0.9)] : 3.0;
  const headLimit = Math.max(2.6, 0.8 * wallH);
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
  const steps: StepInfo[] = [];
  for (const r of stepRegions) {
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
        method: `max surface discontinuity between adjacent traversable cells (${cell} m grid)`,
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
