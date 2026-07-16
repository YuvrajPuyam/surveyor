/**
 * Render the human-readable certificate.md from an EXISTING certificate.json
 * — no re-survey. Useful for bundles certified before the .md renderer
 * existed, or after hand-inspecting a saved certificate.
 *
 *   npx tsx scripts/cert-md.ts <bundle-dir | certificate.json>
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CertificateSchema } from "../src/core/types.js";
import { renderCertificateMd } from "../src/report/certificateMd.js";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npx tsx scripts/cert-md.ts <bundle-dir | certificate.json>");
  process.exit(2);
}
const jsonPath = existsSync(arg) && statSync(arg).isDirectory() ? join(arg, "certificate.json") : arg;
if (!existsSync(jsonPath)) {
  console.error(`no certificate found at ${jsonPath} — certify the bundle first`);
  process.exit(2);
}
const cert = CertificateSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
const mdPath = jsonPath.replace(/\.json$/i, "") + ".md";
writeFileSync(mdPath, renderCertificateMd(cert));
console.log(`readable certificate → ${mdPath}`);
