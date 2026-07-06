/** Messages exchanged with the physics worker. Kept dependency-free. */

export interface InitMsg {
  kind: "init";
  /** Collider triangle soup, world space (already baked node transforms). */
  positions: Float32Array;
  indices: Uint32Array;
  probeCount: number;
  probeRadius: number;
  /** Drop height above the raycast surface hit, metres. */
  dropHeight: number;
  gravityY: number;
  seed: number;
}

export interface FrameMsg {
  kind: "frame";
  /** xyz per probe, transferable. */
  probePositions: Float32Array;
  /** Total physics steps taken since init. */
  stepCount: number;
  /** Worker-side wall-clock (ms, performance.now()) when posted. */
  postedAt: number;
}

export interface ReadyMsg {
  kind: "ready";
  probeCount: number;
  triangles: number;
}

export interface ErrorMsg {
  kind: "error";
  message: string;
}

// ------------------------------------------------------------ twin run (C6)
// The raw-world rover run executes INSIDE this worker: the probe world keeps
// the collider exactly as shipped (repairs mutate only the certify engine's
// copy), so Beats 1-3 can drive the raw physics. Each run builds a FRESH
// Rapier world (trimesh + one rover body) and steps it on the same fixed
// 1/60 s clock — the trajectory is a pure function of the route, independent
// of when the run is triggered or how the wall clock slices the steps.

/**
 * Rover collider half extents (m) — shared so the worker's physics body and
 * the viewer's mesh agree on where the ground is.
 */
export const ROVER_HALF_EXTENTS = { x: 0.17, y: 0.14, z: 0.25 } as const;

export interface RoverRunMsg {
  kind: "rover_run";
  runId: number;
  /** Floor point the rover starts on (worker adds half height + clearance). */
  start: [number, number, number];
  /** XZ waypoints driven in order; the run ends at the last one. */
  waypoints: Array<[number, number]>;
  speedMps: number;
  turnRateRps: number;
  arriveRadiusM: number;
  /** Below this y the rover has confirmably fallen out of the world. */
  fellY: number;
  /** Fixed-step budget; exceeding it ends the run as "timeout". */
  maxSteps: number;
}

export interface RoverStopMsg {
  kind: "rover_stop";
}

/**
 * Silent dry-run of a rover route (no frames): the twin run VALIDATES a
 * candidate route by physics before driving it on camera — raycast lane
 * heuristics cannot see every torn-mesh sliver, but the box itself can.
 * Deterministic: the visible run with identical params reproduces this
 * outcome step for step.
 */
export interface RoverProbeMsg extends Omit<RoverRunMsg, "kind" | "runId"> {
  kind: "rover_probe";
  probeId: number;
}

export interface RoverProbeResultMsg {
  kind: "rover_probe_result";
  probeId: number;
  outcome: RoverOutcome;
  step: number;
  x: number;
  y: number;
  z: number;
}

export type RoverOutcome = "fell" | "arrived" | "timeout";

export interface RoverFrameMsg {
  kind: "rover_frame";
  runId: number;
  /** Body CENTER position (viewer subtracts ROVER_HALF_EXTENTS.y for the mesh). */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Fixed steps since the run started. */
  step: number;
  /** Body linear velocity (debug/rehearsal telemetry). */
  vx?: number;
  vy?: number;
  vz?: number;
  /** Body orientation quaternion — the mesh tumbles with the physics. */
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
}

export interface RoverDoneMsg {
  kind: "rover_done";
  runId: number;
  outcome: RoverOutcome;
  x: number;
  y: number;
  z: number;
  step: number;
}

export type WorkerToMain = FrameMsg | ReadyMsg | ErrorMsg | RoverFrameMsg | RoverDoneMsg | RoverProbeResultMsg;
export type MainToWorker = InitMsg | RoverRunMsg | RoverStopMsg | RoverProbeMsg;
