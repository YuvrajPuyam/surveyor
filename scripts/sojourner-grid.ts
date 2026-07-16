/**
 * SOJOURNER FLIGHT MAP — the three-state occupancy voxel grid (+ sky band),
 * derived from a certified world bundle. Artifact #3 of the mission package.
 *
 * Every voxel carries PROVENANCE, not just occupancy — the whole point:
 *   FREE      confirmed air: above camera-verified ground, inside the capture
 *             envelope (the camera saw through this space)
 *   OCCUPIED  confirmed matter: collider corroborated by splat evidence, or
 *             solid interior below the ground shell
 *   UNKNOWN   the honesty class — collider with no visual support (occlusion
 *             ring, E7), visible matter with no physics (ghost rocks, E11),
 *             or air the capture never vouched for
 *   SKY       above the physical world entirely (the pano backdrop band, E4)
 *             — flyable in principle, modeled by nothing
 *
 * Output: flightmap.bin (Uint8 voxels, x-major) + flightmap-meta.json
 * (dims/origin/legend/counts/provenance) + console receipt.
 *
 *   npx tsx scripts/sojourner-grid.ts <bundle-dir> [--voxel 1.0]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadColliderGlb } from "../src/ingest/glb.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: npx tsx scripts/sojourner-grid.ts <bundle-dir> [--voxel M]"); process.exit(2); }
const vi = process.argv.indexOf("--voxel");
const VOXEL = vi > -1 ? parseFloat(process.argv[vi + 1]) : 1.0;

const UNKNOWN = 0, FREE = 1, OCCUPIED = 2, SKY = 3;
const CLASS_NAMES = ["unknown", "free", "occupied", "sky"];
const SKY_MARGIN = 2.0;      // above global collider top + this = sky band
const CEILING = 8.0;         // flight ceiling above the sky line to keep in-grid
const ENVELOPE_MIN_PTS = 3;  // column visual coverage needed for "the camera saw here"
const CORROBORATE_PTS = 2;   // splat points near an occupied voxel to confirm it
const GHOST_PTS = 4;         // splat points in an air voxel = visible matter, no physics

console.log(`[1/4] loading bundle ${dir} (voxel ${VOXEL} m)…`);
const collider = await loadColliderGlb(join(dir, "collider.glb"));
const raw = readFileSync(join(dir, "visual-points.f32"));
const pts = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const nPts = pts.length / 3;

// bounds from the collider footprint (the physical world defines the map)
let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
for (let i = 0; i < collider.positions.length; i += 3) {
  const x = collider.positions[i], y = collider.positions[i + 1], z = collider.positions[i + 2];
  if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
  if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
}
const skyLineY = mxy + SKY_MARGIN;
const O = { x: mnx, y: mny - 1, z: mnz };
const NX = Math.ceil((mxx - O.x) / VOXEL);
const NY = Math.ceil((skyLineY + CEILING - O.y) / VOXEL);
const NZ = Math.ceil((mxz - O.z) / VOXEL);
const N = NX * NY * NZ;
console.log(`      grid ${NX} x ${NY} x ${NZ} = ${(N / 1e6).toFixed(1)}M voxels over ${(mxx - mnx).toFixed(0)} x ${(skyLineY + CEILING - O.y).toFixed(0)} x ${(mxz - mnz).toFixed(0)} m`);

const vox = (cx: number, cy: number, cz: number) => (cx * NY + cy) * NZ + cz;
const inGrid = (cx: number, cy: number, cz: number) => cx >= 0 && cx < NX && cy >= 0 && cy < NY && cz >= 0 && cz < NZ;
const cellOf = (x: number, y: number, z: number): [number, number, number] =>
  [Math.floor((x - O.x) / VOXEL), Math.floor((y - O.y) / VOXEL), Math.floor((z - O.z) / VOXEL)];

console.log(`[2/4] evidence rasters — splat density + collider occupancy…`);
// splat density per voxel + per-column totals (envelope)
const splatCount = new Uint16Array(N);
const colPts = new Uint32Array(NX * NZ);
for (let i = 0; i < nPts; i++) {
  const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
  const [cx, cy, cz] = cellOf(x, y, z);
  if (!inGrid(cx, cy, cz)) continue;
  const v = vox(cx, cy, cz);
  if (splatCount[v] < 65535) splatCount[v]++;
  colPts[cx * NZ + cz]++;
}
// collider occupancy: sample triangle surfaces ~4 samples/m² + structure
const hasCol = new Uint8Array(N);
const colTop = new Float32Array(NX * NZ).fill(-1e9);
const colBottom = new Float32Array(NX * NZ).fill(1e9);
const idx = collider.indices, pos = collider.positions;
let rngState = 12345;
const rand = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
  const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
  const cx_ = pos[c], cy_ = pos[c + 1], cz_ = pos[c + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx_ - ax, vy = cy_ - ay, vz = cz_ - az;
  const nxv = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nzv = ux * vy - uy * vx;
  const area = 0.5 * Math.hypot(nxv, nyv, nzv);
  const extra = Math.min(64, Math.ceil(area * 4));
  const mark = (x: number, y: number, z: number) => {
    const [gx, gy, gz] = cellOf(x, y, z);
    if (!inGrid(gx, gy, gz)) return;
    hasCol[vox(gx, gy, gz)] = 1;
    const ci = gx * NZ + gz;
    if (y > colTop[ci]) colTop[ci] = y;
    if (y < colBottom[ci]) colBottom[ci] = y;
  };
  mark(ax, ay, az); mark(bx, by, bz); mark(cx_, cy_, cz_);
  mark((ax + bx + cx_) / 3, (ay + by + cy_) / 3, (az + bz + cz_) / 3);
  for (let s = 0; s < extra; s++) {
    let r1 = rand(), r2 = rand();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    mark(ax + r1 * ux + r2 * vx, ay + r1 * uy + r2 * vy, az + r1 * uz + r2 * vz);
  }
}

console.log(`[3/4] classifying…`);
const grid = new Uint8Array(N); // UNKNOWN by default
const nearSplats = (cx: number, cy: number, cz: number): number => {
  let s = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const gx = cx + dx, gy = cy + dy, gz = cz + dz;
        if (inGrid(gx, gy, gz)) s += splatCount[vox(gx, gy, gz)];
      }
  return s;
};
const counts = [0, 0, 0, 0];
for (let cx = 0; cx < NX; cx++) {
  for (let cz = 0; cz < NZ; cz++) {
    const ci = cx * NZ + cz;
    const top = colTop[ci], bottom = colBottom[ci];
    const hasColumn = top > -1e8;
    const inEnvelope = colPts[ci] >= ENVELOPE_MIN_PTS;
    for (let cy = 0; cy < NY; cy++) {
      const yMid = O.y + (cy + 0.5) * VOXEL;
      const v = vox(cx, cy, cz);
      let cls: number;
      if (yMid > skyLineY) {
        cls = SKY; // E4: the pano backdrop band — above everything physical
      } else if (hasCol[v]) {
        // collider here — confirmed only with visual corroboration (E7/E11:
        // physics the camera never saw stays UNKNOWN, not trusted-occupied)
        cls = nearSplats(cx, cy, cz) >= CORROBORATE_PTS || yMid <= bottom + 1 ? OCCUPIED : UNKNOWN;
      } else if (hasColumn && yMid < bottom - 0.5) {
        cls = OCCUPIED; // solid interior below the ground shell
      } else if (splatCount[v] >= GHOST_PTS) {
        cls = UNKNOWN; // E11 ghost rule: visible matter with no physics — never free
      } else if (hasColumn && inEnvelope && yMid > top + 0.5) {
        cls = FREE; // camera-verified air above confirmed ground
      } else {
        cls = UNKNOWN;
      }
      grid[v] = cls;
      counts[cls]++;
    }
  }
}

// nav-graph receipt: connectivity of FREE space (6-connected flood fill)
let largestFree = 0, freeComponents = 0;
{
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (grid[start] !== FREE || seen[start]) continue;
    freeComponents++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const cur = queue[head++]; size++;
      const cz0 = cur % NZ, cy0 = ((cur - cz0) / NZ) % NY, cx0 = Math.floor(cur / (NY * NZ));
      const nbrs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
      for (const [dx, dy, dz] of nbrs) {
        const gx = cx0 + dx, gy = cy0 + dy, gz = cz0 + dz;
        if (!inGrid(gx, gy, gz)) continue;
        const nv = vox(gx, gy, gz);
        if (grid[nv] === FREE && !seen[nv]) { seen[nv] = 1; queue[tail++] = nv; }
      }
    }
    if (size > largestFree) largestFree = size;
  }
}

console.log(`[4/4] writing flight map…`);
let certHash: string | undefined;
const certPath = join(dir, "certificate.json");
if (existsSync(certPath)) {
  const { createHash } = await import("node:crypto");
  const cert = JSON.parse(readFileSync(certPath, "utf-8")) as Record<string, unknown>;
  certHash = createHash("sha256").update(JSON.stringify({ ...cert, createdAt: "" })).digest("hex").slice(0, 16);
}
writeFileSync(join(dir, "flightmap.bin"), Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength));
writeFileSync(
  join(dir, "flightmap-meta.json"),
  JSON.stringify(
    {
      worldId: dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop(),
      voxelM: VOXEL,
      origin: O,
      dims: { x: NX, y: NY, z: NZ },
      order: "x-major: index = (x*NY + y)*NZ + z",
      classes: { 0: "unknown", 1: "free", 2: "occupied", 3: "sky" },
      counts: Object.fromEntries(CLASS_NAMES.map((n, i) => [n, counts[i]])),
      skyLineY,
      navGraph: { connectivity: "6-connected over FREE", largestFreeComponent: largestFree, freeComponents },
      provenance: {
        certificateSha256_16: certHash ?? "no certificate in bundle",
        rules: "FREE=camera-verified air; OCCUPIED=splat-corroborated collider or solid interior; UNKNOWN=uncorroborated physics (occlusion ring), visible-matter-without-physics (ghosts), or unverified air; SKY=above the physical world (pano backdrop band)",
      },
    },
    null,
    2,
  ),
);
const pct = (i: number) => ((100 * counts[i]) / N).toFixed(1);
console.log(`\n=== FLIGHT MAP (${dir}) ===`);
console.log(`  free      ${counts[FREE].toLocaleString()} (${pct(FREE)}%) — largest connected component ${largestFree.toLocaleString()} voxels (${freeComponents} components)`);
console.log(`  occupied  ${counts[OCCUPIED].toLocaleString()} (${pct(OCCUPIED)}%)`);
console.log(`  unknown   ${counts[UNKNOWN].toLocaleString()} (${pct(UNKNOWN)}%)`);
console.log(`  sky       ${counts[SKY].toLocaleString()} (${pct(SKY)}%)`);
console.log(`GRID-DONE`);
