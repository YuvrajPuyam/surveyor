/**
 * Run the self-validation suite on the standard synthetic set and print the
 * precision/recall appendix. Usage: npm run self-validate [-- --probes 800] [-- --out file.json]
 * --out writes the SelfValidation summary JSON — the appendix the Certified
 * World Pack ships beside the certificate (ENDGAME §1).
 */
import { writeFileSync } from "node:fs";
import { standardValidationSet } from "../src/ingest/synthetic.js";
import { selfValidate } from "../src/validation/selfValidate.js";

const probesArg = process.argv.indexOf("--probes");
const probeCount = probesArg > -1 ? parseInt(process.argv[probesArg + 1], 10) : 2000;
const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : undefined;

const t0 = performance.now();
const worlds = standardValidationSet();
console.log(`Built ${worlds.length} synthetic worlds. Running certify on each (${probeCount} probes)...`);

const report = await selfValidate(worlds, { seed: 1234, survey: { probeCount } });

console.log("\n=== SELF-VALIDATION ===");
console.log(`worlds: ${report.summary.worldsTested}  planted: ${report.summary.plantedDefects}`);
console.log(
  `TP ${report.summary.truePositives}  FP ${report.summary.falsePositives}  FN ${report.summary.falseNegatives}`,
);
console.log(
  `recall    ${(report.summary.recall * 100).toFixed(1)}% (95% CI: >= ${(report.summary.recallCI95Low * 100).toFixed(1)}%, n=${report.summary.truePositives + report.summary.falseNegatives})`,
);
console.log(
  `precision ${(report.summary.precision * 100).toFixed(1)}% (95% CI: >= ${(report.summary.precisionCI95Low * 100).toFixed(1)}%, n=${report.summary.truePositives + report.summary.falsePositives})`,
);
console.log("");
for (const w of report.perWorld) {
  console.log(`- ${w.worldId}: grade ${w.grade}, ${w.matched}/${w.planted} found, ${w.falsePositives.length} FP`);
  for (const m of w.missed) console.log(`    MISSED: ${m.type} (${m.note})`);
  for (const f of w.falsePositives)
    console.log(
      `    FP: ${f.type} @ [${f.region.min.map((v) => v.toFixed(1)).join(",")}]..[${f.region.max.map((v) => v.toFixed(1)).join(",")}] — ${f.description.slice(0, 70)}`,
    );
}
if (outPath) {
  writeFileSync(outPath, JSON.stringify(report.summary, null, 2));
  console.log(`\nappendix → ${outPath}`);
}
console.log(`\nTotal time: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
