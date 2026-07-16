/**
 * validate-certificate.ts — rigorous validator for SURVEYOR certificate JSON.
 *
 * Usage: npx tsx scripts/validate-certificate.ts <path/to/certificate.json>
 * Exits 0 if every check passes; exits 1 and prints a numbered failure list otherwise.
 *
 * Checks:
 *  a. CertificateSchema.parse succeeds (schema validity)
 *  b. Grade arithmetic recomputed from OPEN defects matches certificate.grade
 *     (capped "evidence-tiered" formula when gradeRationale says so)
 *  c. Trust consistency: non-negative integer counts; verifiedPct/lyingPct match counts
 *  d. Defect sanity: region min<=max, confidence in [0,1], severity enum,
 *     non-empty evidence, unique ids
 *  e. Measurements: uncertainty.low <= uncertainty.high everywhere a
 *     Measurement appears (top-level, defect evidence, verdicts, scale.estimated,
 *     extendedChecks)
 *  f. Verdicts: defectIds reference existing defects; pass is boolean | "not_evaluated"
 *  g. probeStats: non-negative integers; rested + fellThrough + tunnelingExcluded <= dropped
 *  h. extendedChecks (if present): settling accounting, reachability bounds,
 *     floater pointSharePct in [0,100]
 */
import { readFileSync } from "node:fs";
import { CertificateSchema, type Certificate, type Measurement } from "../src/core/types.js";

const failures: string[] = [];
function fail(check: string, msg: string): void {
  failures.push(`[${check}] ${msg}`);
}

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/validate-certificate.ts <certificate.json>");
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`FAIL: cannot read/parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// ------------------------------------------------------------ a. schema
const parsed = CertificateSchema.safeParse(raw);
if (!parsed.success) {
  for (const issue of parsed.error.issues.slice(0, 20)) {
    fail("a", `schema: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  const extra = parsed.error.issues.length - 20;
  if (extra > 0) fail("a", `schema: ...and ${extra} more issues`);
  // Schema failure makes the structural checks below unreliable — report and exit.
  report();
}
const cert: Certificate = parsed.success ? parsed.data : (raw as Certificate);

// ------------------------------------------------- b. grade arithmetic
{
  const open = cert.defects.filter((d) => !d.outcome || d.outcome === "escalated");
  const critical = open.filter((d) => d.severity === "critical").length;
  const major = open.filter((d) => d.severity === "major").length;
  const minor = open.filter((d) => d.severity === "minor").length;
  const tiered = cert.gradeRationale.includes("evidence-tiered");
  const score = tiered
    ? 100 - 40 * critical - Math.min(45, 15 * major) - Math.min(15, 5 * minor)
    : 100 - 40 * critical - 15 * major - 5 * minor;
  const expected = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  if (cert.grade !== expected) {
    fail(
      "b",
      `grade mismatch: certificate says ${cert.grade}, recomputed ${expected} ` +
        `(${critical} critical, ${major} major, ${minor} minor open; score ${score}; ` +
        `${tiered ? "evidence-tiered capped" : "linear"} formula)`,
    );
  }
}

// ----------------------------------------------- c. trust consistency
{
  const c = cert.trust.counts;
  for (const [k, v] of Object.entries(c)) {
    if (!Number.isInteger(v) || v < 0) fail("c", `trust.counts.${k} is not a non-negative integer: ${v}`);
  }
  const known = c.verified + c.observed + c.lying;
  const expVerified = known > 0 ? (100 * c.verified) / known : 0;
  const expLying = known > 0 ? (100 * c.lying) / known : 0;
  if (Math.abs(cert.trust.verifiedPct - expVerified) > 0.1) {
    fail("c", `verifiedPct ${cert.trust.verifiedPct} != expected ${expVerified.toFixed(4)} (tolerance 0.1)`);
  }
  if (Math.abs(cert.trust.lyingPct - expLying) > 0.1) {
    fail("c", `lyingPct ${cert.trust.lyingPct} != expected ${expLying.toFixed(4)} (tolerance 0.1)`);
  }
}

// --------------------------------------------------- d. defect sanity
{
  const ids = new Set<string>();
  const severities = new Set(["critical", "major", "minor"]);
  for (const d of cert.defects) {
    for (let i = 0; i < 3; i++) {
      if (!(d.region.min[i] <= d.region.max[i])) {
        fail("d", `defect ${d.id}: region.min[${i}]=${d.region.min[i]} > region.max[${i}]=${d.region.max[i]}`);
      }
    }
    if (!(d.confidence >= 0 && d.confidence <= 1)) fail("d", `defect ${d.id}: confidence ${d.confidence} outside [0,1]`);
    if (!severities.has(d.severity)) fail("d", `defect ${d.id}: invalid severity "${d.severity}"`);
    if (!Array.isArray(d.evidence) || d.evidence.length === 0) fail("d", `defect ${d.id}: evidence array empty`);
    if (ids.has(d.id)) fail("d", `duplicate defect id: ${d.id}`);
    ids.add(d.id);
  }
}

