/**
 * Physics Web Worker — Rapier trimesh world + probe rain.
 *
 * Receives the collider triangle soup, spawns `probeCount` dynamic balls
 * `dropHeight` metres above raycast-verified surface points (same idea as
 * the certify pipeline's probe rain), steps a fixed 1/60 s clock, and posts
 * probe positions to the main thread as a transferable Float32Array.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { InitMsg, MainToWorker, RoverOutcome, RoverProbeMsg, RoverRunMsg, WorkerToMain } from "./protocol";
import { ROVER_HALF_EXTENTS } from "./protocol";

// Typed view of the dedicated-worker global without pulling in the WebWorker
// lib (which conflicts with the DOM lib used by the rest of the app).
interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

function post(msg: WorkerToMain, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer);
}

/** Deterministic PRNG (mulberry32) so probe rain is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_TICK = 5; // clamp catch-up so a stall cannot spiral

let world: RAPIER.World | null = null;
let bodies: RAPIER.RigidBody[] = [];
let stepCount = 0;
let accumulator = 0;
let lastTick = 0;

// Raw collider soup, retained for twin-run rover worlds. The probe world and
// every rover run are built from these SAME bytes — the world as shipped;
// repairs never reach this worker.
let rawSoup: { positions: Float32Array; indices: Uint32Array } | null = null;
let rawGravityY = -9.81;

function computeAabb(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

function init(msg: InitMsg): void {
  // Rapier copies the buffers into WASM; the JS arrays stay valid here for
  // building rover-run worlds later.
  rawSoup = { positions: msg.positions, indices: msg.indices };
  rawGravityY = msg.gravityY;

  world = new RAPIER.World({ x: 0, y: msg.gravityY, z: 0 });
  world.timestep = FIXED_DT;

  // Static trimesh collider.
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(msg.positions, msg.indices), groundBody);

  // Probe rain: sample random XZ inside the collider AABB, raycast straight
  // down from above the world; if the ray hits a surface, spawn a ball
  // dropHeight above the hit point. Points with no surface below are skipped
  // (they would free-fall forever and tell us nothing).
  const rand = mulberry32(msg.seed);
  const { min, max } = computeAabb(msg.positions);
  const ceilingY = max[1] + 1;
  const maxRayLen = max[1] - min[1] + 2;
  const ray = new RAPIER.Ray({ x: 0, y: ceilingY, z: 0 }, { x: 0, y: -1, z: 0 });

  bodies = [];
  let attempts = 0;
  const maxAttempts = msg.probeCount * 20;
  while (bodies.length < msg.probeCount && attempts < maxAttempts) {
    attempts++;
    const x = min[0] + rand() * (max[0] - min[0]);
    const z = min[2] + rand() * (max[2] - min[2]);
    ray.origin.x = x;
    ray.origin.z = z;
    const hit = world.castRay(ray, maxRayLen, true);
    if (!hit) continue;
    const hitY = ceilingY - hit.timeOfImpact;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, hitY + msg.dropHeight, z)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(msg.probeRadius).setRestitution(0.3).setFriction(0.6),
      body,
    );
    bodies.push(body);
  }

  post({ kind: "ready", probeCount: bodies.length, triangles: msg.indices.length / 3 });

  lastTick = performance.now();
  accumulator = 0;
  // ~120 Hz tick; the accumulator turns wall time into exact 1/60 steps.
  setInterval(tick, 8);
}

// ---------------------------------------------------------- twin-run rover
// Deterministic by construction: a FRESH world per run (identical build
// order), a fixed 1/60 s step, and a driving control that is a pure function
// of the rover's own state and the route — the patrol's turn-rate steering
// model, executed inside the physics clock instead of the render clock. The
// wall clock only decides how many steps run per tick, never what they do.

interface RoverRun {
  runId: number;
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  waypoints: Array<[number, number]>;
  targetIdx: number;
  heading: number;
  speedMps: number;
  turnRateRps: number;
  arriveRadiusM: number;
  fellY: number;
  maxSteps: number;
  step: number;
  done: boolean;
}

let roverRun: RoverRun | null = null;

function disposeRoverRun(): void {
  if (!roverRun) return;
  roverRun.world.free();
  roverRun = null;
}

/** Build a fresh rover world + run state from route params (raw collider bytes). */
function buildRoverRun(runId: number, msg: Omit<RoverRunMsg, "kind" | "runId">): RoverRun | null {
  if (!rawSoup || msg.waypoints.length === 0) return null;
  const w = new RAPIER.World({ x: 0, y: rawGravityY, z: 0 });
  w.timestep = FIXED_DT;
  const ground = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  w.createCollider(RAPIER.ColliderDesc.trimesh(rawSoup.positions, rawSoup.indices), ground);
  const [sx, sy, sz] = msg.start;
  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(sx, sy + ROVER_HALF_EXTENTS.y + 0.05, sz)
      .setCcdEnabled(true)
      // Pitch/roll FREE, yaw locked (steering owns heading): a fully locked
      // box corner-jams on every concave seam — crate lips, terrain folds —
      // and parks; a suspension-less rover still rides relief by pitching.
      .enabledRotations(true, false, true)
      .setAngularDamping(1.5),
  );
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(ROVER_HALF_EXTENTS.x, ROVER_HALF_EXTENTS.y, ROVER_HALF_EXTENTS.z)
      .setFriction(0.9)
      .setRestitution(0),
    body,
  );
  const wp0 = msg.waypoints[0]!;
  return {
    runId,
    world: w,
    body,
    waypoints: msg.waypoints,
    targetIdx: 0,
    heading: Math.atan2(wp0[0] - sx, wp0[1] - sz),
    speedMps: msg.speedMps,
    turnRateRps: msg.turnRateRps,
    arriveRadiusM: msg.arriveRadiusM,
    fellY: msg.fellY,
    maxSteps: msg.maxSteps,
    step: 0,
    done: false,
  };
}

