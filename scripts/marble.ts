/**
 * Marble terminal client.
 *
 *   npx tsx scripts/marble.ts generate --prompt "space habitat interior" [--model marble-1.1] [--wait]
 *   npx tsx scripts/marble.ts pano --uri https://... [--model marble-1.1] [--wait]
 *   npx tsx scripts/marble.ts wait <operationId>
 *   npx tsx scripts/marble.ts get <worldId>
 *   npx tsx scripts/marble.ts download <worldId>
 *   npx tsx scripts/marble.ts gate-d1 [--model marble-1.1]   # generate → download → collider check → certify
 *
 * Auth: set MARBLE_API_KEY (or put MARBLE_API_KEY=... in a local .env file).
 * Every world lands in assets/marble/<worldId>/ with the RAW response saved —
 * the response shape (draft tiers, scale metadata) is exactly what Gate D1/D2
 * are meant to discover.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MarbleClient, operationIdOf, worldIdOf, type MarbleWorld } from "../src/ingest/marbleClient.js";
import type { WorldMetadata } from "../src/core/types.js";

// ---- minimal .env support (no dependency)
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

let _client: MarbleClient | null = null;
function client(): MarbleClient {
  if (!_client) _client = new MarbleClient(process.env.MARBLE_API_KEY ?? "");
  return _client;
}
const MARBLE_ROOT = join(process.cwd(), "assets", "marble");

/** Recursively find keys that look like scale / ground-plane metadata. */
function findMetadataKeys(obj: unknown, path = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (/scale|ground|up_axis|transform|metric/i.test(k) && typeof v !== "object") out[p] = v;
      findMetadataKeys(v, p, out);
    }
  }
  return out;
}

async function downloadWorld(world: MarbleWorld): Promise<string> {
  const worldId = worldIdOf(world);
  const dir = join(MARBLE_ROOT, worldId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "raw.json"), JSON.stringify(world, null, 2));

  const colliderUrl = world.assets?.mesh?.collider_mesh_url;
  const spzUrls = world.assets?.splats?.spz_urls ?? {};
  const panoUrl = world.assets?.imagery?.pano_url;

  console.log(`\n=== ${worldId} (${world.display_name ?? "unnamed"}) ===`);
  console.log(`collider shipped: ${colliderUrl ? "YES" : "NO  <-- Gate D1 answer"}`);
  console.log(`splat resolutions: ${Object.keys(spzUrls).join(", ") || "none"}`);
  console.log(`pano: ${panoUrl ? "yes" : "no"}`);

  if (colliderUrl) {
    writeFileSync(join(dir, "collider.glb"), await client().downloadAsset(colliderUrl));
    console.log(`collider.glb downloaded`);
  }
  const spzKey = spzUrls["100k"] ? "100k" : Object.keys(spzUrls)[0];
  if (spzKey) {
    const spzBuf = await client().downloadAsset(spzUrls[spzKey]);
    writeFileSync(join(dir, `splat-${spzKey}.spz`), spzBuf);
    console.log(`splat-${spzKey}.spz downloaded (${(spzBuf.length / 1e6).toFixed(1)} MB)`);
    // splat centers -> visual points for the divergence checks
    try {
      const { parseSpzPositions } = await import("../src/ingest/spz.js");
      const { positions, numPoints, alphas, maxScales } = parseSpzPositions(spzBuf);
      // low-alpha floaters are not surface claims — drop them at ingestion
      const ALPHA_MIN = 0.15;
      const keptPos: number[] = [];
      const keptScale: number[] = [];
      for (let i = 0; i < numPoints; i++) {
        if (alphas[i] < ALPHA_MIN) continue;
        keptPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        keptScale.push(maxScales[i]);
      }
      const posArr = new Float32Array(keptPos);
      const scaleArr = new Float32Array(keptScale);
      writeFileSync(join(dir, "visual-points.f32"), Buffer.from(posArr.buffer, posArr.byteOffset, posArr.byteLength));
      writeFileSync(join(dir, "visual-scales.f32"), Buffer.from(scaleArr.buffer, scaleArr.byteOffset, scaleArr.byteLength));
      console.log(`visual-points.f32: ${keptScale.length}/${numPoints} splat centers kept (alpha >= ${ALPHA_MIN}), scales saved`);
    } catch (e) {
      writeFileSync(join(dir, "visual-points.f32"), Buffer.alloc(0));
      console.log(`SPZ parse failed (${(e as Error).message.slice(0, 80)}) — wrote empty visual points; certify runs collider-only`);
    }
  } else {
    writeFileSync(join(dir, "visual-points.f32"), Buffer.alloc(0));
  }
  if (panoUrl) writeFileSync(join(dir, "pano.jpg"), await client().downloadAsset(panoUrl));

  const metaKeys = findMetadataKeys(world);
  console.log(`\nscale/ground metadata keys found in response:`);
  if (Object.keys(metaKeys).length === 0) console.log("  (none — check raw.json manually; Gate D2 input)");
  for (const [k, v] of Object.entries(metaKeys)) console.log(`  ${k} = ${JSON.stringify(v)}`);

  const scaleKey = Object.keys(metaKeys).find((k) => /metric_scale/i.test(k)) ?? Object.keys(metaKeys).find((k) => /scale/i.test(k));
  const groundKey = Object.keys(metaKeys).find((k) => /ground/i.test(k));
  const metadata: WorldMetadata = {
    worldId,
    source: "marble",
    metricScaleFactor: scaleKey && typeof metaKeys[scaleKey] === "number" ? (metaKeys[scaleKey] as number) : undefined,
    groundPlaneY: groundKey && typeof metaKeys[groundKey] === "number" ? (metaKeys[groundKey] as number) : undefined,
  };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));
  console.log(`\nbundle written to ${dir}`);
  console.log(`view in browser: ${world.world_marble_url ?? "(no url in response)"}`);
  return dir;
}

