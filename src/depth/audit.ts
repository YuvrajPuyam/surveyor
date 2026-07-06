/**
 * The image-depth audit — SURVEYOR's third instrument.
 *
 * The certificate's two instruments measure the SHIPPED ASSETS (probes/rays
 * on the collider; divergence against the splat cloud). This one measures
 * the shipped IMAGERY: a monocular depth model over the 360° pano, affine-
 * calibrated on the CONSENSUS set (rays where splat and collider already
 * agree), then used to
 *   1. detect BOTH-WRONG regions — splat and collider agree with each other
 *      but not with what the camera saw (invisible to the certificate);
 *   2. ADJUDICATE existing divergences — where the two files disagree, the
 *      pixels cast a deciding vote (ghost vs phantom, per defect).
 *
 * Honesty rules: every free parameter (affine scale/shift, pano yaw offset)
 * is FITTED and reported with residuals; the capture-origin assumption is
 * validated by the fit quality; if the self-checks fail the audit declares
 * itself INCONCLUSIVE and refuses to adjudicate. This is an advisory
 * sidecar — the certificate core stays deterministic and ML-free.
 */
import type { Vec3, TriMesh } from "../core/geom.js";
import type { Certificate, Defect } from "../core/types.js";
import { fitAffineDepth, metricDepth, spearman, type AffineFit } from "./affine.js";
import { colliderDepthPano, sampleDepthPanoNear, splatDepthPano, type DepthPano } from "./assetDepth.js";
import { equirectUV, rotateYaw } from "./equirect.js";
import type { DepthRay } from "./panoDepth.js";

export type RayVerdict =
  | "triple_confirmed" // image ≈ splat ≈ collider
  | "both_suspect" // splat ≈ collider, image disagrees with both
  | "sides_with_splat" // splat vs collider disagree; image matches splat
  | "sides_with_collider"
  | "sides_with_neither"
  | "unmeasured";

export interface AuditRegion {
  kind: "both_suspect";
  rays: number;
  /** mean world position of the image-implied surface */
  position: [number, number, number];
  meanImageDepthM: number;
  meanAssetDepthM: number;
}

export interface DefectAdjudication {
  defectId: string;
  type: string;
  rays: number;
  /** fraction of rays whose image depth matches the SPLAT surface */
  supportsSplat: number;
  /** fraction matching the COLLIDER surface */
  supportsCollider: number;
  verdict: string;
}

export interface CropCalibration {
  crop: number;
  fit: AffineFit;
  spearman: number;
  calibrated: boolean;
}

export interface DepthAuditReport {
  worldId: string;
  conclusive: boolean;
  inconclusiveReason?: string;
  origin: [number, number, number];
  yawOffsetDeg: number;
  yawPeakSharpness: number;
  /** per-crop affine calibrations — monocular depth is affine-consistent
   *  WITHIN a frame, not across frames; one global fit is a modeling error */
  crops: CropCalibration[];
  cropsCalibrated: number;
  consensusSpearman: number;
  agreementThresholdRel: number;
  tallies: Record<RayVerdict, number>;
  bothSuspectRegions: AuditRegion[];
  adjudications: DefectAdjudication[];
  methods: string[];
  meta: Record<string, unknown>;
}

export interface AuditInputs {
  worldId: string;
  collider: TriMesh;
  visualPoints: Float32Array;
  certificate?: Certificate;
  rays: DepthRay[];
  rayMeta: Record<string, unknown>;
  origin?: Vec3;
  onProgress?: (msg: string) => void;
}

const PANO_W = 480;
const PANO_H = 240;
/** calibration cells need >= 2 splat points (single-point cells are noise) */
const CAL_MIN_COUNT = 2;

interface CropPairs {
  pred: number[];
  metric: number[];
}

