/**
 * Synthetic planted-defect worlds — the certifier's own test bench.
 *
 * Each world is built twice: a VISUAL mesh (what the splats would show) and a
 * COLLIDER mesh (what physics sees). Defects are controlled disagreements
 * between the two, recorded in a ground-truth manifest. The self-validation
 * suite runs the full certify pipeline against these and reports
 * precision/recall — the answer to "who certifies the certifier?"
 *
 * Layout of the base habitat (meters, y-up, floor top at y=0):
 *
 *        z=8 ┌────────────────────┬────────────────────┐
 *            │                    │                    │
 *            │       ROOM A       d       ROOM B       │
 *            │                    d  (doorway z 3.5..4.4)
 *            │                    │                    │
 *        z=0 └────────────────────┴────────────────────┘
 *           x=0                  x=5                 x=10
 */
import type { Aabb, TriMesh, Vec3 } from "../core/geom.js";
import { boxAabb, boxTriMesh, mergeTriMeshes, sampleMeshSurface } from "../core/geom.js";
import type { DefectType, WorldMetadata } from "../core/types.js";
import { hashSeed, mulberry32 } from "../core/prng.js";

export interface PlantedDefect {
  type: DefectType;
  region: { min: [number, number, number]; max: [number, number, number] };
  note: string;
}

export interface WorldBundle {
  worldId: string;
  collider: TriMesh;
  visual: TriMesh;
  /** Point samples of the visual mesh — stand-in for splat centers. */
  visualPoints: Float32Array;
  manifest: PlantedDefect[];
  metadata: WorldMetadata;
}

interface Box {
  c: Vec3;
  e: Vec3;
}

function box(cx: number, cy: number, cz: number, ex: number, ey: number, ez: number): Box {
  return { c: { x: cx, y: cy, z: cz }, e: { x: ex, y: ey, z: ez } };
}

