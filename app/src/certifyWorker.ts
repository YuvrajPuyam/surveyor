/**
 * Certify Web Worker — runs the REAL headless certify/repair core in the
 * browser (src/certify/* and src/repair/engine.ts are fs-free; Rapier compat
 * WASM is isomorphic). NEVER calls engine.exportBundle (the only node-bound
 * method).
 *
 * Lifecycle: receives {type:"init"} with bundle URLs, fetches + parses the
 * collider GLB and the visual-points f32 inside the worker, constructs a
 * RepairEngine, runs the first certification, then serves RPCs that reuse
 * src/agent/tools.ts dispatchTool verbatim — the browser UI drives the exact
 * closed tool menu the repair agent uses.
 *
 * Streaming: {type:"phase"} progress events during (re)certification, and a
 * fresh {type:"trustmap"} + {type:"defects"} pair after init and after every
 * recertify, so the trust map repaints live.
 *
 * Protocol types live in ./workerClient.ts (type-only import; no runtime
 * coupling).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RepairEngine } from "../../src/repair/engine.js";
import { dispatchTool, summarizeCertificate } from "../../src/agent/tools.js";
import type { CertifyResult } from "../../src/certify/certificate.js";
import type { WorldMetadata } from "../../src/core/types.js";
import type { CertifyWorkerEvent, CertifyWorkerRequest, InitRequest, RpcRequest } from "./workerClient";

// Typed view of the dedicated-worker global without pulling in the WebWorker
// lib (which conflicts with the DOM lib used by the rest of the app).
interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

function post(msg: CertifyWorkerEvent): void {
  ctx.postMessage(msg);
}

// ------------------------------------------------------------ bundle load

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error(`fetch ${url}: got the SPA fallback page, not the file`);
  return res.arrayBuffer();
}

interface TriSoup {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Bake world transforms and merge every mesh primitive into one soup (same as main.ts). */
function extractTriSoup(root: THREE.Object3D): TriSoup {
  root.updateMatrixWorld(true);
  const parts: Array<{ pos: Float32Array; idx: Uint32Array }> = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const posAttr = mesh.geometry.getAttribute("position");
    if (!posAttr) return;
    const pos = new Float32Array(posAttr.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
    }
    let idx: Uint32Array;
    if (mesh.geometry.index) {
      idx = Uint32Array.from(mesh.geometry.index.array);
    } else {
      idx = new Uint32Array(posAttr.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
    }
    parts.push({ pos, idx });
  });
  let vtx = 0;
  let ind = 0;
  for (const p of parts) {
    vtx += p.pos.length;
    ind += p.idx.length;
  }
  const positions = new Float32Array(vtx);
  const indices = new Uint32Array(ind);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.pos, vo);
    for (let i = 0; i < p.idx.length; i++) indices[io + i] = p.idx[i]! + vo / 3;
    vo += p.pos.length;
    io += p.idx.length;
  }
  return { positions, indices };
}

// ----------------------------------------------------------------- engine

let engine: RepairEngine | null = null;

/**
 * The engine keeps its last CertifyResult private; the trust map (per-cell
 * states + dims from trustmap.ts) lives there. Reach in with a typed cast —
 * the one seam between the browser lane and the headless core. (A public
 * getter on RepairEngine would be the clean follow-up.)
 */
function lastCertifyResult(): CertifyResult | null {
  return engine ? (engine as unknown as { lastResult: CertifyResult | null }).lastResult : null;
}

/** Post a fresh trust map + defect list (after init and every recertify). */
function streamState(): void {
  if (!engine) return;
  const last = lastCertifyResult();
  if (last) post({ type: "trustmap", trustMap: last.trustMap });
  const cert = summarizeCertificate(engine.getCertificate());
  post({
    type: "defects",
    defects: cert.defects,
    grade: cert.grade,
    openDefectIds: engine.openDefects().map((d) => d.id),
  });
  void postContentHash();
}

/**
 * Certificate content SHA-256 (createdAt normalized out) — the SAME bytes
 * the CLI and report.html hash, so the chip in the UI, the report footer,
 * and the hash pre-printed on the Devpost all agree on a live re-run.
 */
