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

export type WorkerToMain = FrameMsg | ReadyMsg | ErrorMsg;
export type MainToWorker = InitMsg;
