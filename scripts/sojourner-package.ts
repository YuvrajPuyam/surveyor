/**
 * MISSION PACKAGE assembler — one folder to zip and hand to the team.
 *
 *   npx tsx scripts/sojourner-package.ts <fixed-bundle-dir>
 *
 * Produces <fixed-bundle>-package/ :
 *   README.md                       index + C++ quickstart for the planner
 *   world/collider.glb              repaired physics mesh
 *   world/world.spz                 gaussian splats (visual truth)
 *   world/visual-points.f32         splat centers (vision-lane evidence)
 *   world/world.usda                Isaac-ready USD stage
 *   certificate/certificate.json    canonical, hashable
 *   certificate/certificate.md      human-readable
 *   flightmap/flightmap.bin         Uint8 voxels (0 unknown/1 free/2 occupied/3 sky)
 *   flightmap/flightmap-meta.json   dims/origin/legend/counts/provenance
 *   flightmap/clearance.bin         Uint8 per voxel: voxels to nearest OCCUPIED (capped 255)
 *   flightmap/navgraph.json         free-space components, frontier, graph semantics
 *                                   (world-derived only — constraints/waypoints are the planner's)
 *   receipts/*.json                 fix + ghostfix receipts
 *   proof/*.png                     evidence images
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: npx tsx scripts/sojourner-package.ts <fixed-bundle-dir>"); process.exit(2); }
const clean = dir.replace(/[\\/]+$/, "");
const rawDir = clean.replace(/-fixed$/, "");
const out = clean + "-package";
const P = (...s: string[]) => join(out, ...s);
for (const sub of ["world", "certificate", "flightmap", "receipts", "proof"]) mkdirSync(P(sub), { recursive: true });

const missing: string[] = [];
const take = (src: string, dest: string, required = true): boolean => {
  if (existsSync(src)) { copyFileSync(src, dest); return true; }
  if (required) { console.warn(`  MISSING (required): ${src}`); missing.push(src); }
  return false;
};

console.log("[1/4] collecting artifacts…");
take(join(clean, "collider.glb"), P("world", "collider.glb"));
take(join(clean, "visual-points.f32"), P("world", "visual-points.f32"));
// splat: bundles name it differently by lane (API: splat-<tier>.spz, app
// export: whatever the user saved). Search both dirs, best tier first.
const SPLAT_CANDIDATES = ["splat-full.spz", "splat-500k.spz", "splat-100k.spz", "world.spz", "splat.spz"];
const splatSrc = [clean, rawDir]
  .flatMap((d) => SPLAT_CANDIDATES.map((n) => join(d, n)))
  .concat([clean, rawDir].flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".spz")).map((f) => join(d, f)) : [])))
  .find((p) => existsSync(p));
if (splatSrc) copyFileSync(splatSrc, P("world", "world.spz"));
else { console.warn("  MISSING (required): no .spz splat found in bundle or raw sibling"); missing.push("<any>.spz"); }
take(join(clean, "world.usda"), P("world", "world.usda"));
take(join(clean, "certificate.json"), P("certificate", "certificate.json"));
take(join(clean, "certificate.md"), P("certificate", "certificate.md"), false);
take(join(clean, "flightmap.bin"), P("flightmap", "flightmap.bin"));
take(join(clean, "flightmap-meta.json"), P("flightmap", "flightmap-meta.json"));
take(join(clean, "fix-receipt.json"), P("receipts", "fix-receipt.json"), false);
take(join(clean, "ghostfix-receipt.json"), P("receipts", "ghostfix-receipt.json"), false);
for (const f of readdirSync(rawDir)) if (f.startsWith("proof-") && f.endsWith(".png")) take(join(rawDir, f), P("proof", f), false);

console.log("[2/4] clearance field (distance-to-occupied, for the clearance cost term)…");
const meta = JSON.parse(readFileSync(P("flightmap", "flightmap-meta.json"), "utf-8")) as {
  voxelM: number; origin: { x: number; y: number; z: number }; dims: { x: number; y: number; z: number };
};
const { x: NX, y: NY, z: NZ } = meta.dims;
const N = NX * NY * NZ;
const grid = new Uint8Array(readFileSync(P("flightmap", "flightmap.bin")));
const UNKNOWN = 0, FREE = 1, OCCUPIED = 2;
// multi-source BFS from every OCCUPIED voxel, 6-connected, distance in voxels
const dist = new Uint8Array(N).fill(255);
let queue = new Int32Array(N);
let tail = 0;
for (let v = 0; v < N; v++) if (grid[v] === OCCUPIED) { dist[v] = 0; queue[tail++] = v; }
let head = 0;
while (head < tail) {
  const cur = queue[head++];
  const d = dist[cur];
  if (d >= 254) continue;
  const cz = cur % NZ, cy = ((cur - cz) / NZ) % NY, cx = Math.floor(cur / (NY * NZ));
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const) {
    const gx = cx + dx, gy = cy + dy, gz = cz + dz;
    if (gx < 0 || gx >= NX || gy < 0 || gy >= NY || gz < 0 || gz >= NZ) continue;
    const nv = (gx * NY + gy) * NZ + gz;
    if (dist[nv] > d + 1) { dist[nv] = d + 1; queue[tail++] = nv; }
  }
}
writeFileSync(P("flightmap", "clearance.bin"), Buffer.from(dist.buffer, dist.byteOffset, dist.byteLength));

console.log("[3/4] nav-graph analysis (world-derived only — constraints/waypoints are the planner's job)…");
// connected components of FREE space (6-connected) — the graph structure a
// planner needs to know before it plans: how many islands, how big, where.
const compId = new Int32Array(N).fill(-1);
const compStats: { id: number; voxels: number; min: number[]; max: number[] }[] = [];
{
  const q2 = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (grid[start] !== FREE || compId[start] !== -1) continue;
    const id = compStats.length;
    let h = 0, t = 0, size = 0;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    q2[t++] = start; compId[start] = id;
    while (h < t) {
      const cur = q2[h++]; size++;
      const cz = cur % NZ, cy = ((cur - cz) / NZ) % NY, cx = Math.floor(cur / (NY * NZ));
      if (cx < mn[0]) mn[0] = cx; if (cy < mn[1]) mn[1] = cy; if (cz < mn[2]) mn[2] = cz;
      if (cx > mx[0]) mx[0] = cx; if (cy > mx[1]) mx[1] = cy; if (cz > mx[2]) mx[2] = cz;
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const) {
        const gx = cx + dx, gy = cy + dy, gz = cz + dz;
        if (gx < 0 || gx >= NX || gy < 0 || gy >= NY || gz < 0 || gz >= NZ) continue;
        const nv = (gx * NY + gy) * NZ + gz;
        if (grid[nv] === FREE && compId[nv] === -1) { compId[nv] = id; q2[t++] = nv; }
      }
    }
    compStats.push({ id, voxels: size, min: mn, max: mx });
  }
}
compStats.sort((a, b) => b.voxels - a.voxels);
// frontier count: FREE voxels adjacent to UNKNOWN (the information-gain surface)
let frontier = 0;
for (let v = 0; v < N; v++) {
  if (grid[v] !== FREE) continue;
  const cz = v % NZ, cy = ((v - cz) / NZ) % NY, cx = Math.floor(v / (NY * NZ));
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const) {
    const gx = cx + dx, gy = cy + dy, gz = cz + dz;
    if (gx < 0 || gx >= NX || gy < 0 || gy >= NY || gz < 0 || gz >= NZ) continue;
    if (grid[(gx * NY + gy) * NZ + gz] === UNKNOWN) { frontier++; break; }
  }
}
const toWorld = (c: number[], hi = false) => [
  meta.origin.x + (c[0] + (hi ? 1 : 0)) * meta.voxelM,
  meta.origin.y + (c[1] + (hi ? 1 : 0)) * meta.voxelM,
  meta.origin.z + (c[2] + (hi ? 1 : 0)) * meta.voxelM,
];
writeFileSync(P("flightmap", "navgraph.json"), JSON.stringify({
  source: "derived from flightmap.bin only — nothing invented",
  graph: {
    nodes: "every FREE voxel (class 1)",
    edges: "6-connected FREE neighbors, uniform length = voxelM; the grid IS the graph — no separate edge list needed",
  },
  freeComponents: {
    count: compStats.length,
    largest: compStats.slice(0, 8).map((c) => ({
      voxels: c.voxels,
      worldBounds: { min: toWorld(c.min), max: toWorld(c.max, true) },
    })),
    note: "plan within one component; crossing components requires traversing UNKNOWN (a policy decision, not a graph edge)",
  },
  frontier: {
    voxels: frontier,
    meaning: "FREE voxels adjacent to UNKNOWN — the information-gain surface; exploration targets live here",
  },
  clearanceField: "clearance.bin — per-voxel 6-connected distance to nearest OCCUPIED (multiply by voxelM for meters)",
}, null, 2));

console.log("[4/4] README…");
const counts = JSON.parse(readFileSync(P("flightmap", "flightmap-meta.json"), "utf-8")) as { counts: Record<string, number> };
writeFileSync(P("README.md"), `# SOJOURNER MISSION PACKAGE — ${basename(rawDir)}

Everything needed to plan and fly a simulated drone mission in this world.
Generated by the SURVEYOR/Sojourner pipeline: image -> Marble world ->
certified teardown -> repair (carve/patch/defloat/ghost-fix) -> flight map.

## Layout
- world/        repaired physics mesh (collider.glb), splats (world.spz),
                splat centers (visual-points.f32), Isaac USD stage (world.usda)
- certificate/  the world's passport: grade, trust, defects, verdicts (json + md)
- flightmap/    the planner's map + nav-graph analysis — see below
- receipts/     what was repaired, with numbers
- proof/        evidence images from the teardown

Drone constraints, cost weights, and mission waypoints are deliberately NOT
in this package — they belong to the planner (Brandon). Everything here is
derived from the generated world itself.

## Flight map (flightmap/)
- flightmap.bin: one byte per voxel. 0=UNKNOWN 1=FREE 2=OCCUPIED 3=SKY.
  x-major: index = (x*NY + y)*NZ + z. Dims/origin/voxel size in flightmap-meta.json.
- clearance.bin: same layout; value = 6-connected voxel distance to nearest
  OCCUPIED (cap 255). Meters = value * voxelM.
- navgraph.json: free-space connected components (sizes + world bounds),
  frontier count (FREE adjacent to UNKNOWN — the information-gain surface),
  and the graph semantics (nodes = FREE voxels, edges = 6-connected neighbors).
- Semantics: FREE is camera-verified air. UNKNOWN is honest ignorance
  (occlusion shadows, uncorroborated physics) — traversable at a cost, never free.
  SKY is above the physical world (pano backdrop band). Class counts:
  ${Object.entries(counts.counts).map(([k, v]) => `${k}=${v.toLocaleString("en-US")}`).join("  ")}

## C++ quickstart (Brandon)
\`\`\`cpp
#include <cstdint>
#include <fstream>
#include <vector>
// dims from flightmap-meta.json
constexpr int NX=${NX}, NY=${NY}, NZ=${NZ};
inline size_t idx(int x,int y,int z){ return (size_t(x)*NY + y)*NZ + z; }
std::vector<uint8_t> load(const char* p){ std::ifstream f(p, std::ios::binary);
  return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()}; }
// auto grid = load("flightmap/flightmap.bin");   // 0 unk / 1 free / 2 occ / 3 sky
// auto clr  = load("flightmap/clearance.bin");   // meters = clr[i] * voxelM
\`\`\`
Everything a cost function needs is a lookup: grid class (unknown/free/
occupied/sky), clearance meters, and frontier adjacency for information
gain. Weights, drone constraints, and energy models are yours.

## Provenance
The flight map inherits the certificate's evidence rules; the certificate hash
is in flightmap-meta.json. Chain: nothing in this package is asserted without
a measurement behind it — see certificate/certificate.md for the fine print.
`);
if (missing.length > 0) {
  console.error(`\nPACKAGE INCOMPLETE — ${missing.length} required artifact(s) missing:`);
  for (const m of missing) console.error(`  ${m}`);
  console.error("(a package that silently ships without its collider or splats is worse than no package)");
  process.exit(1);
}
console.log(`\npackage -> ${out}`);
console.log("PACKAGE-DONE");
