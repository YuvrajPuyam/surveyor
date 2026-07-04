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

/** Slabs covering rect [x0,x1]x[z0,z1] minus a rectangular hole, top at y=0. */
function floorWithHole(
  x0: number, x1: number, z0: number, z1: number,
  hole: { x0: number; x1: number; z0: number; z1: number } | null,
  thickness = 0.1,
): Box[] {
  const cy = -thickness / 2;
  if (!hole) {
    return [box((x0 + x1) / 2, cy, (z0 + z1) / 2, x1 - x0, thickness, z1 - z0)];
  }
  const slabs: Box[] = [];
  // left / right strips (full z), front / back strips (hole x-range only)
  if (hole.x0 > x0) slabs.push(box((x0 + hole.x0) / 2, cy, (z0 + z1) / 2, hole.x0 - x0, thickness, z1 - z0));
  if (x1 > hole.x1) slabs.push(box((hole.x1 + x1) / 2, cy, (z0 + z1) / 2, x1 - hole.x1, thickness, z1 - z0));
  if (hole.z0 > z0) slabs.push(box((hole.x0 + hole.x1) / 2, cy, (z0 + hole.z0) / 2, hole.x1 - hole.x0, thickness, hole.z0 - z0));
  if (z1 > hole.z1) slabs.push(box((hole.x0 + hole.x1) / 2, cy, (hole.z1 + z1) / 2, hole.x1 - hole.x0, thickness, z1 - hole.z1));
  return slabs;
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
  const hole = opts.holeRect ?? (opts.colliderHole ? { x0: 2.0, x1: 3.2, z0: 5.0, z1: 6.2 } : null);
  colliderBoxes.push(...floorWithHole(0, 10, 0, 8, hole));
  visualBoxes.push(...floorWithHole(0, 10, 0, 8, null)); // visuals always show a perfect floor
  if (hole) {
    manifest.push({
      type: "collider_hole",
      region: toRegion({ min: { x: hole.x0, y: -0.3, z: hole.z0 }, max: { x: hole.x1, y: 0.3, z: hole.z1 } }),
      note: "1.2x1.2 m physics hole under visually perfect floor in room A",
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

  const collider = scaleMesh(mergeTriMeshes(colliderBoxes.map((b) => boxTriMesh(b.c, b.e))));
  const visual = scaleMesh(mergeTriMeshes(visualBoxes.map((b) => boxTriMesh(b.c, b.e))));
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

/** The standard self-validation set: one clean control + one world per defect class + a kitchen sink. */
export function standardValidationSet(seed = 1234): WorldBundle[] {
  return [
    buildHabitat({ worldId: "syn-clean", seed }),
    buildHabitat({ worldId: "syn-hole", seed, colliderHole: true }),
    buildHabitat({ worldId: "syn-sill", seed, raisedSillM: 0.15 }),
    buildHabitat({ worldId: "syn-phantom", seed, phantomBarrier: true }),
    buildHabitat({ worldId: "syn-visual-lie", seed, visualOnlyWall: true }),
    buildHabitat({ worldId: "syn-mis-scaled", seed, scaleError: 2 }),
    buildHabitat({ worldId: "syn-kitchen-sink", seed, colliderHole: true, raisedSillM: 0.15, visualOnlyWall: true }),
  ];
}