/** Consensus pairs (splat ≈ collider) grouped BY CROP — each crop gets its own affine. */
function consensusPairsByCrop(
  rays: DepthRay[],
  nCrops: number,
  yawOffset: number,
  splat: DepthPano,
  collider: DepthPano,
): CropPairs[] {
  const perCrop: CropPairs[] = Array.from({ length: nCrops }, () => ({ pred: [], metric: [] }));
  for (const r of rays) {
    const d = rotateYaw({ x: r.dx, y: r.dy, z: r.dz }, yawOffset);
    const { u, v } = equirectUV(d, PANO_W, PANO_H);
    const ds = sampleDepthPanoNear(splat, u, v, 1, CAL_MIN_COUNT);
    const dc = sampleDepthPanoNear(collider, u, v, 0, 1);
    if (!Number.isFinite(ds) || !Number.isFinite(dc)) continue;
    if (Math.abs(ds - dc) > Math.max(0.15, 0.07 * Math.min(ds, dc))) continue;
    // Edge-aware: a calibration cell must sit on a locally FLAT depth patch.
    // At depth discontinuities (doorframes, shelf edges) a half-degree cell
    // straddles the jump and pairs the model's through-the-gap ray with the
    // frame's near depth — classic monocular-eval contamination.
    let dcMin = Infinity;
    let dcMax = -Infinity;
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        const dd = sampleDepthPanoNear(collider, u + du, v + dv, 0, 1);
        if (Number.isFinite(dd)) {
          dcMin = Math.min(dcMin, dd);
          dcMax = Math.max(dcMax, dd);
        }
      }
    }
    if (!Number.isFinite(dcMin) || dcMax - dcMin > 0.2 * dcMin) continue; // depth edge — not calibration ground
    perCrop[r.crop].pred.push(r.pred);
    perCrop[r.crop].metric.push((ds + dc) / 2);
  }
  return perCrop;
}

const CROP_MIN_RAYS = 25;
const CROP_MIN_INLIERS = 0.5;

function fitCrops(perCrop: CropPairs[]): CropCalibration[] {
  return perCrop.map((p, crop) => {
    const fit = p.pred.length >= CROP_MIN_RAYS ? fitAffineDepth(p.pred, p.metric, 1234 + crop) : undefined;
    const rho = fit ? spearman(p.pred, p.metric.map((m) => 1 / m)) : 0;
    const calibrated = !!fit && fit.inlierFraction >= CROP_MIN_INLIERS && Math.abs(rho) >= 0.55 && fit.s !== 0;
    return {
      crop,
      fit: fit ?? { s: 0, t: 0, inlierFraction: 0, residualMadInv: Infinity, medianRelDepthErr: Infinity, n: p.pred.length },
      spearman: rho,
      calibrated,
    };
  });
}

/** Sweep score: total inliers across calibrated crops (coverage × quality). */
function sweepScore(cals: CropCalibration[]): number {
  let score = 0;
  for (const c of cals) if (c.calibrated) score += c.fit.n * c.fit.inlierFraction;
  return score;
}

