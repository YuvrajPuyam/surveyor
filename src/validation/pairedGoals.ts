/**
 * pairedGoals.ts — C16, the G6-mini paired receipt.
 *
 * N identical navigation goals, the SAME start/goal pairs and the SAME
 * kinematic waypoint controller, run twice: once on the RAW collider, once
 * on the REPAIRED collider. Success rates side by side are the first
 * empirical anchor for "the certificate is a training contract": routes the
 * repaired navmesh certifies as traversable are physically traversable —
 * and the same routes on the raw world betray the robot.
 *
 * Honesty scope (printed in the artifact): navmesh-level traversability
 * with a kinematic waypoint-driven proxy body at Earth gravity, N is small
 * — a floor for the claim, NOT a policy-transfer study. The controller is
 * a driven sphere: velocity is commanded toward the goal each step,
 * physics resolves everything else (falls through holes, stalls against
 * phantom mass, catches on sills).
 *
 * SIDECAR ONLY: no certificate code is touched; canonical hashes must be
 * byte-identical before and after this module's existence.
 */
import type { TriMesh } from "../core/geom.js";
import { PhysicsWorld, FIXED_DT, initRapier } from "../physics/rapierWorld.js";
import { certifyWorld } from "../certify/certificate.js";
import type { WorldMetadata } from "../core/types.js";
import { mulberry32 } from "../core/prng.js";

export interface PairedGoal {
  id: number;
  start: { x: number; y: number; z: number };
  goal: { x: number; y: number; z: number };
  /** navmesh waypoint chain from start to goal (goal is last); empty = drive straight */
  waypoints?: { x: number; y: number; z: number }[];
  distanceM: number;
}

export type RouteOutcome = "reached" | "fell" | "blocked";

export interface RouteResult {
  outcome: RouteOutcome;
  simSeconds: number;
  /** closest XZ distance to the goal achieved */
  bestGoalDistM: number;
}

export interface PairedReceipt {
  n: number;
  seed: number;
  controller: string;
  caveat: string;
  goals: PairedGoal[];
  raw: RouteResult[];
  repaired: RouteResult[];
  rawSuccess: number;
  repairedSuccess: number;
  headline: string;
}

const SPEED_MPS = 1.2;
const PROXY_RADIUS_M = 0.25;
const GOAL_TOL_M = 0.5;
const TIMEOUT_S = 60;
const FALL_BELOW_M = 1.0; // below route floor = fell out of the world
const PROGRESS_WINDOW_S = 8; // no progress for this long = blocked

/**
 * Drive a proxy body from start to goal on the given collider. The SAME
 * function runs for raw and repaired — only the mesh differs.
 */
export async function runRoute(collider: TriMesh, goalPair: PairedGoal): Promise<RouteResult> {
  await initRapier(); // idempotent WASM init — required before any World
  const pw = new PhysicsWorld(9.81);
  try {
    pw.addStaticTriMesh(collider);
    const body = pw.spawnProbe(
      { x: goalPair.start.x, y: goalPair.start.y + PROXY_RADIUS_M + 0.05, z: goalPair.start.z },
      PROXY_RADIUS_M,
    );
    const chain = goalPair.waypoints && goalPair.waypoints.length > 0
      ? goalPair.waypoints
      : [goalPair.goal];
    const floorY = Math.min(goalPair.start.y, ...chain.map((w) => w.y));
    const steps = Math.ceil(TIMEOUT_S / FIXED_DT);
    const WP_TOL_M = 0.4;
    let wp = 0;
    let best = Number.POSITIVE_INFINITY;
    let lastProgressT = 0;
    for (let i = 0; i < steps; i++) {
      const p = body.translation();
      const target = chain[Math.min(wp, chain.length - 1)]!;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      const gd = Math.hypot(goalPair.goal.x - p.x, goalPair.goal.z - p.z);
      if (gd < best - 0.05) {
        best = gd;
        lastProgressT = i * FIXED_DT;
      }
      if (wp >= chain.length - 1 && gd <= GOAL_TOL_M) {
        return { outcome: "reached", simSeconds: i * FIXED_DT, bestGoalDistM: gd };
      }
      if (wp < chain.length - 1 && d <= WP_TOL_M) {
        wp += 1; // advancing the chain counts as progress
        lastProgressT = i * FIXED_DT;
      }
      if (p.y < floorY - FALL_BELOW_M) {
        return { outcome: "fell", simSeconds: i * FIXED_DT, bestGoalDistM: best };
      }
      if (i * FIXED_DT - lastProgressT > PROGRESS_WINDOW_S) {
        return { outcome: "blocked", simSeconds: i * FIXED_DT, bestGoalDistM: best };
      }
      // command horizontal velocity toward the current waypoint; physics owns vertical
      const v = body.linvel();
      const inv = d > 1e-6 ? SPEED_MPS / d : 0;
      body.setLinvel({ x: dx * inv, y: v.y, z: dz * inv }, true);
      pw.step();
    }
    return { outcome: "blocked", simSeconds: TIMEOUT_S, bestGoalDistM: best };
  } finally {
    pw.free();
  }
}