// --------------------------------------------------- e. measurements
{
  const checkM = (m: Measurement | undefined, where: string): void => {
    if (!m) return;
    if (!(m.uncertainty.low <= m.uncertainty.high)) {
      fail("e", `${where} ("${m.name}"): uncertainty.low ${m.uncertainty.low} > high ${m.uncertainty.high}`);
    }
  };
  cert.measurements.forEach((m, i) => checkM(m, `measurements[${i}]`));
  cert.defects.forEach((d) => d.evidence.forEach((ev, i) => checkM(ev.measurement, `defect ${d.id} evidence[${i}]`)));
  cert.robotVerdicts.forEach((v, i) => checkM(v.measured, `robotVerdicts[${i}] (${v.robotId}/${v.check})`));
  checkM(cert.scale.estimated, "scale.estimated");
  const x = cert.extendedChecks;
  if (x) {
    checkM(x.levelAudit.tilt, "extendedChecks.levelAudit.tilt");
    checkM(x.levelAudit.planarityRms, "extendedChecks.levelAudit.planarityRms");
    checkM(x.floaters.measurement, "extendedChecks.floaters.measurement");
    x.scaleConsensus.witnesses.forEach((m, i) => checkM(m, `extendedChecks.scaleConsensus.witnesses[${i}]`));
    checkM(x.settling.maxDriftM, "extendedChecks.settling.maxDriftM");
    checkM(x.reachability.fractionPct, "extendedChecks.reachability.fractionPct");
  }
}

// ------------------------------------------------------- f. verdicts
{
  const ids = new Set(cert.defects.map((d) => d.id));
  cert.robotVerdicts.forEach((v, i) => {
    if (!(typeof v.pass === "boolean" || v.pass === "not_evaluated")) {
      fail("f", `robotVerdicts[${i}] (${v.robotId}/${v.check}): pass is ${JSON.stringify(v.pass)}`);
    }
    for (const id of v.defectIds) {
      if (!ids.has(id)) fail("f", `robotVerdicts[${i}] (${v.robotId}/${v.check}): references missing defect id "${id}"`);
    }
  });
}

// ------------------------------------------------------ g. probeStats
{
  const p = cert.probeStats;
  for (const k of ["probesDropped", "probesRested", "probesFellThrough", "tunnelingArtifactsExcluded", "simSteps"] as const) {
    if (!Number.isInteger(p[k]) || p[k] < 0) fail("g", `probeStats.${k} is not a non-negative integer: ${p[k]}`);
  }
  const accounted = p.probesRested + p.probesFellThrough + p.tunnelingArtifactsExcluded;
  if (accounted > p.probesDropped) {
    fail(
      "g",
      `probeStats accounting: rested ${p.probesRested} + fellThrough ${p.probesFellThrough} + ` +
        `tunnelingExcluded ${p.tunnelingArtifactsExcluded} = ${accounted} > dropped ${p.probesDropped}`,
    );
  }
}

// -------------------------------------------------- h. extendedChecks
if (cert.extendedChecks) {
  const x = cert.extendedChecks;
  const s = x.settling;
  const sum = s.stable + s.jitter + s.ejected + s.fellThrough + s.leftWorld;
  if (sum !== s.boxes) {
    fail(
      "h",
      `settling accounting: stable ${s.stable} + jitter ${s.jitter} + ejected ${s.ejected} + ` +
        `fellThrough ${s.fellThrough} + leftWorld ${s.leftWorld} = ${sum} != boxes ${s.boxes}`,
    );
  }
  if (x.reachability.reachableCells > x.reachability.visualFloorCells) {
    fail(
      "h",
      `reachability: reachableCells ${x.reachability.reachableCells} > visualFloorCells ${x.reachability.visualFloorCells}`,
    );
  }
  if (!(x.floaters.pointSharePct >= 0 && x.floaters.pointSharePct <= 100)) {
    fail("h", `floaters.pointSharePct ${x.floaters.pointSharePct} outside [0,100]`);
  }
}

report();

function report(): never {
  if (failures.length === 0) {
    console.log(`PASS: ${path} — all checks passed (a-h)`);
    process.exit(0);
  }
  console.error(`FAIL: ${path} — ${failures.length} check failure(s):`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  process.exit(1);
}
