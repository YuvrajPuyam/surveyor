/** Minimal geometry helpers shared across ingestion, physics, and metrology. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function aabbOfPositions(positions: Float32Array): Aabb {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]);
    min.y = Math.min(min.y, positions[i + 1]);
    min.z = Math.min(min.z, positions[i + 2]);
    max.x = Math.max(max.x, positions[i]);
    max.y = Math.max(max.y, positions[i + 1]);
    max.z = Math.max(max.z, positions[i + 2]);
  }
  return { min, max };
}

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

export function aabbOverlapXZ(a: Aabb, b: Aabb): number {
  const ox = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const oz = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return ox * oz;
}

export function aabbAreaXZ(a: Aabb): number {
  return Math.max(0, a.max.x - a.min.x) * Math.max(0, a.max.z - a.min.z);
}

/** XZ intersection-over-union — used to match detected defects to planted ones. */
export function iouXZ(a: Aabb, b: Aabb): number {
  const inter = aabbOverlapXZ(a, b);
  const union = aabbAreaXZ(a) + aabbAreaXZ(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Triangle soup: flat positions (xyz per vertex) + triangle indices. */
export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export function mergeTriMeshes(meshes: TriMesh[]): TriMesh {
  let nPos = 0;
  let nIdx = 0;
  for (const m of meshes) {
    nPos += m.positions.length;
    nIdx += m.indices.length;
  }
  const positions = new Float32Array(nPos);
  const indices = new Uint32Array(nIdx);
  let posOff = 0;
  let idxOff = 0;
  for (const m of meshes) {
    positions.set(m.positions, posOff);
    const vertOff = posOff / 3;
    for (let i = 0; i < m.indices.length; i++) indices[idxOff + i] = m.indices[i] + vertOff;
    posOff += m.positions.length;
    idxOff += m.indices.length;
  }
  return { positions, indices };
}

/** Axis-aligned box centered at c with full extents e, as 12 triangles. */
export function boxTriMesh(c: Vec3, e: Vec3): TriMesh {
  const hx = e.x / 2, hy = e.y / 2, hz = e.z / 2;
  const v: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    v.push(c.x + sx * hx, c.y + sy * hy, c.z + sz * hz);
  }
  // vertex order: index = (sx>0)*4 + (sy>0)*2 + (sz>0)
  const q = [
    [0, 1, 3, 2], // -x
    [4, 6, 7, 5], // +x
    [0, 4, 5, 1], // -y
    [2, 3, 7, 6], // +y
    [0, 2, 6, 4], // -z
    [1, 5, 7, 3], // +z
  ];
  const indices: number[] = [];
  for (const [a, b, cc, d] of q) indices.push(a, b, cc, a, cc, d);
  return { positions: new Float32Array(v), indices: new Uint32Array(indices) };
}

export function boxAabb(c: Vec3, e: Vec3): Aabb {
  return {
    min: { x: c.x - e.x / 2, y: c.y - e.y / 2, z: c.z - e.z / 2 },
    max: { x: c.x + e.x / 2, y: c.y + e.y / 2, z: c.z + e.z / 2 },
  };
}

/** Deterministic surface sampling of a triangle mesh at ~`density` points/m². */
export function sampleMeshSurface(mesh: TriMesh, density: number, rng: () => number): Float32Array {
  const pts: number[] = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t] * 3, i1 = mesh.indices[t + 1] * 3, i2 = mesh.indices[t + 2] * 3;
    const ax = p[i0], ay = p[i0 + 1], az = p[i0 + 2];
    const bx = p[i1], by = p[i1 + 1], bz = p[i1 + 2];
    const cx = p[i2], cy = p[i2 + 1], cz = p[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    let n = area * density;
    // fractional expectation handled stochastically but deterministically via seeded rng
    const count = Math.floor(n) + (rng() < n - Math.floor(n) ? 1 : 0);
    for (let k = 0; k < count; k++) {
      let r1 = rng(), r2 = rng();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      pts.push(ax + r1 * ux + r2 * vx, ay + r1 * uy + r2 * vy, az + r1 * uz + r2 * vz);
    }
  }
  return new Float32Array(pts);
}