/**
 * Select N start/goal pairs that the REPAIRED world's own survey certifies
 * as walkable corridors (every ray-grid cell along the straight segment is
 * floor-class). Deterministic under `seed`.
 */
export async function selectGoals(
  repaired: { collider: TriMesh; visualPoints: Float32Array; metadata: WorldMetadata; worldId: string },
  spawns: { x: number; y: number; z: number }[],
  n: number,
  seed: number,
  opts?: { probeCount?: number },
): Promise<PairedGoal[]> {
  const res = await certifyWorld(
    {
      worldId: repaired.worldId,
      collider: repaired.collider,
      visualPoints: repaired.visualPoints,
      metadata: repaired.metadata,
    },
    { seed, survey: { probeCount: opts?.probeCount ?? 2000 } },
  );
  const grid = res.survey.rayGrid;
  const classes = grid.channel("class");
  const surfaceY = grid.channel("surfaceY");
  const cols = grid.cols;
  const rows = grid.rows;
  const walkIdx = (c: number, r: number): number => r * cols + c;
  const rawWalk = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && classes[walkIdx(c, r)] === 1;
  // erode by one cell = agent-radius clearance, so BFS routes do not hug
  // walls and the proxy body cannot corner-clip into geometry
  const eroded = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!rawWalk(c, r)) continue;
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr++)
        for (let dc = -1; dc <= 1 && ok; dc++)
          if (!rawWalk(c + dc, r + dr)) ok = false;
      if (ok) eroded[walkIdx(c, r)] = 1;
    }
  }
  const isWalk = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && eroded[walkIdx(c, r)] === 1;
  /** snap a point to the nearest eroded-walkable cell within a small radius */
  const snap = (x: number, z: number): number => {
    const i = grid.index(x, z);
    if (eroded[i] === 1) return i;
    const c0 = i % cols;
    const r0 = Math.floor(i / cols);
    for (let rad = 1; rad <= 4; rad++)
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++)
          if (isWalk(c0 + dc, r0 + dr)) return walkIdx(c0 + dc, r0 + dr);
    return -1;
  };

  /** BFS shortest path on the walkable grid; returns cell-index chain or null */
  const bfsPath = (from: number, to: number): number[] | null => {
    if (from < 0 || to < 0 || eroded[from] !== 1 || eroded[to] !== 1) return null;
    const prev = new Int32Array(cols * rows).fill(-2);
    prev[from] = -1;
    const q: number[] = [from];
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]!;
      if (cur === to) break;
      const c = cur % cols;
      const r = Math.floor(cur / cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!isWalk(c + dc, r + dr)) continue;
        const ni = walkIdx(c + dc, r + dr);
        if (prev[ni] !== -2) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[to] === -2) return null;
    const path: number[] = [];
    for (let cur = to; cur !== -1; cur = prev[cur]!) path.push(cur);
    path.reverse();
    return path;
  };

  const cellPoint = (i: number): { x: number; y: number; z: number } => {
    const [x, z] = grid.center(i);
    return { x, y: surfaceY[i]!, z };
  };

  /** thin a cell path to waypoints every ~1 m plus the endpoints */
  const toWaypoints = (path: number[]): { x: number; y: number; z: number }[] => {
    const every = Math.max(1, Math.round(0.5 / grid.cellSize));
    const wps: { x: number; y: number; z: number }[] = [];
    for (let k = every; k < path.length - 1; k += every) wps.push(cellPoint(path[k]!));
    wps.push(cellPoint(path[path.length - 1]!));
    return wps;
  };
  // endpoint pool: verified spawns + seeded samples from the certified
  // walkable surface (eroded = clearance-safe), spread >= 2 m apart
  const rngEp = mulberry32(seed ^ 0x5eed);
  const endpoints: { x: number; y: number; z: number }[] = spawns.map((s) => ({ ...s }));
  const erodedIdx: number[] = [];
  for (let i = 0; i < eroded.length; i++) if (eroded[i] === 1) erodedIdx.push(i);
  for (let i = erodedIdx.length - 1; i > 0; i--) {
    const j = Math.floor(rngEp() * (i + 1));
    [erodedIdx[i], erodedIdx[j]] = [erodedIdx[j]!, erodedIdx[i]!];
  }
  for (const ci of erodedIdx) {
    if (endpoints.length >= Math.max(10, Math.ceil(Math.sqrt(n) * 3))) break;
    const p = cellPoint(ci);
    if (endpoints.every((e) => Math.hypot(e.x - p.x, e.z - p.z) >= 2.0)) endpoints.push(p);
  }

  const pairs: PairedGoal[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i]!;
      const b = endpoints[j]!;
      const from = snap(a.x, a.z);
      const to = snap(b.x, b.z);
      const path = bfsPath(from, to);
      if (!path) continue;
      const lengthM = path.length * grid.cellSize;
      if (lengthM < 2.0) continue; // trivial hop proves nothing
      pairs.push({
        id: pairs.length,
        start: cellPoint(path[0]!),
        goal: cellPoint(path[path.length - 1]!),
        waypoints: toWaypoints(path),
        distanceM: Math.round(lengthM * 100) / 100,
      });
    }
  }
  // deterministic shuffle, then longest-first bias: harder routes first
  const rng = mulberry32(seed);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
  }
  pairs.sort((a, b) => b.distanceM - a.distanceM);
  const picked = pairs.slice(0, n).map((p, k) => ({ ...p, id: k }));
  return picked;
}

