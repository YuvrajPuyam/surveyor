/**
 * Trust map: per-cell classification of the world's footprint.
 *  verified — probe contact, consistent with rays and visuals
 *  observed — visual/ray data only; no physical experiment touched it
 *  lying    — visuals and physics disagree (either direction)
 */
import type { Grid2D } from "../core/grid.js";
import type { TrustCellState, TrustSummary } from "../core/types.js";

export interface TrustMap {
  states: TrustCellState[];
  summary: TrustSummary;
}

export function buildTrustMap(grid: Grid2D): TrustMap {
  const contact = grid.channel("probeContact");
  const fall = grid.channel("fallConfirmed");
  const visual = grid.channel("visualPts");
  const vnp = grid.channel("visualNoPhys");
  const pnv = grid.channel("physNoVisual");

  const states: TrustCellState[] = new Array(grid.size);
  const counts = { unknown: 0, verified: 0, observed: 0, lying: 0 };

  for (let i = 0; i < grid.size; i++) {
    let s: TrustCellState;
    if (fall[i] > 0 || vnp[i] >= 3 || pnv[i] >= 3) s = "lying";
    else if (contact[i] > 0) s = "verified";
    else if (visual[i] > 0) s = "observed";
    else s = "unknown";
    states[i] = s;
    counts[s]++;
  }

  const known = grid.size - counts.unknown;
  return {
    states,
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
