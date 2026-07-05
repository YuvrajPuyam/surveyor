/**
 * Physics Web Worker — Rapier trimesh world + probe rain.
 *
 * Receives the collider triangle soup, spawns `probeCount` dynamic balls
 * `dropHeight` metres above raycast-verified surface points (same idea as
 * the certify pipeline's probe rain), steps a fixed 1/60 s clock, and posts
 * probe positions to the main thread as a transferable Float32Array.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { InitMsg, MainToWorker, WorkerToMain } from "./protocol";

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

function tick(): void {
  if (!world) return;
  const now = performance.now();
  accumulator += (now - lastTick) / 1000;
  lastTick = now;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
    world.step();
    stepCount++;
    steps++;
    accumulator -= FIXED_DT;
  }
  if (steps === MAX_STEPS_PER_TICK) accumulator = 0; // drop backlog after a stall

  if (steps === 0) return; // nothing new to report

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
  if (msg.kind !== "init") return;
  RAPIER.init()
    .then(() => init(msg))
    .catch((err: unknown) => post({ kind: "error", message: String(err) }));
};
