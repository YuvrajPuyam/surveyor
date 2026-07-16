/**
 * Typed client for the certify worker (certifyWorker.ts).
 *
 * Owns the postMessage protocol types for BOTH sides (the worker imports
 * them type-only). The client wraps every repair-agent tool in a typed async
 * method; streaming events (survey phases, trust-map paints, defect-list
 * updates) arrive on the onPhase / onTrustMap / onDefects callbacks.
 *
 * Message protocol
 * ----------------
 * main -> worker:
 *   { type:"init", id, worldId, colliderUrl, visualPointsUrl,
 *     metadata?, seed?, probeCount?, gravity? }
 *   { type:"rpc",  id, tool, input? }        // tool = agent tool name
 * worker -> main:
 *   { type:"phase",    phase, detail? }      // progress while (re)certifying
 *   { type:"trustmap", trustMap }            // after init and every recertify
 *   { type:"defects",  defects, grade, openDefectIds }   // ditto
 *   { type:"result",   id, ok:true,  result }            // RPC reply
 *   { type:"result",   id, ok:false, error }             // RPC failure
 */
import type { Certificate, Gravity, TrustSummary, WorldMetadata } from "../../src/core/types.js";
import type { TrustMap } from "../../src/certify/trustmap.js";
import type { SpawnPoint } from "../../src/repair/engine.js";

// --------------------------------------------------------------- protocol

/** Agent tool names — the closed 11-tool menu of src/agent/tools.ts. */
export type RepairToolName =
  | "get_certificate"
  | "inspect_region"
  | "query_measurement"
  | "apply_vendor_scale"
  | "patch_hole"
  | "carve_opening"
  | "quarantine"
  | "accept_defect"
  | "rebuild_navmesh_and_spawns"
  | "revert"
  | "recertify";

export interface InitRequest {
  type: "init";
  id: number;
  worldId: string;
  /** URL of the collider GLB (fetched + parsed inside the worker). */
  colliderUrl: string;
  /** URL of the raw float32 xyz splat-center file. */
  visualPointsUrl: string;
  /** Optional per-splat max Gaussian scale sidecar — the headless CLI loads it, so the browser must too or divergence counts drift. */
  visualScalesUrl?: string;
  /** Optional metadata.json URL — fetched in the worker when `metadata` is not given (vendor metricScaleFactor lives there). */
  metadataUrl?: string;
  metadata?: WorldMetadata;
  seed?: number;
  probeCount?: number;
  gravity?: Gravity;
}

export interface RpcRequest {
  type: "rpc";
  id: number;
  tool: RepairToolName;
  input?: unknown;
}

export type CertifyWorkerRequest = InitRequest | RpcRequest;

export type CertifyPhase =
  | "fetching-collider"
  | "parsing-collider"
  | "fetching-visual-points"
  | "physics-init"
  | "certifying"
  | "recertifying"
  | "ready";

/** Trust map payload: per-cell states + dims/origin so the app can draw it. */
export type TrustMapPayload = TrustMap;

export interface PhaseEvent {
  type: "phase";
  phase: CertifyPhase;
  detail?: string;
}

/** Fine-grained survey progress (throttled in the worker) — drives the progress bar. */
export interface ProgressEvent {
  type: "progress";
  /** "virtual-lidar" | "probe-rain" | "divergence-splats" | "divergence-collider" */
  stage: string;
  done: number;
  total: number;
}

export interface TrustMapEvent {
  type: "trustmap";
  trustMap: TrustMapPayload;
}

export interface HashEvent {
  type: "hash";
  /** certificate content SHA-256 (createdAt normalized out) — matches the CLI/report hash */
  hash: string;
}

export interface DefectsEvent {
  type: "defects";
  defects: DefectSummary[];
  grade: string;
  openDefectIds: string[];
}

export type RpcResultEvent =
  | { type: "result"; id: number; ok: true; result: unknown }
  | { type: "result"; id: number; ok: false; error: string };

export type CertifyWorkerEvent = PhaseEvent | ProgressEvent | TrustMapEvent | DefectsEvent | HashEvent | RpcResultEvent;

