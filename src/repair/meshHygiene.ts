/**
 * Mesh hygiene — the extended-repair answer to a failed settling test.
 * Degenerate collider geometry (zero-area slivers, duplicated faces,
 * near-coincident vertices) makes resting contacts jitter and eject: the
 * solver sees conflicting normals from triangles that shouldn't exist.
 *
 * Three deterministic passes:
 *   1. weld: snap vertices onto a `weldEps` grid and merge coincident ones;
 *   2. drop degenerates: triangles with a repeated (welded) vertex or area
 *      below `minAreaM2`;
 *   3. drop duplicates: triangles over the same vertex set (either winding) —
 *      double-sided face pairs fire opposing contact normals.
 *
 * Non-destructive: returns a NEW mesh; callers write a new bundle.
 */
import type { TriMesh } from "../core/geom.js";

export interface HygieneReport {
  verticesBefore: number;
  verticesAfter: number;
  trianglesBefore: number;
  trianglesAfter: number;
  degenerateRemoved: number;
  duplicateRemoved: number;
  weldEpsM: number;
  minAreaM2: number;
}

export function meshHygiene(
  mesh: TriMesh,
  weldEps = 1e-4,
  minAreaM2 = 1e-9,
): { mesh: TriMesh; report: HygieneReport } {
  const nVerts = Math.floor(mesh.positions.length / 3);
  const nTris = Math.floor(mesh.indices.length / 3);

  // ---- pass 1: weld coincident vertices (grid snap)
  const canonical = new Int32Array(nVerts); // old vertex -> canonical old vertex
  const gridOf = new Map<string, number>();
  for (let v = 0; v < nVerts; v++) {
    const k =
      `${Math.round(mesh.positions[v * 3] / weldEps)},` +
      `${Math.round(mesh.positions[v * 3 + 1] / weldEps)},` +
      `${Math.round(mesh.positions[v * 3 + 2] / weldEps)}`;
    const first = gridOf.get(k);
    if (first === undefined) {
      gridOf.set(k, v);
      canonical[v] = v;
    } else {
      canonical[v] = first;
    }
  }

  // ---- pass 2+3: rebuild triangles, dropping degenerates and duplicates
  const outTris: number[] = [];
  const seenTri = new Set<string>();
  let degenerateRemoved = 0;
  let duplicateRemoved = 0;
  const px = (v: number, a: number) => mesh.positions[v * 3 + a];
  for (let t = 0; t < nTris; t++) {
    const a = canonical[mesh.indices[t * 3]];
    const b = canonical[mesh.indices[t * 3 + 1]];
    const c = canonical[mesh.indices[t * 3 + 2]];
    if (a === b || b === c || a === c) {
      degenerateRemoved++;
      continue;
    }
    // area via cross product of the (welded) canonical positions
    const ux = px(b, 0) - px(a, 0), uy = px(b, 1) - px(a, 1), uz = px(b, 2) - px(a, 2);
    const vx = px(c, 0) - px(a, 0), vy = px(c, 1) - px(a, 1), vz = px(c, 2) - px(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (0.5 * Math.hypot(nx, ny, nz) < minAreaM2) {
      degenerateRemoved++;
      continue;
    }
    // duplicate faces over the same vertex set, either winding
    const dupKey = [a, b, c].sort((x, y) => x - y).join(",");
    if (seenTri.has(dupKey)) {
      duplicateRemoved++;
      continue;
    }
    seenTri.add(dupKey);
    outTris.push(a, b, c);
  }

  // ---- compact: keep only referenced vertices
  const remap = new Int32Array(nVerts).fill(-1);
  const outPositions: number[] = [];
  const outIndices = new Uint32Array(outTris.length);
  let next = 0;
  for (let i = 0; i < outTris.length; i++) {
    const old = outTris[i];
    if (remap[old] === -1) {
      remap[old] = next++;
      outPositions.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
    }
    outIndices[i] = remap[old];
  }

  return {
    mesh: { positions: new Float32Array(outPositions), indices: outIndices },
    report: {
      verticesBefore: nVerts,
      verticesAfter: next,
      trianglesBefore: nTris,
      trianglesAfter: outTris.length / 3,
      degenerateRemoved,
      duplicateRemoved,
      weldEpsM: weldEps,
      minAreaM2,
    },
  };
}
