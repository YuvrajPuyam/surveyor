/** 3D spatial hash for nearest-point queries against the visual point cloud. */
export class PointHash {
  private cells = new Map<string, number[]>();
  constructor(private points: Float32Array, private cellSize = 0.25) {
    for (let i = 0; i < points.length; i += 3) {
      const key = this.key(points[i], points[i + 1], points[i + 2]);
      let arr = this.cells.get(key);
      if (!arr) {
        arr = [];
        this.cells.set(key, arr);
      }
      arr.push(i);
    }
  }

  private key(x: number, y: number, z: number): string {
    const s = this.cellSize;
    return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
  }

  /** Squared distance to the nearest point within `radius`, or Infinity. */
  nearestDist2(x: number, y: number, z: number, radius: number): number {
    const s = this.cellSize;
    const r = Math.ceil(radius / s);
    const cx = Math.floor(x / s), cy = Math.floor(y / s), cz = Math.floor(z / s);
    let best = Infinity;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const arr = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const i of arr) {
            const ddx = this.points[i] - x, ddy = this.points[i + 1] - y, ddz = this.points[i + 2] - z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < best) best = d2;
          }
        }
    return best;
  }
}
