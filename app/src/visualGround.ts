/**
 * visualGround.ts — C12 (vision-driven twin run, ENDGAME Gemini additions).
 *
 * A queryable heightfield of the VISUAL floor, built from splat centers
 * (visual-points.f32). The raw-run planner justifies its crossing with THIS
 * surface — "the planner drives on what the cameras see" — while the physics
 * worker holds the collider exactly as shipped. Where the visual floor is
 * continuous and the collider is absent, the gap between the two surfaces IS
 * the poisoning the twin run demonstrates: a vision policy trained here
 * would learn the same crossing, and no training episode would say why it
 * fails on hardware.
 *
 * Splat centers are an approximation of the rendered surface (opacity and
 * scale are not consulted here) — good enough for "is there visual floor
 * across this gap", and the on-screen copy claims no more than that.
 */

export interface CrossingReport {
  /** Samples along the crossing where the visual surface answered. */
  seen: number;
  /** Total samples taken along the crossing. */
  total: number;
  /** Median |visual floor − reference floor| over the seen samples (m). */
  medianAbsDeltaM: number;
}

export interface VisualGround {
  /**
   * Median visual-floor height near (x, z), from splat centers within
   * `band` of `refY` in this cell and its 8 neighbors. Undefined when the
   * pixels show nothing floor-like there.
   */
  floorAt(x: number, z: number, refY: number): number | undefined;
  /**
   * Sample the segment (x0,z0)→(x1,z1) and report how much of it the visual
   * surface covers. `inside` restricts samples (e.g. to the defect region)
   * so the report speaks about the crossing itself, not the runway.
   */
  crossing(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    refY: number,
    inside?: (x: number, z: number) => boolean,
  ): CrossingReport;
}

const CELL_M = 0.25;
const BAND_M = 0.45; // matches the survey's floor-band thinking: near-floor splats only
const SAMPLE_M = 0.25;
const MIN_CELL_POINTS = 2; // one stray splat center is not a floor

export function buildVisualGround(points: Float32Array, cellM = CELL_M): VisualGround {
  // cell key -> ys of splat centers in that XZ cell (all heights; the refY
  // band is applied per query so one build serves any floor level)
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 100003 + cz; // ints; worlds are << 1000 cells wide
  for (let i = 0; i + 2 < points.length; i += 3) {
    const cx = Math.floor(points[i]! / cellM);
    const cz = Math.floor(points[i + 2]! / cellM);
    const k = key(cx, cz);
    let ys = cells.get(k);
    if (!ys) {
      ys = [];
      cells.set(k, ys);
    }
    ys.push(points[i + 1]!);
  }

  function floorAt(x: number, z: number, refY: number): number | undefined {
    const cx = Math.floor(x / cellM);
    const cz = Math.floor(z / cellM);
    const near: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ys = cells.get(key(cx + dx, cz + dz));
        if (!ys) continue;
        for (const y of ys) if (Math.abs(y - refY) <= BAND_M) near.push(y);
      }
    }
    if (near.length < MIN_CELL_POINTS) return undefined;
    near.sort((a, b) => a - b);
    return near[Math.floor(near.length / 2)];
  }

  function crossing(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    refY: number,
    inside?: (x: number, z: number) => boolean,
  ): CrossingReport {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.ceil(len / SAMPLE_M));
    const deltas: number[] = [];
    let seen = 0;
    let total = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (inside && !inside(x, z)) continue;
      total++;
      const y = floorAt(x, z, refY);
      if (y !== undefined) {
        seen++;
        deltas.push(Math.abs(y - refY));
      }
    }
    deltas.sort((a, b) => a - b);
    return {
      seen,
      total,
      medianAbsDeltaM: deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)]! : Number.NaN,
    };
  }

  return { floorAt, crossing };
}

/** The bar for "the planner would cross here on visual evidence". */
export function visionConfirmed(r: { seen: number; total: number }): boolean {
  return r.total >= 3 && r.seen / r.total >= 0.7;
}