function toRegion(a: Aabb): PlantedDefect["region"] {
  return { min: [a.min.x, a.min.y, a.min.z], max: [a.max.x, a.max.y, a.max.z] };
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Slabs covering rect [x0,x1]x[z0,z1] minus any number of rectangular holes, top at y=0. */
function floorWithHoles(x0: number, x1: number, z0: number, z1: number, holes: Rect[], thickness = 0.1): Box[] {
  const cy = -thickness / 2;
  let rects: Rect[] = [{ x0, x1, z0, z1 }];
  for (const hole of holes) {
    const next: Rect[] = [];
    for (const r of rects) {
      const ix0 = Math.max(r.x0, hole.x0), ix1 = Math.min(r.x1, hole.x1);
      const iz0 = Math.max(r.z0, hole.z0), iz1 = Math.min(r.z1, hole.z1);
      if (ix0 >= ix1 || iz0 >= iz1) {
        next.push(r); // no intersection
        continue;
      }
      // split into up to four remainder strips
      if (hole.x0 > r.x0) next.push({ x0: r.x0, x1: hole.x0, z0: r.z0, z1: r.z1 });
      if (r.x1 > hole.x1) next.push({ x0: hole.x1, x1: r.x1, z0: r.z0, z1: r.z1 });
      if (hole.z0 > r.z0) next.push({ x0: ix0, x1: ix1, z0: r.z0, z1: hole.z0 });
      if (r.z1 > hole.z1) next.push({ x0: ix0, x1: ix1, z0: hole.z1, z1: r.z1 });
    }
    rects = next;
  }
  return rects
    .filter((r) => r.x1 - r.x0 > 1e-6 && r.z1 - r.z0 > 1e-6)
    .map((r) => box((r.x0 + r.x1) / 2, cy, (r.z0 + r.z1) / 2, r.x1 - r.x0, thickness, r.z1 - r.z0));
}

/** Wall along z at fixed x, with an optional doorway gap [gz0,gz1] of height doorH. */
function wallX(x: number, z0: number, z1: number, h: number, t: number, gap?: { z0: number; z1: number; doorH: number }): Box[] {
  if (!gap) return [box(x, h / 2, (z0 + z1) / 2, t, h, z1 - z0)];
  const parts: Box[] = [];
  if (gap.z0 > z0) parts.push(box(x, h / 2, (z0 + gap.z0) / 2, t, h, gap.z0 - z0));
  if (z1 > gap.z1) parts.push(box(x, h / 2, (gap.z1 + z1) / 2, t, h, z1 - gap.z1));
  // header above the doorway
  parts.push(box(x, (gap.doorH + h) / 2, (gap.z0 + gap.z1) / 2, t, h - gap.doorH, gap.z1 - gap.z0));
  return parts;
}

function wallZ(z: number, x0: number, x1: number, h: number, t: number): Box[] {
  return [box((x0 + x1) / 2, h / 2, z, x1 - x0, h, t)];
}

export interface HabitatOptions {
  worldId: string;
  seed?: number;
  /** Collider floor hole in room A (visuals stay intact) */
  colliderHole?: boolean;
  /** Custom hole rectangle (overrides the default room-A position) */
  holeRect?: { x0: number; x1: number; z0: number; z1: number };
  /** Additional hole rectangles (multi-hole worlds) */
  extraHoles?: { x0: number; x1: number; z0: number; z1: number }[];
  /**
   * Out-of-taxonomy: rotate the COLLIDER -90 deg about X relative to the
   * visuals (the vendor quirk the plan's own reference facts document).
   */
  frameMismatch?: boolean;
  /** Out-of-taxonomy: vertically mis-scale room B (x > 5.1) by this factor. */
  localScaleYRoomB?: number;
  /** Raised sill across the interior doorway (visual + collider — a real feature that fails small robots) */
  raisedSillM?: number;
  /** Invisible collider barrier in room B (physics, no visuals) */
  phantomBarrier?: boolean;
  /** Visual wall segment in room B with no collider behind it */
  visualOnlyWall?: boolean;
  /** Export everything at this scale, shipping vendor metric_scale_factor = 1/scale */
  scaleError?: number;
}

const DOOR = { z0: 3.5, z1: 4.4, doorH: 2.03 };
const WALL_H = 3.0;
const WALL_T = 0.2;

export function buildHabitat(opts: HabitatOptions): WorldBundle {
  const scale = opts.scaleError ?? 1;
  const rng = mulberry32(hashSeed(opts.seed ?? 1234, opts.worldId));

  const colliderBoxes: Box[] = [];
  const visualBoxes: Box[] = [];
  const manifest: PlantedDefect[] = [];

  // ---- floor
  const holes: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const mainHole = opts.holeRect ?? (opts.colliderHole ? { x0: 2.0, x1: 3.2, z0: 5.0, z1: 6.2 } : null);
  if (mainHole) holes.push(mainHole);
  if (opts.extraHoles) holes.push(...opts.extraHoles);
  colliderBoxes.push(...floorWithHoles(0, 10, 0, 8, holes));
  visualBoxes.push(...floorWithHoles(0, 10, 0, 8, [])); // visuals always show a perfect floor
  for (const hole of holes) {
    manifest.push({
      type: "collider_hole",
      region: toRegion({ min: { x: hole.x0, y: -0.3, z: hole.z0 }, max: { x: hole.x1, y: 0.3, z: hole.z1 } }),
      note: `${(hole.x1 - hole.x0).toFixed(1)}x${(hole.z1 - hole.z0).toFixed(1)} m physics hole under visually perfect floor`,
    });
  }

  // ---- perimeter walls (identical in both meshes)
  const perimeter: Box[] = [
    ...wallX(0 + WALL_T / 2, 0, 8, WALL_H, WALL_T),
    ...wallX(10 - WALL_T / 2, 0, 8, WALL_H, WALL_T),
    ...wallZ(0 + WALL_T / 2, 0, 10, WALL_H, WALL_T),
    ...wallZ(8 - WALL_T / 2, 0, 10, WALL_H, WALL_T),
  ];
  colliderBoxes.push(...perimeter);
  visualBoxes.push(...perimeter);

  // ---- interior wall with doorway (identical in both meshes)
  const interior = wallX(5, 0, 8, WALL_H, WALL_T, DOOR);
  colliderBoxes.push(...interior);
  visualBoxes.push(...interior);

  // ---- raised sill at the doorway (real feature: in both meshes)
  if (opts.raisedSillM && opts.raisedSillM > 0) {
    const sill = box(5, opts.raisedSillM / 2, (DOOR.z0 + DOOR.z1) / 2, WALL_T, opts.raisedSillM, DOOR.z1 - DOOR.z0);
    colliderBoxes.push(sill);
    visualBoxes.push(sill);
    manifest.push({
      type: "raised_sill",
      region: toRegion(boxAabb(sill.c, sill.e)),
      note: `${opts.raisedSillM} m sill across the interior doorway`,
    });
  }

  // ---- phantom collider barrier (physics only)
  if (opts.phantomBarrier) {
    const barrier = box(7.5, 1.25, 2.0, 0.15, 2.5, 2.0);
    colliderBoxes.push(barrier);
    manifest.push({
      type: "phantom_collider",
      region: toRegion(boxAabb(barrier.c, barrier.e)),
      note: "invisible collider barrier in room B — no visual support",
    });
  }

  // ---- visual-only wall (visuals only)
  if (opts.visualOnlyWall) {
    const fake = box(8.0, 1.25, 6.0, 0.15, 2.5, 1.8);
    visualBoxes.push(fake);
    manifest.push({
      type: "visual_only_surface",
      region: toRegion(boxAabb(fake.c, fake.e)),
      note: "visual wall segment in room B with no collider behind it",
    });
  }

  // ---- assemble, scale, sample
  const scaleMesh = (m: TriMesh): TriMesh => {
    if (scale === 1) return m;
    const positions = new Float32Array(m.positions.length);
    for (let i = 0; i < m.positions.length; i++) positions[i] = m.positions[i] * scale;
    return { positions, indices: m.indices };
  };

  // out-of-taxonomy transforms, applied before global scaling
  const localScaleY = (m: TriMesh): TriMesh => {
    const f = opts.localScaleYRoomB;
    if (!f || f === 1) return m;
    const positions = new Float32Array(m.positions);
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i] > 5.1 && positions[i + 1] > 0) positions[i + 1] *= f;
    }
    return { positions, indices: m.indices };
  };
  const rotateColliderX90 = (m: TriMesh): TriMesh => {
    if (!opts.frameMismatch) return m;
    // -90 deg about X: (x, y, z) -> (x, z, -y)
    const positions = new Float32Array(m.positions.length);
    for (let i = 0; i < m.positions.length; i += 3) {
      positions[i] = m.positions[i];
      positions[i + 1] = m.positions[i + 2];
      positions[i + 2] = -m.positions[i + 1];
    }
    return { positions, indices: m.indices };
  };

  const collider = rotateColliderX90(scaleMesh(localScaleY(mergeTriMeshes(colliderBoxes.map((b) => boxTriMesh(b.c, b.e))))));
  const visual = scaleMesh(localScaleY(mergeTriMeshes(visualBoxes.map((b) => boxTriMesh(b.c, b.e)))));

  if (opts.frameMismatch) {
    manifest.push({
      type: "frame_mismatch",
      region: toRegion({ min: { x: 0, y: -10, z: -10 }, max: { x: 10 * scale, y: 10, z: 10 } }),
      note: "collider rotated -90 deg about X relative to visuals (vendor export quirk)",
    });
  }
  if (opts.localScaleYRoomB && opts.localScaleYRoomB !== 1) {
    manifest.push({
      type: "local_scale_error",
      region: toRegion({ min: { x: 5.1 * scale, y: 0, z: 0 }, max: { x: 10 * scale, y: 4 * scale, z: 8 * scale } }),
      note: `room B vertically mis-scaled by ${opts.localScaleYRoomB}x relative to room A`,
    });
  }
  // constant areal density in EXPORTED units — a mis-scaled world must not
  // become artificially sparse, or divergence checks flood with false phantoms
  const visualPoints = sampleMeshSurface(visual, 60, rng);

  if (scale !== 1) {
    manifest.push({
      type: "scale_error",
      region: toRegion({ min: { x: 0, y: -0.3, z: 0 }, max: { x: 10 * scale, y: 3 * scale, z: 8 * scale } }),
      note: `world exported at ${scale}x; vendor metric_scale_factor ${1 / scale} shipped in metadata`,
    });
    // planted defect regions above were authored in true-scale coords; rescale them
    for (const d of manifest) {
      if (d.type === "scale_error") continue;
      d.region = {
        min: [d.region.min[0] * scale, d.region.min[1] * scale, d.region.min[2] * scale],
        max: [d.region.max[0] * scale, d.region.max[1] * scale, d.region.max[2] * scale],
      };
    }
  }

  return {
    worldId: opts.worldId,
    collider,
    visual,
    visualPoints,
    manifest,
    metadata: {
      worldId: opts.worldId,
      source: "synthetic",
      metricScaleFactor: scale !== 1 ? 1 / scale : 1,
      groundPlaneY: 0,
    },
  };
}