function startRoverRun(msg: RoverRunMsg): void {
  disposeRoverRun();
  const run = buildRoverRun(msg.runId, msg);
  if (!run) {
    // Not initialized yet (or empty route) — report an immediate timeout so
    // the UI never waits on a run that cannot happen.
    post({ kind: "rover_done", runId: msg.runId, outcome: "timeout", x: msg.start[0], y: msg.start[1], z: msg.start[2], step: 0 });
    return;
  }
  roverRun = run;
}

/**
 * Silent dry-run: step the whole route to its outcome in a tight loop (no
 * frames, sub-second for thousands of steps) — the twin run validates a
 * candidate by PHYSICS before driving it on camera. Determinism guarantees
 * the visible run reproduces this outcome step for step.
 */
function probeRoverRoute(msg: RoverProbeMsg): void {
  const run = buildRoverRun(-1, msg);
  if (!run) {
    post({ kind: "rover_probe_result", probeId: msg.probeId, outcome: "timeout", step: 0, x: msg.start[0], y: msg.start[1], z: msg.start[2] });
    return;
  }
  let outcome: RoverOutcome | null = null;
  while (outcome === null) outcome = stepRoverCore(run);
  const t = run.body.translation();
  run.world.free();
  post({ kind: "rover_probe_result", probeId: msg.probeId, outcome, step: run.step, x: t.x, y: t.y, z: t.z });
}

function finishRoverRun(run: RoverRun, outcome: "fell" | "arrived" | "timeout"): void {
  run.done = true;
  const t = run.body.translation();
  post({ kind: "rover_frame", runId: run.runId, x: t.x, y: t.y, z: t.z, heading: run.heading, step: run.step });
  post({ kind: "rover_done", runId: run.runId, outcome, x: t.x, y: t.y, z: t.z, step: run.step });
}

/**
 * One fixed step of the rover world: control → step → outcome checks.
 * Pure state machine — returns the outcome when the run ends, else null.
 * Shared verbatim by the on-camera run and the silent dry-run probe.
 */
function stepRoverCore(run: RoverRun): RoverOutcome | null {
  const t = run.body.translation();
  const lv = run.body.linvel();

  // Driving control only with traction: once the floor stops holding the
  // rover (it is falling), the wheels spin in air — horizontal velocity is
  // whatever inertia says, exactly like the real failure would be.
  const grounded = lv.y > -0.75;
  if (grounded) {
    const wp = run.waypoints[run.targetIdx]!;
    const dx = wp[0] - t.x;
    const dz = wp[1] - t.z;
    const dist = Math.hypot(dx, dz);
    if (dist < run.arriveRadiusM) {
      if (run.targetIdx >= run.waypoints.length - 1) {
        return "arrived";
      }
      run.targetIdx += 1;
    } else {
      // The patrol driving model: turn-rate-limited heading, slow in corners.
      const desired = Math.atan2(dx, dz);
      let delta = desired - run.heading;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const maxTurn = run.turnRateRps * FIXED_DT;
      run.heading += Math.min(maxTurn, Math.max(-maxTurn, delta));
      const align = Math.max(0.25, Math.cos(delta));
      const v = run.speedMps * align;
      run.body.setLinvel({ x: Math.sin(run.heading) * v, y: lv.y, z: Math.cos(run.heading) * v }, true);
    }
  }

  run.world.step();
  run.step += 1;

  const p = run.body.translation();
  if (p.y < run.fellY) return "fell";
  if (run.step >= run.maxSteps) return "timeout";
  return null;
}

/** On-camera step wrapper: posts the outcome when the run ends. */
function stepRover(run: RoverRun): void {
  const outcome = stepRoverCore(run);
  if (outcome !== null) finishRoverRun(run, outcome);
}

function tick(): void {
  if (!world) return;
  const now = performance.now();
  accumulator += (now - lastTick) / 1000;
  lastTick = now;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
    world.step();
    stepCount++;
    if (roverRun && !roverRun.done) stepRover(roverRun);
    steps++;
    accumulator -= FIXED_DT;
  }
  if (steps === MAX_STEPS_PER_TICK) accumulator = 0; // drop backlog after a stall

  if (steps === 0) return; // nothing new to report

  if (roverRun && !roverRun.done) {
    const t = roverRun.body.translation();
    const lv = roverRun.body.linvel();
    const q = roverRun.body.rotation();
    post({
      kind: "rover_frame",
      runId: roverRun.runId,
      x: t.x,
      y: t.y,
      z: t.z,
      heading: roverRun.heading,
      step: roverRun.step,
      vx: lv.x,
      vy: lv.y,
      vz: lv.z,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
    });
  }

  const out = new Float32Array(bodies.length * 3);
  for (let i = 0; i < bodies.length; i++) {
    const t = bodies[i]!.translation();
    out[i * 3] = t.x;
    out[i * 3 + 1] = t.y;
    out[i * 3 + 2] = t.z;
  }
  post({ kind: "frame", probePositions: out, stepCount, postedAt: now }, [out.buffer]);
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as MainToWorker;
  if (msg.kind === "rover_run") {
    startRoverRun(msg);
    return;
  }
  if (msg.kind === "rover_probe") {
    probeRoverRoute(msg);
    return;
  }
  if (msg.kind === "rover_stop") {
    disposeRoverRun();
    return;
  }
  if (msg.kind !== "init") return;
  RAPIER.init()
    .then(() => init(msg))
    .catch((err: unknown) => post({ kind: "error", message: String(err) }));
};
