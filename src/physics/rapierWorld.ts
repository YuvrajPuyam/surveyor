/**
 * Thin wrapper over Rapier (WASM, deterministic fixed timestep). Runs
 * identically headless in Node (this repo, MCP server, self-validation) and
 * in a Web Worker (the browser app built on-site).
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { TriMesh, Vec3 } from "../core/geom.js";

let ready: Promise<unknown> | null = null;

export async function initRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init();
  await ready;
  return RAPIER;
}

export const FIXED_DT = 1 / 60;

export interface RayHit {
  y: number;
  distance: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor(gravityMagnitude: number) {
    this.world = new RAPIER.World({ x: 0, y: -gravityMagnitude, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  addStaticTriMesh(mesh: TriMesh): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices).setFriction(0.8);
    this.world.createCollider(desc, body);
  }

  spawnProbe(pos: Vec3, radius: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setCcdEnabled(true)
      .setLinearDamping(0.05);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.ball(radius).setFriction(0.6).setRestitution(0.05).setDensity(500);
    this.world.createCollider(colDesc, body);
    return body;
  }

  step(): void {
    this.world.step();
  }

  /** Cast straight down from (x, fromY, z). Returns the hit surface height, or null (void). */
  castDown(x: number, fromY: number, z: number, maxDist: number): RayHit | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true);
    if (!hit) return null;
    return { y: fromY - hit.timeOfImpact, distance: hit.timeOfImpact };
  }

  /** Cast straight up from (x, fromY, z). Returns hit height or null (open sky/ceilingless). */
  castUp(x: number, fromY: number, z: number, maxDist: number): RayHit | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: 1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true);
    if (!hit) return null;
    return { y: fromY + hit.timeOfImpact, distance: hit.timeOfImpact };
  }

  /**
   * Full top-down ray profile through a column: every surface crossing with
   * its normal, ordered top to bottom. Lets metrology see UNDER doorway
   * headers, where a single first-hit ray reads "wall".
   */
  castDownProfile(x: number, fromY: number, z: number, maxDist: number): { y: number; ny: number }[] {
    const hits: { y: number; ny: number }[] = [];
    let originY = fromY;
    let remaining = maxDist;
    for (let i = 0; i < 24 && remaining > 0; i++) {
      const ray = new RAPIER.Ray({ x, y: originY, z }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(ray, remaining, false);
      if (!hit) break;
      const y = originY - hit.timeOfImpact;
      hits.push({ y, ny: hit.normal.y });
      const advance = hit.timeOfImpact + 0.005;
      originY -= advance;
      remaining -= advance;
    }
    return hits;
  }

  /** Distance from a point to the nearest collider surface (projection query). */
  distanceToCollider(p: Vec3): number {
    const proj = this.world.projectPoint(p, true);
    if (!proj) return Infinity;
    const q = proj.point;
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return proj.isInside ? 0 : d;
  }

  free(): void {
    this.world.free();
  }
}
