/**
 * validate-flightmap.ts — rigorous validator for SOJOURNER flight-map outputs.
 *
 * Usage:
 *   npx tsx scripts/validate-flightmap.ts <dir>       validate flightmap.bin + flightmap-meta.json
 *                                                     (+ clearance.bin / navgraph.json when present)
 *   npx tsx scripts/validate-flightmap.ts --self-test prove the checker on a synthetic 4x3x4 grid
 *
 * Exit 0 = all checks pass; exit 1 = one or more numbered failures.
 *
 * Checks:
 *   A  flightmap.bin byte length === dims.x * dims.y * dims.z
 *   B  every byte in {0 unknown, 1 free, 2 occupied, 3 sky}
 *   C  class recount matches meta.counts exactly
 *   D  6-connected flood fill over FREE: largest component + component count match meta.navGraph
 *   E  skyLineY: (voxel-center y > skyLineY) <=> class SKY, both directions
 *   F  clearance.bin (if present): same length; clearance==0 <=> OCCUPIED (both directions);
 *      Lipschitz |c[a]-c[b]| <= 1 on 100k random adjacent pairs (255-capped values skipped)
 *   G  navgraph.json (if present): frontier recount (FREE 6-adjacent to UNKNOWN) matches;
 *      sum of listed component sizes <= total free; largest listed === meta largestFreeComponent;
 *      listed count === meta freeComponents
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UNKNOWN = 0, FREE = 1, OCCUPIED = 2, SKY = 3;

interface Meta {
  voxelM: number;
  origin: { x: number; y: number; z: number };
  dims: { x: number; y: number; z: number };
  counts: { unknown: number; free: number; occupied: number; sky: number };
  skyLineY: number;
  navGraph: { largestFreeComponent: number; freeComponents: number };
}

interface Navgraph {
  freeComponents: { count: number; largest: { voxels: number }[] };
  frontier: { voxels: number };
}

interface Dataset {
  meta: Meta;
  grid: Uint8Array;
  clearance: Uint8Array | null;
  navgraph: Navgraph | null;
}

// ---------------------------------------------------------------- helpers

/** 6-connected flood fill over FREE voxels: component count + largest size. */
function freeComponents(grid: Uint8Array, NX: number, NY: number, NZ: number): { count: number; largest: number } {
  const N = NX * NY * NZ;
  const NYNZ = NY * NZ;
  const visited = new Uint8Array(N);
  const queue = new Int32Array(N);
  let count = 0, largest = 0;
  for (let s = 0; s < N; s++) {
    if (grid[s] !== FREE || visited[s]) continue;
    count++;
    visited[s] = 1;
    queue[0] = s;
    let head = 0, tail = 1;
    while (head < tail) {
      const v = queue[head++];
      const cz = v % NZ;
      const cy = ((v - cz) / NZ) % NY;
      const cx = Math.floor(v / NYNZ);
      if (cx > 0) { const n = v - NYNZ; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
      if (cx < NX - 1) { const n = v + NYNZ; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
      if (cy > 0) { const n = v - NZ; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
      if (cy < NY - 1) { const n = v + NZ; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
      if (cz > 0) { const n = v - 1; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
      if (cz < NZ - 1) { const n = v + 1; if (grid[n] === FREE && !visited[n]) { visited[n] = 1; queue[tail++] = n; } }
    }
    if (tail > largest) largest = tail;
  }
  return { count, largest };
}

/** FREE voxels 6-adjacent (in-grid) to at least one UNKNOWN voxel. */
function countFrontier(grid: Uint8Array, NX: number, NY: number, NZ: number): number {
  const N = NX * NY * NZ;
  const NYNZ = NY * NZ;
  let frontier = 0;
  for (let v = 0; v < N; v++) {
    if (grid[v] !== FREE) continue;
    const cz = v % NZ;
    const cy = ((v - cz) / NZ) % NY;
    const cx = Math.floor(v / NYNZ);
    if (
      (cx > 0 && grid[v - NYNZ] === UNKNOWN) ||
      (cx < NX - 1 && grid[v + NYNZ] === UNKNOWN) ||
      (cy > 0 && grid[v - NZ] === UNKNOWN) ||
      (cy < NY - 1 && grid[v + NZ] === UNKNOWN) ||
      (cz > 0 && grid[v - 1] === UNKNOWN) ||
      (cz < NZ - 1 && grid[v + 1] === UNKNOWN)
    ) frontier++;
  }
  return frontier;
}

function coordOf(v: number, NY: number, NZ: number): [number, number, number] {
  const cz = v % NZ;
  const cy = ((v - cz) / NZ) % NY;
  const cx = Math.floor(v / (NY * NZ));
  return [cx, cy, cz];
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- checks
// Each returns a list of failure messages (empty = pass).

function checkA_byteLength(ds: Dataset): string[] {
  const { x, y, z } = ds.meta.dims;
  const expect = x * y * z;
  return ds.grid.length === expect
    ? []
    : [`flightmap.bin length ${ds.grid.length} !== dims product ${x}*${y}*${z} = ${expect}`];
}

function checkB_domain(ds: Dataset): string[] {
  const fails: string[] = [];
  let bad = 0;
  for (let v = 0; v < ds.grid.length; v++) {
    if (ds.grid[v] > 3) {
      bad++;
      if (bad <= 3) {
        const [cx, cy, cz] = coordOf(v, ds.meta.dims.y, ds.meta.dims.z);
        fails.push(`byte value ${ds.grid[v]} outside {0,1,2,3} at voxel (${cx},${cy},${cz}) index ${v}`);
      }
    }
  }
  if (bad > 3) fails.push(`...and ${bad - 3} more out-of-domain bytes (total ${bad})`);
  return fails;
}

function checkC_counts(ds: Dataset): string[] {
  const counts = [0, 0, 0, 0];
  for (let v = 0; v < ds.grid.length; v++) if (ds.grid[v] <= 3) counts[ds.grid[v]]++;
  const names = ["unknown", "free", "occupied", "sky"] as const;
  const fails: string[] = [];
  for (let c = 0; c < 4; c++) {
    if (counts[c] !== ds.meta.counts[names[c]]) {
      fails.push(`class ${names[c]}: recounted ${counts[c]}, meta says ${ds.meta.counts[names[c]]}`);
    }
  }
  return fails;
}

function checkD_components(ds: Dataset): string[] {
  const { x: NX, y: NY, z: NZ } = ds.meta.dims;
  const { count, largest } = freeComponents(ds.grid, NX, NY, NZ);
  const fails: string[] = [];
  if (largest !== ds.meta.navGraph.largestFreeComponent) {
    fails.push(`largest FREE component: recomputed ${largest}, meta says ${ds.meta.navGraph.largestFreeComponent}`);
  }
  if (count !== ds.meta.navGraph.freeComponents) {
    fails.push(`FREE component count: recomputed ${count}, meta says ${ds.meta.navGraph.freeComponents}`);
  }
  return fails;
}

function checkE_skyline(ds: Dataset): string[] {
  const { x: NX, y: NY, z: NZ } = ds.meta.dims;
  const { origin, voxelM, skyLineY } = ds.meta;
  const above: boolean[] = [];
  for (let cy = 0; cy < NY; cy++) above.push(origin.y + (cy + 0.5) * voxelM > skyLineY);
  const fails: string[] = [];
  let aboveNotSky = 0, belowSky = 0;
  let v = 0;
  for (let cx = 0; cx < NX; cx++) {
    for (let cy = 0; cy < NY; cy++) {
      const isAbove = above[cy];
      for (let cz = 0; cz < NZ; cz++, v++) {
        const isSky = ds.grid[v] === SKY;
        if (isAbove && !isSky) {
          if (aboveNotSky < 3) fails.push(`voxel (${cx},${cy},${cz}) center y above skyLineY but class ${ds.grid[v]} (not sky)`);
          aboveNotSky++;
        } else if (!isAbove && isSky) {
          if (belowSky < 3) fails.push(`voxel (${cx},${cy},${cz}) center y below skyLineY but class SKY`);
          belowSky++;
        }
      }
    }
  }
  if (aboveNotSky > 3) fails.push(`...total ${aboveNotSky} above-skyline voxels not SKY`);
  if (belowSky > 3) fails.push(`...total ${belowSky} below-skyline voxels marked SKY`);
  return fails;
}

let clearanceSampleNote = ""; // stats from the last checkF run, shown next to PASS

function checkF_clearance(ds: Dataset): string[] {
  const clr = ds.clearance;
  if (!clr) return [];
  const { x: NX, y: NY, z: NZ } = ds.meta.dims;
  const N = NX * NY * NZ;
  const NYNZ = NY * NZ;
  const fails: string[] = [];
  if (clr.length !== N) {
    fails.push(`clearance.bin length ${clr.length} !== ${N}`);
    return fails; // layout broken — further indexing meaningless
  }
  // occupied <=> clearance 0, both directions
  let occNonZero = 0, zeroNonOcc = 0;
  for (let v = 0; v < N; v++) {
    if (ds.grid[v] === OCCUPIED && clr[v] !== 0) {
      if (occNonZero < 3) {
        const [cx, cy, cz] = coordOf(v, NY, NZ);
        fails.push(`OCCUPIED voxel (${cx},${cy},${cz}) has clearance ${clr[v]} (expected 0)`);
      }
      occNonZero++;
    } else if (clr[v] === 0 && ds.grid[v] !== OCCUPIED) {
      if (zeroNonOcc < 3) {
        const [cx, cy, cz] = coordOf(v, NY, NZ);
        fails.push(`clearance 0 at (${cx},${cy},${cz}) but class ${ds.grid[v]} (not occupied)`);
      }
      zeroNonOcc++;
    }
  }
  if (occNonZero > 3) fails.push(`...total ${occNonZero} occupied voxels with nonzero clearance`);
  if (zeroNonOcc > 3) fails.push(`...total ${zeroNonOcc} zero-clearance voxels not occupied`);
  // Lipschitz on 100k random adjacent pairs (skip 255-capped values: they mean ">= 255")
  const rand = mulberry32(0x50104e3); // fixed seed: reproducible sample
  let lipschitzFails = 0, tested = 0, skipped = 0;
  const AXES: [number, number][] = [[NYNZ, 0], [NZ, 1], [1, 2]]; // stride, axis id
  for (let i = 0; i < 100_000; i++) {
    const v = Math.floor(rand() * N);
    const [stride, axis] = AXES[Math.floor(rand() * 3)];
    const [cx, cy, cz] = coordOf(v, NY, NZ);
    const coord = axis === 0 ? cx : axis === 1 ? cy : cz;
    const dim = axis === 0 ? NX : axis === 1 ? NY : NZ;
    const w = coord + 1 < dim ? v + stride : v - stride;
    if (w < 0 || w >= N) continue; // dim of size 1 on that axis
    if (clr[v] === 255 || clr[w] === 255) { skipped++; continue; }
    tested++;
    const d = Math.abs(clr[v] - clr[w]);
    if (d > 1) {
      if (lipschitzFails < 3) {
        fails.push(`Lipschitz violated: |clearance ${clr[v]} - ${clr[w]}| = ${d} > 1 between adjacent voxels index ${v} and ${w}`);
      }
      lipschitzFails++;
    }
  }
  if (lipschitzFails > 3) fails.push(`...total ${lipschitzFails} Lipschitz violations in sample`);
  clearanceSampleNote = `${tested} pairs tested, ${skipped} skipped (255-capped)`;
  return fails;
}

function checkG_navgraph(ds: Dataset): string[] {
  const ng = ds.navgraph;
  if (!ng) return [];
  const { x: NX, y: NY, z: NZ } = ds.meta.dims;
  const fails: string[] = [];
  const frontier = countFrontier(ds.grid, NX, NY, NZ);
  if (frontier !== ng.frontier.voxels) {
    fails.push(`frontier recount ${frontier} !== navgraph.frontier.voxels ${ng.frontier.voxels}`);
  }
  let freeTotal = 0;
  for (let v = 0; v < ds.grid.length; v++) if (ds.grid[v] === FREE) freeTotal++;
  const listedSum = ng.freeComponents.largest.reduce((s, c) => s + c.voxels, 0);
  if (listedSum > freeTotal) {
    fails.push(`sum of listed component sizes ${listedSum} > total FREE count ${freeTotal}`);
  }
  const listedLargest = ng.freeComponents.largest.length > 0 ? ng.freeComponents.largest[0].voxels : -1;
  if (listedLargest !== ds.meta.navGraph.largestFreeComponent) {
    fails.push(`navgraph largest listed component ${listedLargest} !== meta.navGraph.largestFreeComponent ${ds.meta.navGraph.largestFreeComponent}`);
  }
  if (ng.freeComponents.count !== ds.meta.navGraph.freeComponents) {
    fails.push(`navgraph.freeComponents.count ${ng.freeComponents.count} !== meta.navGraph.freeComponents ${ds.meta.navGraph.freeComponents}`);
  }
  return fails;
}

// ---------------------------------------------------------------- runner

const CHECKS: { id: string; name: string; fn: (ds: Dataset) => string[]; needs?: "clearance" | "navgraph" }[] = [
  { id: "A", name: "flightmap.bin byte length matches dims", fn: checkA_byteLength },
  { id: "B", name: "all byte values in {0,1,2,3}", fn: checkB_domain },
  { id: "C", name: "class recount matches meta.counts", fn: checkC_counts },
  { id: "D", name: "flood-fill largest/count matches meta.navGraph", fn: checkD_components },
  { id: "E", name: "skyLineY consistency (above <=> SKY)", fn: checkE_skyline },
  { id: "F", name: "clearance.bin (occupied<=>0, Lipschitz sample)", fn: checkF_clearance, needs: "clearance" },
  { id: "G", name: "navgraph.json (frontier, component sums, largest)", fn: checkG_navgraph, needs: "navgraph" },
];

function runChecks(ds: Dataset): number {
  let failNo = 0;
  for (const c of CHECKS) {
    if (c.needs === "clearance" && !ds.clearance) { console.log(`  [${c.id}] SKIP  ${c.name} — clearance.bin not present (produced at packaging time)`); continue; }
    if (c.needs === "navgraph" && !ds.navgraph) { console.log(`  [${c.id}] SKIP  ${c.name} — navgraph.json not present (produced at packaging time)`); continue; }
    const fails = c.fn(ds);
    if (fails.length === 0) {
      const note = c.id === "F" && clearanceSampleNote ? ` (${clearanceSampleNote})` : "";
      console.log(`  [${c.id}] PASS  ${c.name}${note}`);
    } else {
      console.log(`  [${c.id}] FAIL  ${c.name}`);
      for (const f of fails) console.log(`        ${++failNo}. ${f}`);
    }
  }
  return failNo;
}

function loadDir(dir: string): Dataset {
  const metaPath = join(dir, "flightmap-meta.json");
  const binPath = join(dir, "flightmap.bin");
  if (!existsSync(metaPath)) { console.error(`missing ${metaPath}`); process.exit(1); }
  if (!existsSync(binPath)) { console.error(`missing ${binPath}`); process.exit(1); }
  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Meta;
  const buf = readFileSync(binPath);
  const grid = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let clearance: Uint8Array | null = null;
  const clrPath = join(dir, "clearance.bin");
  if (existsSync(clrPath)) {
    const cbuf = readFileSync(clrPath);
    clearance = new Uint8Array(cbuf.buffer, cbuf.byteOffset, cbuf.byteLength);
  }
  let navgraph: Navgraph | null = null;
  const ngPath = join(dir, "navgraph.json");
  if (existsSync(ngPath)) navgraph = JSON.parse(readFileSync(ngPath, "utf-8")) as Navgraph;
  return { meta, grid, clearance, navgraph };
}

// ---------------------------------------------------------------- self-test
// A 4x3x4 grid with every value hand-computed, plus targeted corruptions that
// each check must catch — proving the checker detects what it claims to.

function buildSynthetic(): Dataset {
  const NX = 4, NY = 3, NZ = 4, N = NX * NY * NZ;
  const grid = new Uint8Array(N);
  const vox = (cx: number, cy: number, cz: number) => (cx * NY + cy) * NZ + cz;
  // cy=0: all OCCUPIED (ground). cy=2: all SKY (center y 2.5 > skyLineY 2.0).
  // cy=1: FREE at (0,*,0),(0,*,1),(1,*,1) [one 3-voxel component] and (3,*,3)
  //       [isolated 1-voxel component]; the other 12 cells UNKNOWN.
  for (let cx = 0; cx < NX; cx++) {
    for (let cz = 0; cz < NZ; cz++) {
      grid[vox(cx, 0, cz)] = OCCUPIED;
      grid[vox(cx, 1, cz)] = UNKNOWN;
      grid[vox(cx, 2, cz)] = SKY;
    }
  }
  grid[vox(0, 1, 0)] = FREE;
  grid[vox(0, 1, 1)] = FREE;
  grid[vox(1, 1, 1)] = FREE;
  grid[vox(3, 1, 3)] = FREE;
  // Hand-computed truth:
  //   counts: unknown=12 free=4 occupied=16 sky=16 (total 48)
  //   components: {(0,1,0),(0,1,1),(1,1,1)} size 3 + {(3,1,3)} size 1 -> count 2, largest 3
  //   frontier: all 4 FREE voxels touch an UNKNOWN in-layer -> 4
  //   clearance: cy=0 -> 0, cy=1 -> 1, cy=2 -> 2 (occupied fills the whole floor)
  const meta: Meta = {
    voxelM: 1,
    origin: { x: 0, y: 0, z: 0 },
    dims: { x: NX, y: NY, z: NZ },
    counts: { unknown: 12, free: 4, occupied: 16, sky: 16 },
    skyLineY: 2.0,
    navGraph: { largestFreeComponent: 3, freeComponents: 2 },
  };
  const clearance = new Uint8Array(N);
  for (let cx = 0; cx < NX; cx++) {
    for (let cz = 0; cz < NZ; cz++) {
      clearance[vox(cx, 0, cz)] = 0;
      clearance[vox(cx, 1, cz)] = 1;
      clearance[vox(cx, 2, cz)] = 2;
    }
  }
  const navgraph: Navgraph = {
    freeComponents: { count: 2, largest: [{ voxels: 3 }, { voxels: 1 }] },
    frontier: { voxels: 4 },
  };
  return { meta, grid, clearance, navgraph };
}

function selfTest(): number {
  console.log("self-test: synthetic 4x3x4 grid (hand-computed ground truth)\n");
  let problems = 0;
  const good = buildSynthetic();

  // 1. Direct verification of the recompute helpers against hand-computed values.
  const { count, largest } = freeComponents(good.grid, 4, 3, 4);
  const frontier = countFrontier(good.grid, 4, 3, 4);
  const assertEq = (what: string, got: number, want: number): void => {
    if (got === want) console.log(`  helper OK   ${what} = ${got}`);
    else { console.log(`  helper BAD  ${what} = ${got}, hand-computed ${want}`); problems++; }
  };
  assertEq("freeComponents.count", count, 2);
  assertEq("freeComponents.largest", largest, 3);
  assertEq("frontier", frontier, 4);

  // 2. Every check must PASS on the intact synthetic dataset.
  console.log("\n  all checks on the intact grid:");
  problems += runChecks(good) > 0 ? 1 : 0;

  // 3. Every check must CATCH a targeted corruption (negative tests).
  console.log("\n  negative tests (each corruption must be caught):");
  const negatives: { id: string; fn: (ds: Dataset) => string[]; corrupt: (ds: Dataset) => void; desc: string }[] = [
    { id: "A", fn: checkA_byteLength, desc: "truncated flightmap.bin", corrupt: (d) => { d.grid = d.grid.subarray(0, 47); } },
    { id: "B", fn: checkB_domain, desc: "byte value 7 injected", corrupt: (d) => { d.grid[5] = 7; } },
    { id: "C", fn: checkC_counts, desc: "meta.counts.free off by 1", corrupt: (d) => { d.meta.counts.free = 5; } },
    { id: "D", fn: checkD_components, desc: "meta largestFreeComponent wrong", corrupt: (d) => { d.meta.navGraph.largestFreeComponent = 4; } },
    { id: "D", fn: checkD_components, desc: "meta freeComponents wrong", corrupt: (d) => { d.meta.navGraph.freeComponents = 3; } },
    { id: "E", fn: checkE_skyline, desc: "SKY voxel below skyline", corrupt: (d) => { d.grid[(2 * 3 + 1) * 4 + 2] = SKY; } },
    { id: "E", fn: checkE_skyline, desc: "non-SKY voxel above skyline", corrupt: (d) => { d.grid[(1 * 3 + 2) * 4 + 1] = FREE; } },
    { id: "F", fn: checkF_clearance, desc: "clearance 0 on a FREE voxel", corrupt: (d) => { d.clearance![(0 * 3 + 1) * 4 + 0] = 0; } },
    { id: "F", fn: checkF_clearance, desc: "clearance 5 on an OCCUPIED voxel", corrupt: (d) => { d.clearance![0] = 5; } },
    { id: "F", fn: checkF_clearance, desc: "Lipschitz break (adjacent 1 vs 9)", corrupt: (d) => { d.clearance![(2 * 3 + 1) * 4 + 2] = 9; } },
    { id: "G", fn: checkG_navgraph, desc: "navgraph frontier count wrong", corrupt: (d) => { d.navgraph!.frontier.voxels = 9; } },
    { id: "G", fn: checkG_navgraph, desc: "listed sizes sum > free total", corrupt: (d) => { d.navgraph!.freeComponents.largest = [{ voxels: 3 }, { voxels: 99 }]; } },
    { id: "G", fn: checkG_navgraph, desc: "largest listed != meta largest", corrupt: (d) => { d.navgraph!.freeComponents.largest[0].voxels = 2; } },
  ];
  for (const t of negatives) {
    const ds = buildSynthetic();
    t.corrupt(ds);
    const fails = t.fn(ds);
    if (fails.length > 0) console.log(`  [${t.id}] caught: ${t.desc} -> "${fails[0]}"`);
    else { console.log(`  [${t.id}] MISSED: ${t.desc} — check did not fire`); problems++; }
  }
  return problems;
}

// ---------------------------------------------------------------- main

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npx tsx scripts/validate-flightmap.ts <dir> | --self-test");
  process.exit(1);
}
if (arg === "--self-test") {
  const problems = selfTest();
  console.log(problems === 0 ? "\nself-test: ALL PASS" : `\nself-test: ${problems} problem(s)`);
  process.exit(problems === 0 ? 0 : 1);
} else {
  const ds = loadDir(arg);
  const { x, y, z } = ds.meta.dims;
  console.log(`validating ${arg}`);
  console.log(`  grid ${x} x ${y} x ${z} = ${((x * y * z) / 1e6).toFixed(1)}M voxels; clearance.bin ${ds.clearance ? "present" : "absent"}; navgraph.json ${ds.navgraph ? "present" : "absent"}\n`);
  const failures = runChecks(ds);
  console.log(failures === 0 ? "\nRESULT: ALL PASS" : `\nRESULT: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
