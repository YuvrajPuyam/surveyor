/**
 * Depth panoramas of the SHIPPED assets, as seen from the capture origin —
 * the two existing instruments re-expressed in the image-depth instrument's
 * coordinate system so all three measure the same rays.
 *
 *  - splat depth: bin every visual point into an equirect grid by direction
 *    from the origin; a cell's depth is its NEAREST point (min range) — the
 *    first visual surface along that ray.
 *  - collider depth: one physics raycast per cell center.
 *
 * The capture origin is an ASSUMPTION (world origin — Marble worlds are
 * trained around the source camera) that downstream code must validate and
 * disclose, never trust.
 */
import type { Vec3 } from "../core/geom.js";
import type { TriMesh } from "../core/geom.js";
import { initRapier, PhysicsWorld } from "../physics/rapierWorld.js";
import { equirectDir, equirectUV } from "./equirect.js";

export interface DepthPano {
  width: number;
  height: number;
  /** metres; NaN = nothing along that ray */
  depth: Float32Array;
  /** samples per cell (splat pano) or 1/0 (collider pano) */
  count: Uint32Array;
}

export function splatDepthPano(
  visualPoints: Float32Array,
  origin: Vec3,
  width: number,
  height: number,
  maxRange = 80,
): DepthPano {
  const depth = new Float32Array(width * height).fill(NaN);
  const count = new Uint32Array(width * height);
  for (let i = 0; i < visualPoints.length; i += 3) {
    const dx = visualPoints[i] - origin.x;
    const dy = visualPoints[i + 1] - origin.y;
    const dz = visualPoints[i + 2] - origin.z;
    const r = Math.hypot(dx, dy, dz);
    if (r < 0.05 || r > maxRange) continue;
    const { u, v } = equirectUV({ x: dx, y: dy, z: dz }, width, height);
    const ui = Math.min(width - 1, Math.max(0, Math.round(u)));
    const vi = Math.min(height - 1, Math.max(0, Math.round(v)));
    const idx = vi * width + ui;
    count[idx]++;
    if (!(r >= depth[idx])) depth[idx] = r; // min; NaN comparison falls through to assignment
  }
  return { width, height, depth, count };
}

export async function colliderDepthPano(
  collider: TriMesh,
  origin: Vec3,
  width: number,
  height: number,
  maxRange = 80,
): Promise<DepthPano> {
  await initRapier();
  const pw = new PhysicsWorld(9.81);
  pw.addStaticTriMesh(collider);
  pw.step();
  const depth = new Float32Array(width * height).fill(NaN);
  const count = new Uint32Array(width * height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const dir = equirectDir(u, v, width, height);
      const d = pw.castRay(origin, dir, maxRange);
      if (d !== null && d > 0.05) {
        depth[v * width + u] = d;
        count[v * width + u] = 1;
      }
    }
  }
  pw.free();
  return { width, height, depth, count };
}

/** Bilinear-free nearest sample with NaN awareness (grids are coarse on purpose). */
export function sampleDepthPano(pano: DepthPano, u: number, v: number): number {
  const ui = ((Math.round(u) % pano.width) + pano.width) % pano.width;
  const vi = Math.min(pano.height - 1, Math.max(0, Math.round(v)));
  return pano.depth[vi * pano.width + ui];
}

/**
 * Nearest finite sample within a small neighbourhood, optionally requiring
 * a minimum sample count (splat cells backed by a single point are noise).
 * Returns the MINIMUM depth found — first-surface semantics, matching what
 * a camera sees.
 */
export function sampleDepthPanoNear(pano: DepthPano, u: number, v: number, radius = 1, minCount = 1): number {
  let best = NaN;
  for (let dv = -radius; dv <= radius; dv++) {
    const vi = Math.min(pano.height - 1, Math.max(0, Math.round(v) + dv));
    for (let du = -radius; du <= radius; du++) {
      const ui = (((Math.round(u) + du) % pano.width) + pano.width) % pano.width;
      const idx = vi * pano.width + ui;
      if (pano.count[idx] < minCount) continue;
      const d = pano.depth[idx];
      if (Number.isFinite(d) && !(d >= best)) best = d;
    }
  }
  return best;
}
