/**
 * Trust-map layer — instanced quads at floor height, one per grid cell,
 * painted from the certify worker's streamed TrustMap states:
 *   verified  green   (probe contact, consistent with rays + visuals)
 *   observed  yellow  (visual/ray data only; no physical experiment)
 *   lying     red     (visuals and physics disagree)
 *   unknown   dark    (never surveyed)
 *
 * The TrustMap payload carries cols/rows/cellSize/origin (world-space XZ of
 * the min corner of cell 0,0), states row-major: index = row * cols + col.
 * Coordinates are ENGINE coordinates — after apply_vendor_scale the engine
 * re-grids in scaled space, so this layer lives at the scene root, not inside
 * the (viewer-scaled) world group.
 */
import * as THREE from "three";
import type { TrustMapPayload } from "./workerClient";

const CELL_COLORS: Record<string, number> = {
  verified: 0x34d975,
  observed: 0xffd60a,
  lying: 0xff453a,
  unknown: 0x141a28,
};
const FALLBACK_COLOR = 0x141a28;
const FLOOR_LIFT_M = 0.02; // avoid z-fighting with the collider floor

export class TrustLayer {
  private mesh: THREE.InstancedMesh | undefined;
  private floorY = 0;
  private shown = true;

  constructor(private scene: THREE.Scene) {}

  /** True once at least one trust map has been painted. */
  get painted(): boolean {
    return this.mesh !== undefined;
  }

  get visible(): boolean {
    return this.shown;
  }

  setFloorY(y: number): void {
    this.floorY = y;
    if (this.mesh) this.mesh.position.y = y + FLOOR_LIFT_M;
  }

  /** Toggle visibility; returns the new state. */
  toggle(): boolean {
    this.shown = !this.shown;
    if (this.mesh) this.mesh.visible = this.shown;
    return this.shown;
  }

  /** (Re)build the instanced-quad grid from a streamed trust map. */
  paint(map: TrustMapPayload): void {
    this.dispose();
    const { cols, rows, cellSize, origin, states } = map;
    const count = cols * rows;
    if (count === 0) return;

    const geom = new THREE.PlaneGeometry(cellSize * 0.94, cellSize * 0.94);
    geom.rotateX(-Math.PI / 2); // face up
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, count);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        m.makeTranslation(origin.x + (col + 0.5) * cellSize, 0, origin.z + (row + 0.5) * cellSize);
        mesh.setMatrixAt(i, m);
        color.setHex(CELL_COLORS[states[i] ?? "unknown"] ?? FALLBACK_COLOR);
        mesh.setColorAt(i, color);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    mesh.name = "trust-map";
    mesh.position.y = this.floorY + FLOOR_LIFT_M;
    mesh.visible = this.shown;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = undefined;
  }
}
