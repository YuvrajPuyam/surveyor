/**
 * Monocular depth over the shipped 360° pano — pinhole crops fed to a small
 * depth model (Depth-Anything via transformers.js / ONNX; downloads once to
 * the local cache, then runs fully offline).
 *
 * The model's output is RELATIVE (affine-ambiguous, disparity-like:
 * larger = closer) — calibration against the shipped assets happens in
 * audit.ts; nothing here pretends to be metric.
 */
import type { Image } from "./equirect.js";
import { renderPinholeCrop } from "./equirect.js";

export interface DepthRay {
  /** view direction in PANO frame (unit) */
  dx: number;
  dy: number;
  dz: number;
  /** raw model prediction (relative; larger = closer) */
  pred: number;
  /** which crop it came from (debug/coverage) */
  crop: number;
}

export interface PanoDepthOptions {
  modelId?: string;
  cropSize?: number;
  fovDeg?: number;
  yaws?: number[];
  pitches?: number[];
  /** per-crop sample grid (g×g rays) */
  grid?: number;
  /** skip this fraction at each crop border (perspective edges are least reliable) */
  margin?: number;
  /** extra crops AIMED at specific directions (the certificate's defects) —
   *  appended after the ring crops; indices continue */
  targeted?: Array<{ yaw: number; pitch: number; fovDeg: number }>;
  onProgress?: (msg: string) => void;
}

export const PANO_DEPTH_DEFAULTS = {
  modelId: "Xenova/depth-anything-small-hf",
  cropSize: 336,
  fovDeg: 75,
  yaws: [0, 45, 90, 135, 180, 225, 270, 315].map((d) => (d * Math.PI) / 180),
  pitches: [0, -35].map((d) => (d * Math.PI) / 180), // horizon + floors
  grid: 22,
  margin: 0.1,
};

export async function loadPano(path: string): Promise<Image> {
  const { RawImage } = await import("@huggingface/transformers");
  const img = await RawImage.read(path);
  return { data: img.data as Uint8Array, width: img.width, height: img.height, channels: img.channels };
}

/** Run the depth model over pinhole crops; return sampled rays with predictions. */
export async function panoDepthRays(pano: Image, opts: PanoDepthOptions = {}): Promise<{ rays: DepthRay[]; meta: Record<string, unknown> }> {
  const o = { ...PANO_DEPTH_DEFAULTS, ...opts };
  const { pipeline, RawImage } = await import("@huggingface/transformers");
  o.onProgress?.(`loading depth model ${o.modelId} (cached after first run)…`);
  const depth = await pipeline("depth-estimation", o.modelId);

  const plan: Array<{ yaw: number; pitch: number; fovDeg: number; targeted: boolean }> = [];
  for (const pitch of o.pitches) for (const yaw of o.yaws) plan.push({ yaw, pitch, fovDeg: o.fovDeg, targeted: false });
  for (const t of o.targeted ?? []) plan.push({ ...t, targeted: true });

  const rays: DepthRay[] = [];
  let cropIdx = 0;
  for (const spec of plan) {
    const crop = renderPinholeCrop(pano, spec.yaw, spec.pitch, spec.fovDeg, o.cropSize);
    const img = new RawImage(crop.data, o.cropSize, o.cropSize, 3);
    const t0 = Date.now();
    const out = (await depth(img)) as { predicted_depth: { data: Float32Array; dims: number[] } };
    const pd = out.predicted_depth;
    const dims = pd.dims;
    const ph = dims[dims.length - 2];
    const pw = dims[dims.length - 1];
    o.onProgress?.(
      `crop ${cropIdx + 1}/${plan.length}${spec.targeted ? " [targeted]" : ""} (yaw ${((spec.yaw * 180) / Math.PI).toFixed(0)}°, pitch ${((spec.pitch * 180) / Math.PI).toFixed(0)}°, fov ${spec.fovDeg.toFixed(0)}°): ${pw}×${ph} depth in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    const lo = o.margin;
    const hi = 1 - o.margin;
    for (let gy = 0; gy < o.grid; gy++) {
      for (let gx = 0; gx < o.grid; gx++) {
        const fx = lo + ((gx + 0.5) / o.grid) * (hi - lo);
        const fy = lo + ((gy + 0.5) / o.grid) * (hi - lo);
        // sample prediction at (fx, fy) of the model's own output grid
        const px = Math.min(pw - 1, Math.round(fx * pw));
        const py = Math.min(ph - 1, Math.round(fy * ph));
        const pred = pd.data[py * pw + px];
        // matching view direction from the crop's dir buffer
        const cx = Math.min(o.cropSize - 1, Math.round(fx * o.cropSize));
        const cy = Math.min(o.cropSize - 1, Math.round(fy * o.cropSize));
        const di = (cy * o.cropSize + cx) * 3;
        rays.push({ dx: crop.dirs[di], dy: crop.dirs[di + 1], dz: crop.dirs[di + 2], pred, crop: cropIdx });
      }
    }
    cropIdx++;
  }
  return {
    rays,
    meta: {
      modelId: o.modelId,
      crops: cropIdx,
      targetedCrops: (o.targeted ?? []).length,
      cropSize: o.cropSize,
      fovDeg: o.fovDeg,
      grid: o.grid,
      margin: o.margin,
      raysSampled: rays.length,
    },
  };
}