// ---------------------------------------------- compact result shapes
// These mirror src/agent/tools.ts summarize* outputs (numbers-not-pixels).

export interface MeasurementSummary {
  name: string;
  value: number;
  unit: string;
  range: number[];
  basis: string;
  method: string;
}

export interface DefectSummary {
  id: string;
  type: string;
  severity: "critical" | "major" | "minor";
  confidence: number;
  region: { min: number[]; max: number[] };
  description: string;
  evidence: { kind: string; detail: string }[];
  /** recorded outcome, or "OPEN" */
  outcome: string;
  outcomeNote?: string;
}

export interface VerdictSummary {
  robot: string;
  check: string;
  pass: boolean | "not_evaluated";
  measured?: MeasurementSummary;
  requirement: string;
  gravityNote: string;
}

export interface CertificateSummary {
  worldId: string;
  gravity: string;
  grade: string;
  gradeRationale: string;
  trust: { verifiedPct: number; lyingPct: number };
  defects: DefectSummary[];
  robotVerdicts: VerdictSummary[];
  scale: Certificate["scale"];
}

export interface RecertifySummary {
  scope: "regional" | "full";
  grade: string;
  resolvedDefectIds: string[];
  newDefects: DefectSummary[];
  verdictRegressions: { robotId: string; check: string; requirement: string }[];
  openDefects: string[];
}

export interface InitResult {
  certificate: CertificateSummary;
  trustMap: TrustMapPayload;
}

export interface InspectRegionResult {
  defect: DefectSummary;
  stats: { visualPointsInRegion: number; colliderTrianglesInRegion: number; floorPlaneY: number };
}

export type { TrustMap, TrustSummary, SpawnPoint, Gravity, WorldMetadata };

export interface InitParams {
  worldId: string;
  colliderUrl: string;
  visualPointsUrl: string;
  visualScalesUrl?: string;
  metadataUrl?: string;
  metadata?: WorldMetadata;
  seed?: number;
  probeCount?: number;
  gravity?: Gravity;
}

