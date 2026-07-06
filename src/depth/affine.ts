/**
 * Robust affine calibration for monocular depth — the honesty core of the
 * image-depth instrument.
 *
 * A monocular depth model predicts depth only up to an unknown affine map
 * (scale + shift) in inverse-depth space. We fit that map against metric
 * depths measured on the CONSENSUS set (rays where the splat cloud and the
 * collider already agree — the two existing instruments vouching for each
 * other), then use the calibrated model to audit everything else. The fit
 * is RANSAC + IRLS so hallucinated regions inside the calibration set
 * cannot drag the line; the residual statistics are REPORTED, not hidden —
 * they are the instrument's own error bars.
 */
import { hashSeed, mulberry32 } from "../core/prng.js";

export interface AffineFit {
  /** metric inverse depth ≈ s · prediction + t */
  s: number;
  t: number;
  inlierFraction: number;
  /** median absolute residual of inliers, in inverse-depth units (1/m) */
  residualMadInv: number;
  /** median relative depth error of inliers, |d̂ − d| / d */
  medianRelDepthErr: number;
  n: number;
}

/** Spearman rank correlation — scale/shift-free sanity check of the frame. */
export function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return 0;
  const rank = (xs: number[]): number[] => {
    const idx = xs.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; i++) r[idx[i][1]] = i;
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = ra[i] - mean;
    const xb = rb[i] - mean;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Fit inverse-metric-depth ≈ s·pred + t robustly.
 * @param pred   model outputs (relative, affine-ambiguous; larger = closer for DPT-family)
 * @param metric measured metric depths (m) on the same rays
 */
export function fitAffineDepth(pred: number[], metric: number[], seed = 1234): AffineFit {
  const n = Math.min(pred.length, metric.length);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(pred[i]) && Number.isFinite(metric[i]) && metric[i] > 0.05) {
      xs.push(pred[i]);
      ys.push(1 / metric[i]);
    }
  }
  const m = xs.length;
  if (m < 8) return { s: 0, t: 0, inlierFraction: 0, residualMadInv: Infinity, medianRelDepthErr: Infinity, n: m };

  // scale-aware inlier tolerance: a fraction of the spread of inverse depths
  const sortedY = [...ys].sort((a, b) => a - b);
  const iqr = sortedY[Math.floor(0.75 * (m - 1))] - sortedY[Math.floor(0.25 * (m - 1))];
  const tol = Math.max(1e-4, 0.15 * (iqr || sortedY[Math.floor((m - 1) / 2)] || 1));

  const rng = mulberry32(hashSeed(seed, "affine-depth"));
  let best = { s: 0, t: 0, inliers: -1 };
  for (let iter = 0; iter < 300; iter++) {
    const i = Math.floor(rng() * m);
    let j = Math.floor(rng() * m);
    if (j === i) j = (j + 1) % m;
    const dx = xs[i] - xs[j];
    if (Math.abs(dx) < 1e-9) continue;
    const s = (ys[i] - ys[j]) / dx;
    const t = ys[i] - s * xs[i];
    let inliers = 0;
    for (let k = 0; k < m; k++) if (Math.abs(s * xs[k] + t - ys[k]) < tol) inliers++;
    if (inliers > best.inliers) best = { s, t, inliers };
  }

  // IRLS refinement (Huber-ish: hard reweight on the inlier set, 3 rounds)
  let { s, t } = best;
  for (let round = 0; round < 3; round++) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let k = 0; k < m; k++) {
      const r = Math.abs(s * xs[k] + t - ys[k]);
      const w = r < tol ? 1 : tol / r; // soft outlier down-weight
      sw += w;
      sx += w * xs[k];
      sy += w * ys[k];
      sxx += w * xs[k] * xs[k];
      sxy += w * xs[k] * ys[k];
    }
    const det = sw * sxx - sx * sx;
    if (Math.abs(det) < 1e-12) break;
    s = (sw * sxy - sx * sy) / det;
    t = (sxx * sy - sx * sxy) / det;
  }

  const resid: number[] = [];
  const relErr: number[] = [];
  let inliers = 0;
  for (let k = 0; k < m; k++) {
    const r = Math.abs(s * xs[k] + t - ys[k]);
    if (r < tol) {
      inliers++;
      resid.push(r);
      const dHat = 1 / Math.max(1e-6, s * xs[k] + t);
      relErr.push(Math.abs(dHat - 1 / ys[k]) / (1 / ys[k]));
    }
  }
  resid.sort((a, b) => a - b);
  relErr.sort((a, b) => a - b);
  return {
    s,
    t,
    inlierFraction: inliers / m,
    residualMadInv: resid.length > 0 ? resid[Math.floor(resid.length / 2)] : Infinity,
    medianRelDepthErr: relErr.length > 0 ? relErr[Math.floor(relErr.length / 2)] : Infinity,
    n: m,
  };
}

/** Calibrated metric depth from a model prediction (undefined when non-physical). */
export function metricDepth(fit: AffineFit, pred: number): number | undefined {
  const inv = fit.s * pred + fit.t;
  if (!Number.isFinite(inv) || inv <= 1e-4) return undefined; // behind or beyond physical range
  return 1 / inv;
}
