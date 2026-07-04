/**
 * Self-validation: run the full certify pipeline on synthetic worlds with
 * planted defects and score detection precision/recall — WITH one-sided 95%
 * Clopper-Pearson lower bounds. A perfect score on a small bench is reported
 * as what it is ("100%, 95% CI >= X%, n=N"), the Measurement ethos applied
 * to the instrument itself.
 *
 * The bench includes defects planted OUTSIDE the certifier's taxonomy
 * (frame mismatch, local mis-scale). Those count as detected if the
 * certifier flags the damage in its own terms — and as honest misses if not.
 */
import type { Aabb } from "../core/geom.js";
import { aabbOverlapXZ, aabbAreaXZ, iouXZ } from "../core/geom.js";
import type { Defect, SelfValidation } from "../core/types.js";
import type { PlantedDefect, WorldBundle } from "../ingest/synthetic.js";
import { certifyWorld, type CertifyOptions } from "../certify/certificate.js";

export interface WorldValidationDetail {
  worldId: string;
  planted: number;
  matched: number;
  missed: PlantedDefect[];
  falsePositives: Defect[];
  grade: string;
}

export interface SelfValidationReport {
  summary: SelfValidation;
  perWorld: WorldValidationDetail[];
}

/** world-level planted classes: matched by defect class anywhere in the world */
const WORLD_LEVEL = new Set(["scale_error", "frame_mismatch", "local_scale_error"]);

/** out-of-taxonomy planted classes -> certifier findings that count as catching them */
const EQUIVALENT: Record<string, string[]> = {
  frame_mismatch: ["visual_only_surface", "phantom_collider", "collider_hole", "scale_error"],
  local_scale_error: ["scale_error", "raised_sill"],
};

function detectionClasses(planted: PlantedDefect): string[] {
  return EQUIVALENT[planted.type] ?? [planted.type];
}

function toAabb(r: { min: [number, number, number]; max: [number, number, number] }): Aabb {
  return { min: { x: r.min[0], y: r.min[1], z: r.min[2] }, max: { x: r.max[0], y: r.max[1], z: r.max[2] } };
}

function regionsMatch(planted: PlantedDefect, detected: Defect): boolean {
  if (!detectionClasses(planted).includes(detected.type)) return false;
  if (WORLD_LEVEL.has(planted.type)) return true;
  const a = toAabb(planted.region);
  const b = toAabb(detected.region);
  const overlap = aabbOverlapXZ(a, b);
  const cover = aabbAreaXZ(a) > 0 ? overlap / aabbAreaXZ(a) : 0;
  return iouXZ(a, b) > 0.05 || cover > 0.3;
}

function binomTail(n: number, k: number, p: number): number {
  // P(X >= k | n, p), direct sum — n stays small (bench sizes)
  let sum = 0;
  for (let i = k; i <= n; i++) {
    let logC = 0;
    for (let j = 0; j < i; j++) logC += Math.log(n - j) - Math.log(j + 1);
    sum += Math.exp(logC + i * Math.log(Math.max(p, 1e-300)) + (n - i) * Math.log(Math.max(1 - p, 1e-300)));
  }
  return Math.min(1, sum);
}

/** One-sided 95% Clopper-Pearson lower bound for successes/n. */
export function clopperPearsonLower(successes: number, n: number, alpha = 0.05): number {
  if (n === 0 || successes === 0) return 0;
  if (successes === n) return Math.pow(alpha, 1 / n); // rule-of-three family, exact
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (binomTail(n, successes, mid) < alpha) lo = mid;
    else hi = mid;
  }
  return lo;
}

export async function selfValidate(
  worlds: WorldBundle[],
  opts: CertifyOptions = {},
): Promise<SelfValidationReport> {
  const perWorld: WorldValidationDetail[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let plantedTotal = 0;

  for (const world of worlds) {
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
      opts,
    );
    const detected = certificate.defects;
    const matchedDetections = new Set<string>();
    const missed: PlantedDefect[] = [];
    let matched = 0;

    for (const planted of world.manifest) {
      const hits = detected.filter((d) => regionsMatch(planted, d));
      if (hits.length > 0) {
        matched++;
        // world-level planted defects legitimately explain EVERY finding of
        // their class — a rotated collider makes the whole world diverge
        for (const h of hits) matchedDetections.add(h.id);
      } else {
        missed.push(planted);
      }
    }
    const falsePositives = detected.filter((d) => !matchedDetections.has(d.id));

    plantedTotal += world.manifest.length;
    tp += matched;
    fn += missed.length;
    fp += falsePositives.length;

    perWorld.push({
      worldId: world.worldId,
      planted: world.manifest.length,
      matched,
      missed,
      falsePositives,
      grade: certificate.grade,
    });
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;

  return {
    summary: {
      worldsTested: worlds.length,
      plantedDefects: plantedTotal,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      recallCI95Low: clopperPearsonLower(tp, tp + fn),
      precisionCI95Low: clopperPearsonLower(tp, tp + fp),
      notes: perWorld.map(
        (w) =>
          `${w.worldId}: ${w.matched}/${w.planted} planted defects found, ${w.falsePositives.length} false positive(s), grade ${w.grade}`,
      ),
    },
    perWorld,
  };
}
