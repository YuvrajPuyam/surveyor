/**
 * Ingest a MARBLE-APP-exported world into a certifiable bundle.
 *
 * The app and the API are separate namespaces (app-generated worlds 404 on
 * the API — Sojourner ledger E3), but the app's export panel hands you the
 * same two artifacts the API would: a collider .glb and a splat .spz.
 * Drop them in assets/marble/<worldId>/ and run:
 *
 *   npx tsx scripts/ingest-app-bundle.ts <worldId>
 *
 * Produces: collider.glb (verified present), visual-points.f32 +
 * visual-scales.f32 (parsed from the .spz, alpha-filtered like marble.ts
 * download), metadata.json. Refuses to overwrite existing derived files
 * unless MARBLE_FORCE=1 (frozen-bundle law).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpzPositions } from "../src/ingest/spz.js";

const worldId = process.argv[2];
if (!worldId) {
  console.error("usage: npx tsx scripts/ingest-app-bundle.ts <worldId>");
  process.exit(2);
}
const dir = join("assets", "marble", worldId);
if (!existsSync(dir)) {
  console.error(`no such bundle dir: ${dir}`);
  process.exit(2);
}
if (existsSync(join(dir, "visual-points.f32")) && process.env.MARBLE_FORCE !== "1") {
  console.error(`visual-points.f32 already exists in ${dir} — refusing to regenerate derived files`);
  console.error(`(re-parsing with a different parser version breaks certificate hashes; MARBLE_FORCE=1 to override)`);
  process.exit(2);
}
if (!existsSync(join(dir, "collider.glb"))) {
  // accept any single .glb and adopt it as the collider
  const glbs = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".glb"));
  if (glbs.length === 1) {
    const { renameSync } = await import("node:fs");
    renameSync(join(dir, glbs[0]), join(dir, "collider.glb"));
    console.log(`adopted ${glbs[0]} as collider.glb`);
  } else {
    console.error(`no collider.glb in ${dir} (found ${glbs.length} .glb files — need exactly one, or name it collider.glb)`);
    process.exit(2);
  }
}
const spzs = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".spz"));
if (spzs.length === 0) {
  console.error(`no .spz splat file in ${dir} — export one from the Marble app`);
  process.exit(2);
}
// prefer the smallest tier for the canonical point evidence (matches API-lane default)
const spzName = spzs.sort((a, b) => a.localeCompare(b))[0];
const spzBuf = readFileSync(join(dir, spzName));
console.log(`parsing ${spzName} (${(spzBuf.length / 1e6).toFixed(1)} MB)…`);
const { positions, numPoints, alphas, maxScales } = parseSpzPositions(spzBuf);
const ALPHA_MIN = 0.1;
const keptPos: number[] = [];
const keptScale: number[] = [];
for (let i = 0; i < numPoints; i++) {
  if ((alphas?.[i] ?? 1) < ALPHA_MIN) continue;
  keptPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  keptScale.push(maxScales?.[i] ?? 0);
}
const posArr = new Float32Array(keptPos);
const scaleArr = new Float32Array(keptScale);
writeFileSync(join(dir, "visual-points.f32"), Buffer.from(posArr.buffer, posArr.byteOffset, posArr.byteLength));
writeFileSync(join(dir, "visual-scales.f32"), Buffer.from(scaleArr.buffer, scaleArr.byteOffset, scaleArr.byteLength));
console.log(`visual-points.f32: ${keptScale.length}/${numPoints} splat centers kept (alpha >= ${ALPHA_MIN})`);

if (!existsSync(join(dir, "metadata.json"))) {
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify(
      {
        worldId,
        source: "marble-app-export",
        ingestedAt: new Date().toISOString(),
        note: "app-lane ingest (API namespace cannot see app worlds); no vendor metric_scale_factor shipped — scale must be established by measurement",
      },
      null,
      2,
    ),
  );
  console.log("metadata.json written (no vendor scale factor — app export ships none)");
}
console.log(`\nbundle ready: ${dir}`);
console.log(`next: node bin/surveyor.mjs certify ${dir} --extended --min-grade F`);
