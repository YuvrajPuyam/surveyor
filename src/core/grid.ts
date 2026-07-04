/** 2D grid over the world's XZ footprint. All survey evidence bins into this. */
import type { Aabb } from "./geom.js";

export class Grid2D {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly x0: number;
  readonly z0: number;
  private channels = new Map<string, Float64Array>();

  constructor(aabb: Aabb, cellSize: number) {
    this.cellSize = cellSize;
    this.x0 = aabb.min.x;
    this.z0 = aabb.min.z;
    this.cols = Math.max(1, Math.ceil((aabb.max.x - aabb.min.x) / cellSize));
    this.rows = Math.max(1, Math.ceil((aabb.max.z - aabb.min.z) / cellSize));
  }

  channel(name: string): Float64Array {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = new Float64Array(this.cols * this.rows);
      this.channels.set(name, ch);
    }
    return ch;
  }

  index(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cellSize)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.z0) / this.cellSize)));
    return r * this.cols + c;
  }

  colRow(i: number): [number, number] {
    return [i % this.cols, Math.floor(i / this.cols)];
  }

  center(i: number): [number, number] {
    const [c, r] = this.colRow(i);
    return [this.x0 + (c + 0.5) * this.cellSize, this.z0 + (r + 0.5) * this.cellSize];
  }

  add(name: string, x: number, z: number, v = 1): void {
    this.channel(name)[this.index(x, z)] += v;
  }

  set(name: string, x: number, z: number, v: number): void {
    this.channel(name)[this.index(x, z)] = v;
  }

  get size(): number {
    return this.cols * this.rows;
  }

  /** Cells where predicate holds, merged into rectangular regions via flood fill. */
  regions(pred: (i: number) => boolean): Aabb[] {
    const seen = new Uint8Array(this.size);
    const out: Aabb[] = [];
    for (let start = 0; start < this.size; start++) {
      if (seen[start] || !pred(start)) continue;
      // BFS flood fill
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const [c, r] = this.colRow(i);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          const ni = nr * this.cols + nc;
          if (!seen[ni] && pred(ni)) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      out.push({
        min: { x: this.x0 + minC * this.cellSize, y: -Infinity, z: this.z0 + minR * this.cellSize },
        max: { x: this.x0 + (maxC + 1) * this.cellSize, y: Infinity, z: this.z0 + (maxR + 1) * this.cellSize },
      });
    }
    return out;
  }
}
