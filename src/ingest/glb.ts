/**
 * GLB collider I/O via gltf-transform. Real Marble worlds ship a simplified
 * collider GLB (~5k polys for a room); synthetic worlds are written through
 * the same path so the certify pipeline cannot tell them apart.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import type { TriMesh } from "../core/geom.js";
import { mergeTriMeshes } from "../core/geom.js";

function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Load every mesh primitive in a GLB into a single world-space triangle soup. */
export async function loadColliderGlb(path: string): Promise<TriMesh> {
  const io = new NodeIO();
  const doc = await io.read(path);
  const parts: TriMesh[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      if (!posAttr) continue;
      const src = posAttr.getArray()!;
      const positions = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const [x, y, z] = transformPoint(world as unknown as number[], src[i], src[i + 1], src[i + 2]);
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
      }
      const idxAccessor = prim.getIndices();
      let indices: Uint32Array;
      if (idxAccessor) {
        indices = Uint32Array.from(idxAccessor.getArray()!);
      } else {
        indices = new Uint32Array(src.length / 3);
        for (let i = 0; i < indices.length; i++) indices[i] = i;
      }
      parts.push({ positions, indices });
    }
  }
  if (parts.length === 0) throw new Error(`No mesh primitives found in ${path}`);
  return mergeTriMeshes(parts);
}

/** Write a triangle soup as a minimal GLB. */
export async function saveTriMeshGlb(path: string, mesh: TriMesh, name = "collider"): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(mesh.positions)
    .setBuffer(buffer);
  const idx = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(mesh.indices)
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
  const gltfMesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(gltfMesh);
  const scene = doc.createScene().addChild(node);
  doc.getRoot().setDefaultScene(scene);
  await new NodeIO().write(path, doc);
}
