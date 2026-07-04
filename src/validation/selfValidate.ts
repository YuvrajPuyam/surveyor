/**
 * Self-validation: run the full certify pipeline on synthetic worlds with
 * planted defects and score detection precision/recall. This is the
 * certificate appendix that answers "who certifies the certifier?".
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

function toAabb(r: { min: [number, number, number]; max: [number, number, number] }): Aabb {
  return { min: { x: r.min[0], y: r.min[1], z: r.min[2] }, max: { x: r.max[0], y: r.max[1], z: r.max[2] } };
}

function regionsMatch(planted: PlantedDefect, detected: Defect): boolean {
  if (planted.type !== detected.type) return false;
  if (planted.type === "scale_error") return true; // world-level defect
  const a = toAabb(planted.region);
  const b = toAabb(detected.region);
  const overlap = aabbOverlapXZ(a, b);
  const cover = aabbAreaXZ(a) > 0 ? overlap / aabbAreaXZ(a) : 0;
  return iouXZ(a, b) > 0.05 || cover > 0.3;
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
      const hit = detected.find((d) => regionsMatch(planted, d));
      if (hit) {
        matched++;
        matchedDetections.add(hit.id);
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
      notes: perWorld.map(
        (w) =>
          `${w.worldId}: ${w.matched}/${w.planted} planted defects found, ${w.falsePositives.length} false positive(s), grade ${w.grade}`,
      ),
    },
    perWorld,
  };
}
