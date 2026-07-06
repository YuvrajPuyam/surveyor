/**
 * `surveyor certify` — the preflight one-liner. Certify a bundle, print a
 * one-screen human summary, write certificate.json + report.html, and exit
 * with a CI-gateable code:
 *   0  certificate produced, grade at or above --min-grade
 *   3  certificate produced, grade BELOW --min-grade (gate failure, not a crash)
 *   1  error (unreadable bundle, survey crash)
 *   2  usage error
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { certifyWorld } from "../certify/certificate.js";
import { GRAVITY, type Grade } from "../core/types.js";
import { loadWorldBundle } from "../ingest/bundleIO.js";
import { certificateSha256, renderReportHtml } from "../report/reportHtml.js";

const GRADE_ORDER: Grade[] = ["F", "D", "C", "B", "A"];

/** Pure gate: exit code from (grade, minGrade) — unit-testable. */
export function gradeGateExitCode(grade: Grade, minGrade: Grade): 0 | 3 {
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(minGrade) ? 0 : 3;
}

export const CERTIFY_USAGE = `usage: surveyor certify <bundle-dir> [options]

options:
  --gravity earth|moon|mars   gravity for the survey (default earth)
  --probes N                  probe count (default 2000)
  --seed N                    survey seed (default 1234)
  --min-grade A|B|C|D|F       exit 3 if the grade lands below this (default D)
  --out <file>                write certificate JSON here (default <bundle>/certificate.json is NOT overwritten unless --write-bundle)
  --write-bundle              write certificate.json + report.html into the bundle dir
  --report <file>             write the self-contained HTML report here
  --no-report                 skip the HTML report
  --json                      print the full certificate JSON to stdout

exit codes: 0 pass · 3 below --min-grade · 1 error · 2 usage`;

export async function certifyMain(args: string[]): Promise<number> {
  const dir = args.find((a) => !a.startsWith("--"));
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i > -1 ? args[i + 1] : undefined;
  };
  const has = (name: string) => args.includes(`--${name}`);

  if (!dir) {
    console.error(CERTIFY_USAGE);
    return 2;
  }
  const gravityName = (flag("gravity") ?? "earth") as keyof typeof GRAVITY;
  if (!GRAVITY[gravityName]) {
    console.error(`unknown gravity "${gravityName}" — earth|moon|mars\n\n${CERTIFY_USAGE}`);
    return 2;
  }
  const minGrade = (flag("min-grade") ?? "D").toUpperCase() as Grade;
  if (!GRADE_ORDER.includes(minGrade)) {
    console.error(`unknown --min-grade "${minGrade}" — A|B|C|D|F\n\n${CERTIFY_USAGE}`);
    return 2;
  }
  const probes = flag("probes") ? parseInt(flag("probes")!, 10) : 2000;
  const seed = flag("seed") ? parseInt(flag("seed")!, 10) : 1234;

  let certificate;
  let elapsedS: string;
  try {
    const world = await loadWorldBundle(dir);
    console.log(`Certifying ${world.worldId} under ${gravityName} gravity (${probes} probes, seed ${seed})...`);
    const t0 = performance.now();
    ({ certificate } = await certifyWorld(
      {
        worldId: world.worldId,
        collider: world.collider,
        visualPoints: world.visualPoints,
        visualScales: world.visualScales,
        metadata: world.metadata,
      },
      { gravity: GRAVITY[gravityName], seed, survey: { probeCount: probes } },
    ));
    elapsedS = ((performance.now() - t0) / 1000).toFixed(1);
  } catch (err) {
    console.error(`certification failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const sha = certificateSha256(certificate);
  const t = certificate.trust;
  const known = t.counts.verified + t.counts.observed + t.counts.lying;
  const observedPct = known > 0 ? (100 * t.counts.observed) / known : 0;
  const open = certificate.defects.filter((d) => !d.outcome || d.outcome === "escalated");
  const bySeverity = (s: string) => open.filter((d) => d.severity === s).length;

  console.log(`\n  GRADE ${certificate.grade}  — ${certificate.gradeRationale.split(". ")[0]}.`);
  console.log(
    `  trust over ${known.toLocaleString()} surveyed cells: ` +
      `${t.verifiedPct.toFixed(1)}% confirmed · ${observedPct.toFixed(1)}% observed · ${t.lyingPct.toFixed(1)}% divergent`,
  );
  console.log(
    `  defects: ${open.length} open (${bySeverity("critical")} critical, ${bySeverity("major")} major, ${bySeverity("minor")} minor)` +
      `${certificate.defects.length !== open.length ? ` — ${certificate.defects.length - open.length} resolved/quarantined also listed` : ""}`,
  );
  for (const d of open.slice(0, 8)) {
    console.log(`    [${d.severity}] ${d.type} (confidence ${(100 * d.confidence).toFixed(0)}%)`);
  }
  if (open.length > 8) console.log(`    … and ${open.length - 8} more (see report)`);
  console.log(`  per-robot verdicts:`);
  for (const v of certificate.robotVerdicts) {
    const mark = v.pass === true ? "PASS" : v.pass === false ? "FAIL" : "n/a ";
    console.log(`    ${mark} ${v.robotId}/${v.check}${v.measured ? ` = ${v.measured.value.toFixed(2)} ${v.measured.unit}` : ""}`);
  }
  console.log(`  certificate sha256 ${sha}`);
  console.log(`  (${elapsedS} s)`);

  const outPath = flag("out") ?? (has("write-bundle") ? join(dir, "certificate.json") : undefined);
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(certificate, null, 2));
    console.log(`  certificate → ${outPath}`);
  }
  if (!has("no-report")) {
    const reportPath = flag("report") ?? (has("write-bundle") ? join(dir, "report.html") : outPath ? outPath.replace(/\.json$/i, "") + ".report.html" : undefined);
    if (reportPath) {
      writeFileSync(reportPath, renderReportHtml(certificate));
      console.log(`  report      → ${reportPath}`);
    }
  }
  if (has("json")) console.log(JSON.stringify(certificate, null, 2));

  return gradeGateExitCode(certificate.grade, minGrade);
}