export async function runDepthAudit(inp: AuditInputs): Promise<DepthAuditReport> {
  const origin = inp.origin ?? { x: 0, y: 0, z: 0 };
  const log = inp.onProgress ?? (() => {});

  log("building splat + collider depth panoramas from the assumed capture origin…");
  const splat = splatDepthPano(inp.visualPoints, origin, PANO_W, PANO_H);
  const collider = await colliderDepthPano(inp.collider, origin, PANO_W, PANO_H);

  // ---- fit the pano→world yaw offset: coarse sweep, then refine.
  // Scored on PER-CROP calibrations: monocular depth is affine-consistent
  // within a frame, not across frames — a single global affine confounds
  // crop-to-crop scale drift with frame misalignment.
  const nCrops = Number(inp.rayMeta.crops) || Math.max(...inp.rays.map((r) => r.crop)) + 1;
  log("fitting pano yaw offset (coarse 5° sweep, per-crop calibration)…");
  let bestYaw = 0;
  let bestScore = -1;
  const scores: number[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const yaw = (deg * Math.PI) / 180;
    const score = sweepScore(fitCrops(consensusPairsByCrop(inp.rays, nCrops, yaw, splat, collider)));
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  for (let deg = -4; deg <= 4; deg++) {
    const yaw = bestYaw + (deg * Math.PI) / 180;
    const score = sweepScore(fitCrops(consensusPairsByCrop(inp.rays, nCrops, yaw, splat, collider)));
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  // Peak narrowness: how many coarse candidates score within half the best.
  // A locked frame concentrates the score in one narrow lobe (≤ ~30° of the
  // 360° sweep); a flat landscape means the yaw never actually locked.
  const nearPeak = scores.filter((s) => s > bestScore / 2).length;
  const yawPeakSharpness = bestScore > 0 ? scores.length / Math.max(1, nearPeak) : 0;

  // ---- final per-crop calibration at the fitted yaw
  const crops = fitCrops(consensusPairsByCrop(inp.rays, nCrops, bestYaw, splat, collider));
  const calibratedCrops = crops.filter((c) => c.calibrated);
  const cropsCalibrated = calibratedCrops.length;
  const consensusRays = crops.reduce((a, c) => a + c.fit.n, 0);
  const rhoMedian = (() => {
    const rs = calibratedCrops.map((c) => c.spearman).sort((a, b) => a - b);
    return rs.length > 0 ? rs[Math.floor(rs.length / 2)] : 0;
  })();
  const relErrMedian = (() => {
    const es = calibratedCrops.map((c) => c.fit.medianRelDepthErr).sort((a, b) => a - b);
    return es.length > 0 ? es[Math.floor(es.length / 2)] : Infinity;
  })();
  log(
    `yaw ${((bestYaw * 180) / Math.PI).toFixed(1)}° (peak ×${yawPeakSharpness.toFixed(1)} over median) · ` +
      `${cropsCalibrated}/${nCrops} crops calibrated on ${consensusRays} consensus rays · ` +
      `median crop: rel err ${(relErrMedian * 100).toFixed(1)}%, spearman ${rhoMedian.toFixed(2)}`,
  );
  for (const c of crops) {
    log(
      `  crop ${String(c.crop).padStart(2)}: n=${String(c.fit.n).padStart(3)} inliers ${(c.fit.inlierFraction * 100).toFixed(0).padStart(3)}% ` +
        `relErr ${(c.fit.medianRelDepthErr * 100).toFixed(1)}% ρ=${c.spearman.toFixed(2)} ${c.calibrated ? "✓" : "— abstains"}`,
    );
  }

  // ---- self-checks: the instrument refuses to testify on a bad calibration.
  // Shell worlds legitimately cannot calibrate crops that stare into the
  // capture-boundary void — TWO independently locked crops with a narrow yaw
  // peak are sufficient to testify about the rays those crops cover; the
  // coverage fraction is reported so partial testimony reads as partial.
  let inconclusiveReason: string | undefined;
  if (consensusRays < 100) inconclusiveReason = `only ${consensusRays} consensus rays — not enough agreed-upon geometry to calibrate against`;
  else if (cropsCalibrated < 2) inconclusiveReason = `only ${cropsCalibrated}/${nCrops} crops calibrated — the frame assumption (origin/yaw) or the model does not hold here`;
  else if (yawPeakSharpness < 6) inconclusiveReason = `yaw fit peak is broad (score within 50% of best across ~${Math.round(360 / Math.max(1, yawPeakSharpness))}° of the sweep) — pano orientation could not be locked`;
  const conclusive = !inconclusiveReason;

  // agreement threshold derives from the calibrated crops' own error
  const thresholdRel = Math.max(0.12, 3 * (Number.isFinite(relErrMedian) ? relErrMedian : 0.04));
  const rho = rhoMedian;

  const tallies: Record<RayVerdict, number> = {
    triple_confirmed: 0,
    both_suspect: 0,
    sides_with_splat: 0,
    sides_with_collider: 0,
    sides_with_neither: 0,
    unmeasured: 0,
  };
  interface ClassifiedRay {
    verdict: RayVerdict;
    dir: Vec3;
    dImg?: number;
    dSplat?: number;
    dCollider?: number;
  }
  const classified: ClassifiedRay[] = [];
  if (conclusive) {
    for (const r of inp.rays) {
      const cal = crops[r.crop];
      const dir = rotateYaw({ x: r.dx, y: r.dy, z: r.dz }, bestYaw);
      const { u, v } = equirectUV(dir, PANO_W, PANO_H);
      const ds = sampleDepthPanoNear(splat, u, v, 1, 1);
      const dc = sampleDepthPanoNear(collider, u, v, 0, 1);
      // rays from crops that could not calibrate ABSTAIN — partial coverage
      // is reported, never papered over
      const dImg = cal.calibrated ? metricDepth(cal.fit, r.pred) : undefined;
      let verdict: RayVerdict = "unmeasured";
      const close = (a: number, b: number) => Math.abs(a - b) / Math.min(a, b) <= thresholdRel;
      if (dImg !== undefined && Number.isFinite(ds) && Number.isFinite(dc)) {
        const assetsAgree = Math.abs(ds - dc) <= Math.max(0.15, 0.07 * Math.min(ds, dc));
        if (assetsAgree) verdict = close(dImg, (ds + dc) / 2) ? "triple_confirmed" : "both_suspect";
        else if (close(dImg, ds) && !close(dImg, dc)) verdict = "sides_with_splat";
        else if (close(dImg, dc) && !close(dImg, ds)) verdict = "sides_with_collider";
        else verdict = "sides_with_neither";
      }
      tallies[verdict]++;
      classified.push({ verdict, dir, dImg, dSplat: Number.isFinite(ds) ? ds : undefined, dCollider: Number.isFinite(dc) ? dc : undefined });
    }
  }

  // ---- cluster both-suspect rays into regions (angular proximity)
  const bothSuspectRegions: AuditRegion[] = [];
  if (conclusive) {
    const suspects = classified.filter((c) => c.verdict === "both_suspect" && c.dImg !== undefined);
    const used = new Set<number>();
    for (let i = 0; i < suspects.length; i++) {
      if (used.has(i)) continue;
      const cluster = [i];
      used.add(i);
      for (let j = i + 1; j < suspects.length; j++) {
        if (used.has(j)) continue;
        const a = suspects[i].dir;
        const b = suspects[j].dir;
        const dot = a.x * b.x + a.y * b.y + a.z * b.z;
        if (dot > Math.cos((12 * Math.PI) / 180)) {
          cluster.push(j);
          used.add(j);
        }
      }
      if (cluster.length < 6) continue; // evidence mass, like every other detector here
      let px = 0, py = 0, pz = 0, di = 0, da = 0;
      for (const k of cluster) {
        const s = suspects[k];
        px += origin.x + s.dir.x * s.dImg!;
        py += origin.y + s.dir.y * s.dImg!;
        pz += origin.z + s.dir.z * s.dImg!;
        di += s.dImg!;
        da += ((s.dSplat ?? s.dImg!) + (s.dCollider ?? s.dImg!)) / 2;
      }
      const n = cluster.length;
      bothSuspectRegions.push({
        kind: "both_suspect",
        rays: n,
        position: [px / n, py / n, pz / n],
        meanImageDepthM: di / n,
        meanAssetDepthM: da / n,
      });
    }
    bothSuspectRegions.sort((a, b) => b.rays - a.rays);
  }

  // ---- per-defect adjudication (ghosts + phantoms from the certificate)
  const adjudications: DefectAdjudication[] = [];
  if (conclusive && inp.certificate) {
    const targets = inp.certificate.defects.filter(
      (d) => d.type === "visual_only_surface" || d.type === "phantom_collider",
    );
    for (const d of targets) {
      const adj = adjudicateDefect(d, classified, origin, thresholdRel);
      if (adj) adjudications.push(adj);
    }
  }

  return {
    worldId: inp.worldId,
    conclusive,
    inconclusiveReason,
    origin: [origin.x, origin.y, origin.z],
    yawOffsetDeg: (bestYaw * 180) / Math.PI,
    yawPeakSharpness,
    crops,
    cropsCalibrated,
    consensusSpearman: rho,
    agreementThresholdRel: thresholdRel,
    tallies,
    bothSuspectRegions: bothSuspectRegions.slice(0, 20),
    adjudications,
    methods: [
      `Monocular depth (${String(inp.rayMeta.modelId)}) over ${String(inp.rayMeta.crops)} pinhole crops (${String(inp.rayMeta.fovDeg)}° fov, ${String(inp.rayMeta.cropSize)}px) of the shipped 360° pano; ${String(inp.rayMeta.raysSampled)} rays sampled.`,
      `Capture origin ASSUMED at the world origin (Marble worlds train around the source camera); the assumption is validated by the calibration quality below, and the audit refuses itself when it does not hold.`,
      `Pano→world yaw offset FITTED by 5° sweep + 1° refinement, maximizing total affine inliers across per-crop calibrations: ${((bestYaw * 180) / Math.PI).toFixed(1)}° (peak ×${yawPeakSharpness.toFixed(1)} over the sweep median).`,
      `PER-CROP affine calibration (monocular depth is scale/shift-ambiguous in inverse depth, and only affine-consistent WITHIN a frame): each crop fits its own RANSAC+IRLS line against consensus rays — where splat and collider agree within max(0.15 m, 7%). ${cropsCalibrated}/${nCrops} crops calibrated (needs ≥${CROP_MIN_RAYS} rays, ≥${CROP_MIN_INLIERS * 100}% inliers, |ρ| ≥ 0.55); uncalibrated crops ABSTAIN — their rays are reported unmeasured, not guessed.`,
      `Agreement threshold derives from the calibrated crops' own error: ${(thresholdRel * 100).toFixed(0)}% relative depth (= max(12%, 3× median per-crop calibration error)). 'Both suspect' means the imagery disagrees with BOTH shipped assets where they agree with each other — the failure class the two-instrument certificate cannot see.`,
      `Advisory instrument: the deterministic certificate is unchanged; this audit is a sidecar with disclosed model, fits, and refusal conditions.`,
    ],
    meta: inp.rayMeta,
  };
}

function adjudicateDefect(
  d: Defect,
  classified: Array<{ verdict: RayVerdict; dir: Vec3; dImg?: number; dSplat?: number; dCollider?: number }>,
  origin: Vec3,
  thresholdRel: number,
): DefectAdjudication | undefined {
  const cx = (d.region.min[0] + d.region.max[0]) / 2 - origin.x;
  const cy = (d.region.min[1] + d.region.max[1]) / 2 - origin.y;
  const cz = (d.region.min[2] + d.region.max[2]) / 2 - origin.z;
  const dist = Math.hypot(cx, cy, cz);
  if (dist < 0.3) return undefined;
  const half = Math.max(
    (d.region.max[0] - d.region.min[0]) / 2,
    (d.region.max[2] - d.region.min[2]) / 2,
    0.3,
  );
  const angRadius = Math.min(0.5, Math.atan2(half, dist)) + (4 * Math.PI) / 180;
  const n = { x: cx / dist, y: cy / dist, z: cz / dist };
  const cosR = Math.cos(angRadius);

  let rays = 0;
  let splatSide = 0;
  let colliderSide = 0;
  for (const c of classified) {
    if (c.dImg === undefined) continue;
    const dot = c.dir.x * n.x + c.dir.y * n.y + c.dir.z * n.z;
    if (dot < cosR) continue;
    rays++;
    const close = (a?: number, b?: number) =>
      a !== undefined && b !== undefined && Math.abs(a - b) / Math.min(a, b) <= thresholdRel;
    if (close(c.dImg, c.dSplat) && !close(c.dImg, c.dCollider)) splatSide++;
    else if (close(c.dImg, c.dCollider) && !close(c.dImg, c.dSplat)) colliderSide++;
  }
  if (rays < 5) return undefined;

  const fs = splatSide / rays;
  const fc = colliderSide / rays;
  let verdict: string;
  if (d.type === "visual_only_surface") {
    verdict =
      fs > 0.4 && fs > fc * 2
        ? "imagery SAW the surface the splats claim — the ghost is a real visual claim with physics missing (repair or quarantine both defensible)"
        : fc > 0.4 && fc > fs * 2
          ? "imagery sees THROUGH to the collider — the splat surface is hallucinated; quarantine is doubly right"
          : "imagery is not decisive here";
  } else {
    verdict =
      fc > 0.4 && fc > fs * 2
        ? "imagery sees a surface AT the collider — the 'phantom' is real geometry the splats failed to capture (do not carve it)"
        : fs > 0.4 && fs > fc * 2
          ? "imagery agrees with the splats — nothing visible at the collider surface; a true invisible barrier"
          : "imagery is not decisive here";
  }
  return { defectId: d.id, type: d.type, rays, supportsSplat: fs, supportsCollider: fc, verdict };
}
