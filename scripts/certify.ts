/**
 * Certify a world bundle from the command line.
 * Usage: npm run certify -- assets/generated/syn-kitchen-sink [--gravity mars] [--probes 2000] [--out cert.json]
 */
import { writeFileSync } from "node:fs";
import { certifyWorld } from "../src/certify/certificate.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { GRAVITY } from "../src/core/types.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npm run certify -- <bundle-dir> [--gravity earth|moon|mars] [--probes N] [--out file]");
  process.exit(1);
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};

const gravityName = (flag("gravity") ?? "earth") as keyof typeof GRAVITY;
const probes = flag("probes") ? parseInt(flag("probes")!, 10) : 2000;

const world = await loadWorldBundle(dir);
console.log(`Certifying ${world.worldId} under ${gravityName} gravity (${probes} probes)...`);
const t0 = performance.now();
const { certificate } = await certifyWorld(
  { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints, metadata: world.metadata },
  { gravity: GRAVITY[gravityName], survey: { probeCount: probes } },
);
const dt = ((performance.now() - t0) / 1000).toFixed(1);

console.log(`\nGRADE ${certificate.grade} — ${certificate.gradeRationale}`);
console.log(`trust: ${certificate.trust.verifiedPct.toFixed(1)}% confirmed, ${certificate.trust.lyingPct.toFixed(1)}% divergent`);
console.log(`defects: ${certificate.defects.length}`);
for (const d of certificate.defects) console.log(`  [${d.severity}] ${d.type} (conf ${d.confidence.toFixed(2)}): ${d.description.slice(0, 100)}`);
console.log(`\nper-robot verdicts:`);
for (const v of certificate.robotVerdicts) {
  const mark = v.pass === true ? "PASS" : v.pass === false ? "FAIL" : "n/a ";
  console.log(`  ${mark} ${v.robotId}/${v.check}${v.measured ? ` = ${v.measured.value.toFixed(2)} ${v.measured.unit}` : ""}`);
  if (v.gravitySensitivity !== "changes_with_gravity") console.log(`        ${v.gravityNote.split(":")[0]}`);
}
console.log(`\n(${dt} s)`);

const out = flag("out");
if (out) {
  writeFileSync(out, JSON.stringify(certificate, null, 2));
  console.log(`certificate written to ${out}`);
}
