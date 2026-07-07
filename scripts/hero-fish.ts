/**
 * HERO FISHING, batched (ENDGAME C13, Gemini-review addition): "generate
 * many, let the certificates pick the hero" — mechanically, at fleet scale.
 *
 * Rank mode (works today, no credits needed):
 *   npx tsx scripts/hero-fish.ts --scan assets/marble
 *   npx tsx scripts/hero-fish.ts <bundle-dir> [<bundle-dir> ...]
 *
 * Ingest mode (world already generated in the Marble APP — free path):
 *   npx tsx scripts/hero-fish.ts --download <worldId> [<worldId> ...]
 *
 * For each bundle: certify (--write-bundle, only if certificate.json is
 * missing or --recertify) → hero-check (the physics-dry-run validated
 * twin-run route + Beat-3 sill band + ghost + hole + vendor scale) → ranked
 * table. Exit 0 if at least one hero emerged.
 *
 * Casting new drafts stays in scripts/marble.ts (`image` / `generate`) —
 * this wrapper starts where a world id or a bundle on disk exists.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  dir: string;
  world: string;
  grade: string;
  hero: boolean;
  notes: string;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: hero-fish.ts --scan <dir> | --download <worldId...> | <bundle-dir...> [--recertify]");
  process.exit(2);
}
const recertify = args.includes("--recertify");
const rest = args.filter((a) => a !== "--recertify");

function sh(cmd: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// ---- collect bundle dirs
let dirs: string[] = [];
if (rest[0] === "--scan") {
  const root = rest[1] ?? "assets/marble";
  dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((d) => existsSync(join(d, "collider.glb")));
} else if (rest[0] === "--download") {
  for (const id of rest.slice(1)) {
    console.log(`downloading ${id}…`);
    const r = sh(`npx tsx scripts/marble.ts download ${id}`);
    if (!r.ok) {
      console.error(r.out.slice(-400));
      continue;
    }
    const dir = join("assets/marble", id);
    if (existsSync(join(dir, "collider.glb"))) dirs.push(dir);
  }
} else {
  dirs = rest;
}
if (dirs.length === 0) {
  console.error("no bundles to fish");
  process.exit(2);
}

// ---- certify + hero-check each
const rows: Row[] = [];
for (const dir of dirs) {
  const world = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? dir;
  const certPath = join(dir, "certificate.json");
  if (recertify || !existsSync(certPath)) {
    process.stdout.write(`certifying ${world}… `);
    const c = sh(`node bin/surveyor.mjs certify ${JSON.stringify(dir)} --write-bundle --min-grade F`);
    console.log(c.ok || existsSync(certPath) ? "done" : "FAILED");
    if (!existsSync(certPath)) {
      rows.push({ dir, world, grade: "?", hero: false, notes: "certify failed" });
      continue;
    }
  }
  let grade = "?";
  try {
    grade = (JSON.parse(readFileSync(certPath, "utf-8")) as { grade?: string }).grade ?? "?";
  } catch {
    /* leave ? */
  }
  process.stdout.write(`hero-check ${world}… `);
  const h = sh(`npx tsx scripts/hero-check.ts ${JSON.stringify(dir)}`);
  // the check's last non-empty lines carry the verdict + per-property summary
  const tail = h.out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-4)
    .join(" · ");
  console.log(h.ok ? "HERO" : "not the hero");
  rows.push({ dir, world, grade, hero: h.ok, notes: tail.slice(0, 220) });
}

// ---- ranked table: heroes first, then by grade (A best) — the fleet view
const gradeRank = (g: string): number => "ABCDF".indexOf(g[0] ?? "F");
rows.sort((a, b) => Number(b.hero) - Number(a.hero) || gradeRank(a.grade) - gradeRank(b.grade) || a.world.localeCompare(b.world));

console.log("\n=== HERO FISHING — the certificates pick the hero ===");
for (const r of rows) {
  console.log(`${r.hero ? "★ HERO " : "        "}${r.grade.padEnd(2)} ${r.world}`);
  if (r.notes) console.log(`         ${r.notes}`);
}
const heroes = rows.filter((r) => r.hero);
console.log(`\n${heroes.length}/${rows.length} candidates carry a validated twin-run failure route + the Beat-3 contrast.`);
process.exit(heroes.length > 0 ? 0 : 1);
