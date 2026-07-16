/**
 * Build the training-ready USD stage for a (fixed) Sojourner bundle —
 * artifact #1's Isaac-consumable form: collider with physics APIs, gravity
 * and friction from the certificate, certificate hash stamped in customData.
 *
 * Known caveat (project memory): the COMPOSED pack (usda + NuRec payload)
 * carries a ~0.5 m splat-vs-collider alignment offset — packaging-level,
 * fix pending (G8 gate). The .usda itself is deterministic and correct.
 *
 *   npx tsx scripts/sojourner-usd.ts <bundle-dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CertificateSchema } from "../src/core/types.js";
import { buildUsdaStage } from "../src/export/usdPack.js";
import { loadColliderGlb } from "../src/ingest/glb.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: npx tsx scripts/sojourner-usd.ts <bundle-dir>"); process.exit(2); }

const collider = await loadColliderGlb(join(dir, "collider.glb"));
const certificate = CertificateSchema.parse(JSON.parse(readFileSync(join(dir, "certificate.json"), "utf-8")));
const usda = buildUsdaStage({ collider, certificate, spawns: [], quarantine: [] });
const out = join(dir, "world.usda");
writeFileSync(out, usda);
console.log(`USD stage → ${out} (${(usda.length / 1e6).toFixed(1)} MB, grade ${certificate.grade}, ${collider.indices.length / 3} tris)`);