export async function runPairedReceipt(
  raw: { collider: TriMesh },
  repaired: { collider: TriMesh; visualPoints: Float32Array; metadata: WorldMetadata; worldId: string },
  spawns: { x: number; y: number; z: number }[],
  n = 15,
  seed = 1234,
  opts?: { probeCount?: number },
): Promise<PairedReceipt> {
  const goals = await selectGoals(repaired, spawns, n, seed, opts);
  const rawResults: RouteResult[] = [];
  const repairedResults: RouteResult[] = [];
  for (const g of goals) {
    rawResults.push(await runRoute(raw.collider, g));
    repairedResults.push(await runRoute(repaired.collider, g));
  }
  const rawSuccess = rawResults.filter((r) => r.outcome === "reached").length;
  const repairedSuccess = repairedResults.filter((r) => r.outcome === "reached").length;
  return {
    n: goals.length,
    seed,
    controller: `driven sphere r=${PROXY_RADIUS_M} m, ${SPEED_MPS} m/s toward goal, Earth gravity, fixed dt ${FIXED_DT}`,
    caveat:
      "navmesh-level traversability with a kinematic waypoint controller, small N: " +
      "a floor for the training-contract claim, NOT a policy-transfer study",
    goals,
    raw: rawResults,
    repaired: repairedResults,
    rawSuccess,
    repairedSuccess,
    headline:
      `same ${goals.length} routes, same controller: raw world ${rawSuccess}/${goals.length}, ` +
      `repaired world ${repairedSuccess}/${goals.length}`,
  };
}
