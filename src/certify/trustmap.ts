/**
 * Trust map: per-cell classification of the world's footprint.
 *  verified — probe contact, consistent with rays and visuals
 *  observed — visual/ray data only; no physical experiment touched it
 *  lying    — visuals and physics disagree (either direction)
 */
import type { Grid2D } from "../core/grid.js";
import type { TrustCellState, TrustSummary } from "../core/types.js";

export interface TrustMap {
  /** per-cell states, row-major: index = row * cols + col (fully structured-clone/JSON serializable) */
  states: TrustCellState[];
  cols: number;
  rows: number;
  /** cell edge length, metres */
  cellSize: number;
  /** world-space XZ of the min corner of cell (col 0, row 0) */
  origin: { x: number; z: number };
  summary: TrustSummary;
}

export function buildTrustMap(grid: Grid2D): TrustMap {
  const contact = grid.channel("probeContact");
  const fall = grid.channel("fallConfirmed");
  const visual = grid.channel("visualPts");
  const vnp = grid.channel("visualNoPhys");
  const pnv = grid.channel("physNoVisual");

  // Density-relative lie gate: divergence evidence must be about as dense as
  // this world's real surfaces (baseline: cells where probes rested). Sparse
  // hallucinated fuzz is not a surface claim and must not read as "lying".
  const restedVisual: number[] = [];
  for (let i = 0; i < grid.size; i++) if (contact[i] > 0 && visual[i] > 0) restedVisual.push(visual[i]);
  restedVisual.sort((a, b) => a - b);
  const medianSurfaceDensity = restedVisual.length > 0 ? restedVisual[Math.floor(restedVisual.length / 2)] : 0;
  const lieThreshold = Math.max(3, 0.2 * medianSurfaceDensity);

  const states: TrustCellState[] = new Array(grid.size);
  const counts = { unknown: 0, verified: 0, observed: 0, lying: 0 };

  for (let i = 0; i < grid.size; i++) {
    let s: TrustCellState;
    if (fall[i] > 0 || vnp[i] >= lieThreshold || pnv[i] >= 3) s = "lying";
    else if (contact[i] > 0) s = "verified";
    else if (visual[i] > 0) s = "observed";
    else s = "unknown";
    states[i] = s;
    counts[s]++;
  }

  const known = grid.size - counts.unknown;
  return {
    states,
    cols: grid.cols,
    rows: grid.rows,
    cellSize: grid.cellSize,
    origin: { x: grid.x0, z: grid.z0 },
    summary: {
      cellSizeM: grid.cellSize,
      cols: grid.cols,
      rows: grid.rows,
      counts,
      verifiedPct: known > 0 ? (100 * counts.verified) / known : 0,
      lyingPct: known > 0 ? (100 * counts.lying) / known : 0,
    },
  };
}
