/**
 * World bundle disk format — one directory per world:
 *   collider.glb        physics shell (same format Marble ships)
 *   visual.glb          visual mesh (synthetic worlds; real worlds use .spz splats)
 *   visual-points.f32   raw float32 xyz triples — splat-center stand-in
 *   manifest.json       planted-defect ground truth (synthetic only)
 *   metadata.json       worldId, source, metric_scale_factor, ground plane
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WorldMetadata } from "../core/types.js";
import type { TriMesh } from "../core/geom.js";
import { loadColliderGlb, saveTriMeshGlb } from "./glb.js";
import type { PlantedDefect, WorldBundle } from "./synthetic.js";

export async function saveWorldBundle(dir: string, bundle: WorldBundle): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await saveTriMeshGlb(join(dir, "collider.glb"), bundle.collider, "collider");
  await saveTriMeshGlb(join(dir, "visual.glb"), bundle.visual, "visual");
  // respect byteOffset/byteLength: a subarray view would otherwise serialize its ENTIRE backing buffer
  writeFileSync(join(dir, "visual-points.f32"), Buffer.from(bundle.visualPoints.buffer, bundle.visualPoints.byteOffset, bundle.visualPoints.byteLength));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(bundle.manifest, null, 2));
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(bundle.metadata, null, 2));
}

export interface LoadedWorld {
  worldId: string;
  collider: TriMesh;
  visualPoints: Float32Array;
  /** per-splat max Gaussian scale, aligned with visualPoints (SPZ worlds only) */
  visualScales?: Float32Array;
  metadata: WorldMetadata;
  manifest?: PlantedDefect[];
}

export async function loadWorldBundle(dir: string): Promise<LoadedWorld> {
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8")) as WorldMetadata;
  const collider = await loadColliderGlb(join(dir, "collider.glb"));
  const raw = readFileSync(join(dir, "visual-points.f32"));
  const visualPoints = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const scalesPath = join(dir, "visual-scales.f32");
  let visualScales: Float32Array | undefined;
  if (existsSync(scalesPath)) {
    const sraw = readFileSync(scalesPath);
    visualScales = new Float32Array(sraw.buffer, sraw.byteOffset, sraw.byteLength / 4);
    if (visualScales.length !== visualPoints.length / 3) visualScales = undefined; // stale sidecar
  }
  const manifestPath = join(dir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf-8")) as PlantedDefect[])
    : undefined;
  return { worldId: metadata.worldId, collider, visualPoints, visualScales, metadata, manifest };
}