// ------------------------------------------------------------------ client

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class CertifyWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  /** Survey progress ("fetching-collider" ... "certifying" ... "ready"). */
  onPhase?: (phase: CertifyPhase, detail?: string) => void;
  /** Fine-grained survey progress — stage + (done/total), throttled worker-side. */
  onProgress?: (stage: string, done: number, total: number) => void;
  /** Fires after init and after EVERY recertify — repaint the trust map. */
  onTrustMap?: (trustMap: TrustMapPayload) => void;
  /** Fires after init and after EVERY recertify — refresh the defect list. */
  onDefects?: (ev: DefectsEvent) => void;
  /** Fires after init and after EVERY recertify — the certificate content SHA-256 (determinism chip). */
  onHash?: (hash: string) => void;

  constructor() {
    this.worker = new Worker(new URL("./certifyWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<CertifyWorkerEvent>) => {
      const msg = ev.data;
      if (msg.type === "phase") this.onPhase?.(msg.phase, msg.detail);
      else if (msg.type === "progress") this.onProgress?.(msg.stage, msg.done, msg.total);
      else if (msg.type === "trustmap") this.onTrustMap?.(msg.trustMap);
      else if (msg.type === "defects") this.onDefects?.(msg);
      else if (msg.type === "hash") this.onHash?.(msg.hash);
      else if (msg.type === "result") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const err = new Error(`certify worker crashed: ${e.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  // ------------------------------------------------------------ lifecycle

  /** Fetch + parse the bundle in the worker, build the engine, run the first certification. */
  init(params: InitParams): Promise<InitResult> {
    const id = this.nextId++;
    const msg: InitRequest = { type: "init", id, ...params };
    return this.send(id, msg) as Promise<InitResult>;
  }

  /** The FULL certificate (what the CLI writes and the content hash covers) — not the compact summary. */
  getFullCertificate(): Promise<unknown> {
    const id = this.nextId++;
    const msg = { type: "rpc", id, tool: "get_full_certificate" } as unknown as RpcRequest;
    return this.send(id, msg);
  }

  /** Convenience: init from a bundle dir ("/marble/<id>") using standard file names. */
  initBundle(dir: string, opts: Omit<InitParams, "worldId" | "colliderUrl" | "visualPointsUrl"> & { worldId?: string } = {}): Promise<InitResult> {
    const clean = dir.endsWith("/") ? dir.slice(0, -1) : dir;
    return this.init({
      worldId: opts.worldId ?? clean.split("/").pop() ?? clean,
      colliderUrl: `${clean}/collider.glb`,
      visualPointsUrl: `${clean}/visual-points.f32`,
      visualScalesUrl: `${clean}/visual-scales.f32`,
      metadataUrl: `${clean}/metadata.json`,
      ...opts,
    });
  }

  dispose(): void {
    this.worker.terminate();
    const err = new Error("certify worker disposed");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  // ------------------------------------------------------------ tool RPCs

  /** Full re-certification (alias for recertify("full")). init() already certifies once. */
  certify(): Promise<RecertifySummary> {
    return this.recertify("full");
  }

  getCertificate(): Promise<CertificateSummary> {
    return this.rpc("get_certificate") as Promise<CertificateSummary>;
  }

  inspectRegion(defectId: string): Promise<InspectRegionResult> {
    return this.rpc("inspect_region", { defectId }) as Promise<InspectRegionResult>;
  }

  queryMeasurement(name: string): Promise<MeasurementSummary[] | { error: string }> {
    return this.rpc("query_measurement", { name }) as Promise<MeasurementSummary[] | { error: string }>;
  }

  applyVendorScale(): Promise<{ actionId: string; factorApplied: number }> {
    return this.rpc("apply_vendor_scale") as Promise<{ actionId: string; factorApplied: number }>;
  }

  patchHole(defectId: string, method: "fitted_slab" | "mesh_fill"): Promise<{ actionId: string; slabTopY: number }> {
    return this.rpc("patch_hole", { defectId, method }) as Promise<{ actionId: string; slabTopY: number }>;
  }

  carveOpening(defectId: string): Promise<{ actionId: string; trianglesRemoved: number }> {
    return this.rpc("carve_opening", { defectId }) as Promise<{ actionId: string; trianglesRemoved: number }>;
  }

  quarantine(ids: string | string[], reason: string): Promise<{ defectIds: string[]; actionIds: string[]; outcome: string }> {
    const input = Array.isArray(ids) ? { defectIds: ids, reason } : { defectId: ids, reason };
    return this.rpc("quarantine", input) as Promise<{ defectIds: string[]; actionIds: string[]; outcome: string }>;
  }

  acceptDefect(ids: string | string[], reason: string): Promise<{ defectIds: string[]; outcome: string }> {
    const input = Array.isArray(ids) ? { defectIds: ids, reason } : { defectId: ids, reason };
    return this.rpc("accept_defect", input) as Promise<{ defectIds: string[]; outcome: string }>;
  }

  rebuildSpawns(): Promise<{ actionId: string; spawns: SpawnPoint[] }> {
    return this.rpc("rebuild_navmesh_and_spawns") as Promise<{ actionId: string; spawns: SpawnPoint[] }>;
  }

  revert(actionId: string): Promise<{ reverted: string }> {
    return this.rpc("revert", { actionId }) as Promise<{ reverted: string }>;
  }

  /** regional requires a defectId; streams fresh trustmap + defects events after. */
  recertify(scope: "regional" | "full", defectId?: string): Promise<RecertifySummary> {
    return this.rpc("recertify", defectId ? { scope, defectId } : { scope }) as Promise<RecertifySummary>;
  }

  /** Escape hatch: raw dispatch onto any agent tool. */
  rpc(tool: RepairToolName, input?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg: RpcRequest = { type: "rpc", id, tool, input };
    return this.send(id, msg);
  }

  // ------------------------------------------------------------- internals

  private send(id: number, msg: CertifyWorkerRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }
}