switch (cmd) {
  case "generate": {
    const prompt = flag("prompt");
    if (!prompt) throw new Error("--prompt required");
    const op = await client().generateFromText(prompt, { model: flag("model"), displayName: flag("name") });
    const opId = operationIdOf(op);
    console.log(`operation started: ${opId}`);
    if (has("wait")) {
      const world = await client().waitForOperation(opId, (s) => console.log(`  ...generating (${s.toFixed(0)} s)`));
      await downloadWorld(world);
    } else {
      console.log(`poll with: npx tsx scripts/marble.ts wait ${opId}`);
    }
    break;
  }
  case "pano": {
    const uri = flag("uri");
    if (!uri) throw new Error("--uri required (public URL of an equirectangular panorama)");
    const op = await client().generateFromImage({ uri }, { model: flag("model"), textPrompt: flag("prompt"), isPano: true });
    const opId = operationIdOf(op);
    console.log(`operation started: ${opId}`);
    if (has("wait")) {
      const world = await client().waitForOperation(opId, (s) => console.log(`  ...generating (${s.toFixed(0)} s)`));
      await downloadWorld(world);
    } else {
      console.log(`poll with: npx tsx scripts/marble.ts wait ${opId}`);
    }
    break;
  }
  case "wait": {
    const opId = args[1];
    if (!opId) throw new Error("usage: wait <operationId>");
    const world = await client().waitForOperation(opId, (s) => console.log(`  ...generating (${s.toFixed(0)} s)`));
    await downloadWorld(world);
    break;
  }
  case "get": {
    const worldId = args[1];
    if (!worldId) throw new Error("usage: get <worldId>");
    console.log(JSON.stringify(await client().getWorld(worldId), null, 2));
    break;
  }
  case "download": {
    const worldId = args[1];
    if (!worldId) throw new Error("usage: download <worldId>");
    await downloadWorld(await client().getWorld(worldId));
    break;
  }
  case "gate-d1": {
    // The Day-1 gate, end to end: generate a small test world, download it,
    // report whether it ships a collider, and run certify on it if so.
    const model = flag("model") ?? "marble-1.1";
    const prompt =
      flag("prompt") ??
      "small space habitat interior, two rooms connected by a doorway with a raised metal sill at the threshold, industrial floor";
    console.log(`GATE D1: generating with model=${model}...`);
    const op = await client().generateFromText(prompt, { model, displayName: `gate-d1 ${model}` });
    const opId = operationIdOf(op);
    console.log(`operation: ${opId} (recoverable via 'wait ${opId}' or 'list' if this run dies)`);
    const world = await client().waitForOperation(opId, (s) => console.log(`  ...generating (${s.toFixed(0)} s)`));
    const dir = await downloadWorld(world);
    if (world.assets?.mesh?.collider_mesh_url) {
      console.log(`\nGATE D1 PASS for ${model} — collider shipped. Now certify it:`);
      console.log(`  npm run certify -- ${dir} --probes 2000`);
    } else {
      console.log(`\nGATE D1 FAIL for ${model} — no collider in response. Per the kill table: dev on standard tier.`);
    }
    break;
  }
  case "list": {
    const { worlds } = await client().listWorlds();
    for (const w of worlds) {
      console.log(`${worldIdOf(w)}  ${w.model ?? "?"}  collider=${w.assets?.mesh?.collider_mesh_url ? "yes" : "NO"}  ${w.display_name ?? ""}`);
    }
    if (worlds.length === 0) console.log("(no worlds yet)");
    break;
  }
  default:
    console.log("commands: list | generate --prompt <p> [--model m] [--name n] [--wait] | pano --uri <u> [--wait] | wait <opId> | get <worldId> | download <worldId> | gate-d1 [--model m]");
}
