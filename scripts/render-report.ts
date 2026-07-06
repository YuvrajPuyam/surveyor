/**
 * Render the self-contained report.html from an existing certificate.json —
 * no re-survey. Validates the certificate against the schema first, so a
 * stale or hand-edited certificate fails loudly instead of rendering junk.
 * Usage: npx tsx scripts/render-report.ts <certificate.json> [--out report.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CertificateSchema } from "../src/core/types.js";
import { renderReportHtml } from "../src/report/reportHtml.js";

const args = process.argv.slice(2);
const certPath = args.find((a) => !a.startsWith("--"));
if (!certPath) {
  console.error("usage: npx tsx scripts/render-report.ts <certificate.json> [--out report.html]");
  process.exit(2);
}
const outIdx = args.indexOf("--out");
const outPath = outIdx > -1 ? args[outIdx + 1] : join(dirname(certPath), "report.html");

const certificate = CertificateSchema.parse(JSON.parse(readFileSync(certPath, "utf8")));
writeFileSync(outPath, renderReportHtml(certificate));
console.log(`report → ${outPath}`);
