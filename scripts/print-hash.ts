/** Print a certificate's content SHA-256 (the determinism-chip value). */
import { readFileSync } from "node:fs";
import { certificateSha256 } from "../src/report/reportHtml.js";
import { CertificateSchema } from "../src/core/types.js";

const p = process.argv[2];
if (!p) {
  console.error("usage: npx tsx scripts/print-hash.ts <certificate.json>");
  process.exit(2);
}
const cert = CertificateSchema.parse(JSON.parse(readFileSync(p, "utf8")));
console.log(`${certificateSha256(cert)}  ${cert.worldId} (grade ${cert.grade}, ${cert.defects.length} defects)`);