/**
 * The hero world for the repair-loop demo: a collider hole hugging the
 * doorway approach (so an oversized fitted-slab patch intrudes on the
 * passage), plus the sill and a visual lie for quarantine.
 */
export function heroWorld(seed = 1234): WorldBundle {
  return buildHabitat({
    worldId: "syn-hero",
    seed,
    // one meter back from the doorway: far enough that the sill's own step
    // edges stay a distinct region, close enough that an oversized slab patch
    // lands a new obstacle in the passage approach
    holeRect: { x0: 3.3, x1: 3.95, z0: 3.55, z1: 4.35 },
    raisedSillM: 0.15,
    visualOnlyWall: true,
  });
}

/**
 * The self-validation bench: clean controls + every in-taxonomy defect class
 * across multiple seeds, PLUS adversarial worlds planted outside the
 * taxonomy (frame mismatch, local mis-scale) and at the detection floor
 * (small hole, low sill). Missing some of the hard ones is expected and
 * reported honestly — a recall with a confidence interval beats a planted
 * 100%.
 */
export function standardValidationSet(seed = 1234): WorldBundle[] {
  const worlds: WorldBundle[] = [];
  // core classes x 3 seeds
  for (const s of [seed, seed + 7717, seed + 24851]) {
    const tag = s === seed ? "" : `-s${s % 1000}`;
    worlds.push(
      buildHabitat({ worldId: `syn-clean${tag}`, seed: s }),
      buildHabitat({ worldId: `syn-hole${tag}`, seed: s, colliderHole: true }),
      buildHabitat({ worldId: `syn-sill${tag}`, seed: s, raisedSillM: 0.15 }),
      buildHabitat({ worldId: `syn-phantom${tag}`, seed: s, phantomBarrier: true }),
      buildHabitat({ worldId: `syn-visual-lie${tag}`, seed: s, visualOnlyWall: true }),
      buildHabitat({ worldId: `syn-mis-scaled${tag}`, seed: s, scaleError: 2 }),
      buildHabitat({ worldId: `syn-kitchen-sink${tag}`, seed: s, colliderHole: true, raisedSillM: 0.15, visualOnlyWall: true }),
    );
  }
  // adversarial / at-the-floor worlds (single seed)
  worlds.push(
    buildHabitat({ worldId: "syn-frame-mismatch", seed, frameMismatch: true }),
    buildHabitat({ worldId: "syn-local-scale", seed, localScaleYRoomB: 1.4 }),
    buildHabitat({ worldId: "syn-small-hole", seed, holeRect: { x0: 2.4, x1: 2.75, z0: 5.4, z1: 5.75 } }),
    buildHabitat({ worldId: "syn-low-sill", seed, raisedSillM: 0.05 }),
    buildHabitat({
      worldId: "syn-multi-hole",
      seed,
      colliderHole: true,
      extraHoles: [{ x0: 7.0, x1: 7.9, z0: 1.5, z1: 2.4 }],
    }),
    buildHabitat({ worldId: "syn-shrunk", seed, scaleError: 0.55 }),
  );
  return worlds;
}
