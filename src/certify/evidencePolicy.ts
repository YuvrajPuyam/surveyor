/**
 * Evidence-tiered phantom policy (`certify --evidence-tiers`).
 *
 * Single-viewpoint outdoor captures mint phantom-collider signals wherever
 * the camera never looked — occlusion shadows behind terrain, and the
 * capture-decay boundary where splats thin out while the collider keeps
 * going ("the edges become walls automatically"). Those are UNWITNESSED:
 * the collider there is unverified, not wrong, and belongs in the trust
 * map, not the defect list.
 *
 * A phantom stays a DEFECT only when the camera CONTRADICTS it: densely
 * seen ground (>= DENSE_PTS splat centers per neighborhood) sitting
 * >= CONTRADICTION_GAP_M below the collider surface, with no visual matter
 * at the surface itself — a real invisible wall over real visible terrain.
 *
 * Mirrors the viewer's display policy (app/src/main.ts) so what the
 * certificate counts and what a human sees stay the same story.
 */
import type { Defect } from "../core/types.js";
import type { SurveyResult } from "./survey.js";

const CELL_M = 0.25;
const BAND_M = 0.45;
/** any visual matter at the surface exculpates ("not invisible, just sparse") */
const SUPPORT_PTS = 2;
/** the CONTRADICTING ground must be densely seen — near-field capture quality */
const DENSE_PTS = 25;
const CONTRADICTION_GAP_M = 1.5;
const PROBE_DROPS_M = [1.5, 2.5, 3.5, 5];

export interface EvidencePartition {
  kept: Defect[];
  unwitnessedPhantoms: number;
}

export function partitionPhantomsByEvidence(
  defects: Defect[],
  survey: SurveyResult,
  visualPoints: Float32Array,
): EvidencePartition {
  // splat centers binned per 0.25 m XZ cell (heights kept; band applied per query)
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 100003 + cz;
  for (let i = 0; i + 2 < visualPoints.length; i += 3) {
    const k = key(Math.floor(visualPoints[i] / CELL_M), Math.floor(visualPoints[i + 2] / CELL_M));
    let ys = cells.get(k);
    if (!ys) {
      ys = [];
      cells.set(k, ys);
    }
    ys.push(visualPoints[i + 1]);
  }
  const countNear = (x: number, z: number, refY: number): number => {
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ys = cells.get(key(cx + dx, cz + dz));
        if (!ys) continue;
        for (const y of ys) if (Math.abs(y - refY) <= BAND_M) n++;
      }
    }
    return n;
  };

  const rayGrid = survey.rayGrid;
  const surfaceY = rayGrid.channel("surfaceY");
  const hasHit = rayGrid.channel("hasHit");
  const surfaceAt = (x: number, z: number): number | undefined => {
    const i = rayGrid.index(x, z);
    return hasHit[i] ? surfaceY[i] : undefined;
  };

  const contradicted = (d: Defect): boolean => {
    const [x0, , z0] = d.region.min, [x1, , z1] = d.region.max;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const samples: [number, number][] = [
      [cx, cz],
      [(x0 + cx) / 2, (z0 + cz) / 2],
      [(x1 + cx) / 2, (z0 + cz) / 2],
      [(x0 + cx) / 2, (z1 + cz) / 2],
      [(x1 + cx) / 2, (z1 + cz) / 2],
    ];
    for (const [x, z] of samples) {
      const top = surfaceAt(x, z);
      if (top === undefined) continue;
      if (countNear(x, z, top) >= SUPPORT_PTS) continue; // visual matter AT the surface
      for (const drop of PROBE_DROPS_M) {
        if (countNear(x, z, top - drop) >= DENSE_PTS && drop >= CONTRADICTION_GAP_M) return true;
      }
    }
    return false;
  };

  const kept: Defect[] = [];
  let unwitnessedPhantoms = 0;
  for (const d of defects) {
    if (d.type === "phantom_collider" && !contradicted(d)) {
      unwitnessedPhantoms++;
      continue;
    }
    kept.push(d);
  }
  return { kept, unwitnessedPhantoms };
}

export function evidencePolicyDisclosure(unwitnessedPhantoms: number): string {
  return (
    `Evidence policy: ${unwitnessedPhantoms.toLocaleString("en-US")} phantom-collider signal(s) carry no visual evidence either way ` +
    `(occlusion shadows and capture-decay boundaries — the camera never saw those regions). They are recorded as unverified space ` +
    `in the trust map, NOT as defects: the collider there is unwitnessed, not wrong. Phantoms contradicted by densely-seen ground ` +
    `(>= ${DENSE_PTS} splat centers within ${BAND_M} m of a surface >= ${CONTRADICTION_GAP_M} m below the collider) remain defects.`
  );
}
