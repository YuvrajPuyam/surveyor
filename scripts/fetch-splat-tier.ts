/**
 * Fetch ONE additional splat tier into an existing frozen bundle — additive
 * only. Writes `splat-<tier>.spz` and touches NOTHING else (no raw.json, no
 * visual-points.f32 regeneration), so canonical certificate hashes survive.
 * Downloading assets of an existing world costs no credits.
 *
 *   npx tsx scripts/fetch-splat-tier.ts <worldId> <tier>   # tier: 500k | full
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MarbleClient } from "../src/ingest/marbleClient.js";

// minimal .env support, same as marble.ts
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

const [worldId, tier] = process.argv.slice(2);
if (!worldId || !tier) {
  console.error("usage: npx tsx scripts/fetch-splat-tier.ts <worldId> <tier>");
  process.exit(2);
}
const dir = join(process.cwd(), "assets", "marble", worldId);
if (!existsSync(join(dir, "collider.glb"))) {
  console.error(`no bundle at ${dir} — download the world first`);
  process.exit(2);
}
const out = join(dir, `splat-${tier}.spz`);
if (existsSync(out)) {
  console.log(`already present: ${out}`);
  process.exit(0);
}

const client = new MarbleClient(process.env.MARBLE_API_KEY ?? "");
const world = await client.getWorld(worldId);
const spzUrls = (world as { assets?: { splats?: { spz_urls?: Record<string, string> } } }).assets
  ?.splats?.spz_urls ?? {};
const url = spzUrls[tier];
if (!url) {
  console.error(`tier '${tier}' not offered; available: ${Object.keys(spzUrls).join(", ")}`);
  process.exit(1);
}
const buf = await client.downloadAsset(url);
writeFileSync(out, buf);
console.log(`splat-${tier}.spz written (${(buf.length / 1e6).toFixed(1)} MB) — bundle otherwise untouched`);