async function postContentHash(): Promise<void> {
  if (!engine) return;
  const json = JSON.stringify({ ...engine.getCertificate(), createdAt: "" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  post({ type: "hash", hash });
}

// --------------------------------------------------------------- handlers

async function handleInit(msg: InitRequest): Promise<void> {
  try {
    post({ type: "phase", phase: "fetching-collider", detail: msg.colliderUrl });
    const glb = await fetchBuffer(msg.colliderUrl);

    post({ type: "phase", phase: "parsing-collider" });
    const gltf = await new GLTFLoader().parseAsync(glb, "");
    const soup = extractTriSoup(gltf.scene);
    if (soup.indices.length === 0) throw new Error("collider GLB contained no triangles");

    post({ type: "phase", phase: "fetching-visual-points", detail: msg.visualPointsUrl });
    const raw = await fetchBuffer(msg.visualPointsUrl);
    let visualPoints = new Float32Array(raw);
    if (visualPoints.length % 3 !== 0) visualPoints = visualPoints.subarray(0, visualPoints.length - (visualPoints.length % 3));

    // Best-effort Gaussian-scale sidecar: the headless CLI loads it, so the
    // browser must too or the divergence counts drift apart (stale/absent
    // sidecars are dropped exactly like bundleIO does).
    let visualScales: Float32Array | undefined;
    if (msg.visualScalesUrl) {
      try {
        const sraw = await fetchBuffer(msg.visualScalesUrl);
        visualScales = new Float32Array(sraw);
        if (visualScales.length !== visualPoints.length / 3) visualScales = undefined;
      } catch {
        visualScales = undefined;
      }
    }

    let metadata: WorldMetadata | undefined = msg.metadata;
    if (!metadata && msg.metadataUrl) {
      // best-effort: a bundle without metadata.json still certifies (no vendor scale factor)
      try {
        const res = await fetch(msg.metadataUrl);
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && !type.includes("text/html")) metadata = (await res.json()) as WorldMetadata;
      } catch {
        /* fall through to default */
      }
    }
    metadata ??= { worldId: msg.worldId, source: "marble" };

    post({ type: "phase", phase: "physics-init", detail: `${(soup.indices.length / 3).toLocaleString()} tris, ${(visualPoints.length / 3).toLocaleString()} splat centers` });
    engine = new RepairEngine(
      { worldId: msg.worldId, collider: soup, visualPoints, visualScales, metadata },
      { seed: msg.seed, probeCount: msg.probeCount, gravity: msg.gravity },
    );

    post({ type: "phase", phase: "certifying", detail: `probe rain (${msg.probeCount ?? 2000} probes) + virtual LiDAR + divergence` });
    const certificate = await engine.init();

    streamState();
    post({ type: "phase", phase: "ready" });
    post({
      type: "result",
      id: msg.id,
      ok: true,
      result: { certificate: summarizeCertificate(certificate), trustMap: lastCertifyResult()!.trustMap },
    });
  } catch (err) {
    engine = null;
    post({ type: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleRpc(msg: RpcRequest): Promise<void> {
  if (!engine) {
    post({ type: "result", id: msg.id, ok: false, error: "engine not initialized — send {type:'init'} first" });
    return;
  }
  try {
    const isRecertify = msg.tool === "recertify";
    if (isRecertify) {
      const scope = (msg.input as { scope?: string } | undefined)?.scope ?? "full";
      post({ type: "phase", phase: "recertifying", detail: `${scope} re-certification` });
    }
    // dispatchTool is the agent's dispatcher — the browser drives the exact
    // same closed tool menu (exportBundle is not on the menu; never call it).
    const result = await dispatchTool(engine, msg.tool, msg.input);
    if (isRecertify) {
      streamState();
      post({ type: "phase", phase: "ready" });
    }
    post({ type: "result", id: msg.id, ok: true, result });
  } catch (err) {
    post({ type: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Serialize all requests: the engine mutates shared state (operation stack,
// ledger), so RPCs run strictly in arrival order.
let queue: Promise<void> = Promise.resolve();

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as CertifyWorkerRequest;
  if (msg.type !== "init" && msg.type !== "rpc") return;
  queue = queue.then(() => (msg.type === "init" ? handleInit(msg) : handleRpc(msg)));
};
