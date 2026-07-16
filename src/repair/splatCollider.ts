/**
 * build_collider_from_splats — the ghost-rock fix (FIX 2, Sojourner E11
 * family): a visible surface with no physics gets a collider built FROM the
 * splat evidence itself. The mirror of patch_hole: physical grows to meet
 * photovisual, justified because the evidence is dense (the camera saw the
 * rock; only the artifact is missing).
 *
 * Method: rasterize the splat points inside the defect footprint into a
 * local heightfield (per-cell upper-quantile height, so splat fuzz doesn't
 * inflate the rock), emit a flat-top quad per protruding cell plus skirt
 * quads down to the local ground on exposed sides. Blocky at cell scale —
 * a collision surface, not a render mesh.
 *
 * Deterministic (sort-based quantiles, fixed iteration order). Ignores the
 * defect's NOMINAL y-band (certificate ghosts carry the global floor band,
 * which is wrong on multi-level terrain): heights come from the points and
 * the caller-provided local ground.
 */
import type { TriMesh } from "../core/geom.js";

export interface GhostPatchOpts {
  /** heightfield cell size (m) */
  cellM?: number;
  /** upper quantile of point heights per cell (fuzz rejection) */
  quantile?: number;
  /** min splat points in a cell to trust its height */
  minPtsPerCell?: number;
  /** cell must protrude this far above local ground to be built (avoids duplicating existing ground collider) */
  protrusionM?: number;
  /**
   * ignore splat points above ground + this cap: a ghost footprint can catch
   * FAR-FIELD backdrop splats overhead (sky dome, distant ridges) and the
   * heightfield would build an 80 m tower out of scenery. Ghost rocks are
   * near-ground objects by definition.
   */
  maxAboveGroundM?: number;
}

export interface GhostPatchResult {
  mesh: TriMesh;
  cellsBuilt: number;
  pointsUsed: number;
}

export function buildColliderFromSplats(
  points: Float32Array,
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number },
  groundYAt: (x: number, z: number) => number | undefined,
  opts: GhostPatchOpts = {},
): GhostPatchResult | null {
  const cell = opts.cellM ?? 0.25;
  const q = opts.quantile ?? 0.9;
  const minPts = opts.minPtsPerCell ?? 4;
  const protrusion = opts.protrusionM ?? 0.4;

  const nx = Math.max(1, Math.ceil((footprint.maxX - footprint.minX) / cell));
  const nz = Math.max(1, Math.ceil((footprint.maxZ - footprint.minZ) / cell));
  if (nx * nz > 250_000) return null; // pathological region — refuse quietly

  // bin point heights per cell (bounded scan: caller passes the whole cloud)
  const bins: number[][] = new Array(nx * nz);
  const n = points.length / 3;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], z = points[i * 3 + 2];
    if (x < footprint.minX || x >= footprint.maxX || z < footprint.minZ || z >= footprint.maxZ) continue;
    const cx = Math.min(nx - 1, Math.floor((x - footprint.minX) / cell));
    const cz = Math.min(nz - 1, Math.floor((z - footprint.minZ) / cell));
    (bins[cx * nz + cz] ??= []).push(points[i * 3 + 1]);
    used++;
  }
  if (used < minPts) return null;

  // per-cell top height where the evidence protrudes above local ground
  const top = new Float64Array(nx * nz).fill(NaN);
  const ground = new Float64Array(nx * nz).fill(NaN);
  let cellsBuilt = 0;
  for (let cx = 0; cx < nx; cx++) {
    for (let cz = 0; cz < nz; cz++) {
      const b0 = bins[cx * nz + cz];
      if (!b0 || b0.length < minPts) continue;
      const x = footprint.minX + (cx + 0.5) * cell;
      const z = footprint.minZ + (cz + 0.5) * cell;
      const gy = groundYAt(x, z);
      if (gy === undefined) continue; // no physical ground reference — do not invent one
      const cap = gy + (opts.maxAboveGroundM ?? 5);
      const b = b0.filter((y) => y <= cap);
      if (b.length < minPts) continue; // only far-field scenery overhead — nothing near-ground to build
      b.sort((a, u) => a - u);
      const h = b[Math.min(b.length - 1, Math.floor(q * (b.length - 1)))];
      if (h < gy + protrusion) continue; // ground-level splats — collider already covers this
      const ci = cx * nz + cz;
      top[ci] = h;
      ground[ci] = gy;
      cellsBuilt++;
    }
  }
  if (cellsBuilt === 0) return null;

  // flat-top quad per solid cell + skirts to ground on exposed sides
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (v: [number, number, number][], flip = false) => {
    const base = positions.length / 3;
    for (const p of v) positions.push(p[0], p[1], p[2]);
    if (flip) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const solid = (cx: number, cz: number) => cx >= 0 && cx < nx && cz >= 0 && cz < nz && !Number.isNaN(top[cx * nz + cz]);
  for (let cx = 0; cx < nx; cx++) {
    for (let cz = 0; cz < nz; cz++) {
      const ci = cx * nz + cz;
      if (Number.isNaN(top[ci])) continue;
      const x0 = footprint.minX + cx * cell, x1 = x0 + cell;
      const z0 = footprint.minZ + cz * cell, z1 = z0 + cell;
      const h = top[ci], g = ground[ci];
      // top cap (double-sided not needed: Rapier trimesh contacts are two-sided)
      quad([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]]);
      // skirts where the neighbor is not solid
      if (!solid(cx - 1, cz)) quad([[x0, h, z0], [x0, h, z1], [x0, g, z1], [x0, g, z0]]);
      if (!solid(cx + 1, cz)) quad([[x1, h, z0], [x1, g, z0], [x1, g, z1], [x1, h, z1]]);
      if (!solid(cx, cz - 1)) quad([[x0, h, z0], [x0, g, z0], [x1, g, z0], [x1, h, z0]]);
      if (!solid(cx, cz + 1)) quad([[x0, h, z1], [x1, h, z1], [x1, g, z1], [x0, g, z1]]);
    }
  }
  return {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    cellsBuilt,
    pointsUsed: used,
  };
}
