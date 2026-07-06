/**
 * Self-contained HTML certificate report — the artifact "Ken" opens after
 * `npx surveyor certify`. One file, zero external requests, printable.
 *
 * Display vocabulary (non-negotiable): confirmed / observed / divergent —
 * the internal schema field `lyingPct` is a frozen name and never shown.
 * The methods lines under every number ARE the product; render them
 * prominently, not as footnotes.
 */
import { createHash } from "node:crypto";
import type { Certificate, Defect, Measurement } from "../core/types.js";

const DEFECT_LABELS: Record<Defect["type"], string> = {
  collider_hole: "collider hole",
  phantom_collider: "phantom collider (invisible barrier)",
  visual_only_surface: "ghost geometry (visual-only surface)",
  scale_error: "metric scale error",
  raised_sill: "raised sill / step",
  clearance_violation: "clearance violation",
  frame_mismatch: "frame mismatch",
  local_scale_error: "local scale error",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRADE_COLORS: Record<string, string> = {
  A: "#3fb950",
  B: "#8fd15f",
  C: "#d4a72c",
  D: "#e8853a",
  F: "#f85149",
};

function measurementRow(m: Measurement): string {
  const unc = `${m.uncertainty.low.toFixed(3)} … ${m.uncertainty.high.toFixed(3)} ${esc(m.unit)}`;
  return `<tr>
    <td class="name">${esc(m.name)}</td>
    <td class="num">${m.value.toFixed(3)} ${esc(m.unit)}</td>
    <td class="num">${unc}</td>
    <td class="num">${m.n ?? ""}</td>
  </tr>
  <tr class="method"><td colspan="4">↳ ${esc(m.method)} <span class="basis">(uncertainty: ${esc(m.uncertainty.basis)})</span></td></tr>`;
}

function defectRow(d: Defect): string {
  const ev = d.evidence
    .map((e) => `${esc(e.kind)}${e.count !== undefined ? ` ×${e.count}` : ""}`)
    .join(", ");
  const outcome = d.outcome ? `<span class="chip outcome-${d.outcome}">${d.outcome}</span>` : "";
  return `<tr class="sev-${d.severity}">
    <td class="mono">${esc(d.id)}</td>
    <td>${esc(DEFECT_LABELS[d.type] ?? d.type)}</td>
    <td class="sev">${d.severity}</td>
    <td class="num">${(100 * d.confidence).toFixed(0)}%</td>
    <td>${ev} ${outcome}</td>
  </tr>
  <tr class="method"><td colspan="5">↳ ${esc(d.description)}</td></tr>`;
}

/**
 * Content hash of a certificate: SHA-256 over the JSON with `createdAt`
 * normalized out. The demo claim is "re-run the survey live and the hash
 * matches the one pre-printed on the Devpost" — that is a claim about the
 * MEASUREMENT being deterministic for (worldId, seed, gravity), and the
 * injected wall-clock is not part of the measurement.
 */
export function certificateSha256(certificate: Certificate): string {
  return createHash("sha256").update(JSON.stringify({ ...certificate, createdAt: "" })).digest("hex");
}

export function renderReportHtml(certificate: Certificate, opts: { version?: string } = {}): string {
  const c = certificate;
  const sha = certificateSha256(c);
  const t = c.trust;
  const known = t.counts.verified + t.counts.observed + t.counts.lying;
  const observedPct = known > 0 ? (100 * t.counts.observed) / known : 0;
  const open = c.defects.filter((d) => !d.outcome || d.outcome === "escalated");
  const gradeColor = GRADE_COLORS[c.grade] ?? "#8b949e";
  const verdictRows = c.robotVerdicts
    .map((v) => {
      const mark = v.pass === true ? "PASS" : v.pass === false ? "FAIL" : "not evaluated";
      const cls = v.pass === true ? "pass" : v.pass === false ? "fail" : "na";
      return `<tr class="${cls}">
        <td>${esc(v.robotId)}</td><td>${esc(v.check)}</td><td class="v-${cls}">${mark}</td>
        <td class="num">${v.measured ? `${v.measured.value.toFixed(2)} ${esc(v.measured.unit)}` : ""}</td>
        <td>${esc(v.requirement)}</td>
      </tr>
      <tr class="method"><td colspan="5">↳ ${esc(v.gravityNote)}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SURVEYOR certificate — ${esc(c.worldId)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem clamp(1rem, 6vw, 4rem); background: #0d1117; color: #c9d1d9;
         font: 15px/1.55 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .grade { font-size: 4.5rem; font-weight: 800; line-height: 1; color: ${gradeColor};
           border: 3px solid ${gradeColor}; border-radius: 12px; padding: .5rem 1.4rem; }
  h1 { font-size: 1.3rem; margin: 0; } h2 { font-size: 1.05rem; margin: 2.2rem 0 .6rem; color: #e6edf3;
       border-bottom: 1px solid #21262d; padding-bottom: .3rem; }
  .sub { color: #8b949e; font-size: .85rem; }
  .mono, .num, td.num { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  td, th { text-align: left; padding: .3rem .6rem; vertical-align: top; }
  th { color: #8b949e; font-weight: 600; border-bottom: 1px solid #30363d; }
  tr.method td { color: #8b949e; font-size: .8rem; padding-top: 0; padding-bottom: .55rem; border-bottom: 1px solid #161b22; }
  .basis { color: #6e7681; }
  .trust { display: flex; gap: .6rem; flex-wrap: wrap; margin: .6rem 0; }
  .trust .cellbox { border-radius: 8px; padding: .7rem 1rem; min-width: 10rem; border: 1px solid #30363d; }
  .trust .pct { font-size: 1.6rem; font-weight: 700; font-family: ui-monospace, Consolas, monospace; }
  .confirmed .pct { color: #3fb950; } .observed .pct { color: #d4a72c; } .divergent .pct { color: #f85149; }
  .sev { text-transform: uppercase; font-size: .75rem; letter-spacing: .04em; }
  tr.sev-critical .sev { color: #f85149; } tr.sev-major .sev { color: #e8853a; } tr.sev-minor .sev { color: #d4a72c; }
  td.v-pass { color: #3fb950; font-weight: 700; } td.v-fail { color: #f85149; font-weight: 700; } td.v-na { color: #8b949e; }
  .chip { border: 1px solid #30363d; border-radius: 999px; padding: 0 .5rem; font-size: .75rem; }
  ul.disclosures li { margin-bottom: .5rem; font-size: .85rem; }
  .rationale { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: .8rem 1rem; font-size: .9rem; }
  footer { margin-top: 3rem; color: #6e7681; font-size: .78rem; border-top: 1px solid #21262d; padding-top: .8rem; }
  .hash { word-break: break-all; }
  @media print { body { background: #fff; color: #111; } }
</style>
</head>
<body>
<header>
  <div class="grade">${c.grade}</div>
  <div>
    <h1>SURVEYOR physics certificate</h1>
    <div class="sub mono">world ${esc(c.worldId)} · seed ${c.seed} · ${esc(c.gravity.name)} gravity (${c.gravity.g} m/s²) · ${esc(c.createdAt)}</div>
    <div class="sub">schema ${esc(c.schemaVersion)} · ${open.length} open defect(s) of ${c.defects.length} recorded</div>
  </div>
</header>

<div class="rationale">${esc(c.gradeRationale)}</div>

<h2>Trust map — what was physically checked</h2>
<div class="sub">Denominator: ${known.toLocaleString()} surveyed cells (${t.cellSizeM} m grid, ${t.cols}×${t.rows}); cells outside the surveyed area are counted in none of these.</div>
<div class="trust">
  <div class="cellbox confirmed"><div class="pct">${t.verifiedPct.toFixed(1)}%</div>confirmed — a physics experiment touched it<br><span class="sub mono">${t.counts.verified.toLocaleString()} cells</span></div>
  <div class="cellbox observed"><div class="pct">${observedPct.toFixed(1)}%</div>observed — visual/ray data only<br><span class="sub mono">${t.counts.observed.toLocaleString()} cells</span></div>
  <div class="cellbox divergent"><div class="pct">${t.lyingPct.toFixed(1)}%</div>divergent — visuals and physics disagree<br><span class="sub mono">${t.counts.lying.toLocaleString()} cells</span></div>
</div>

<h2>Defects (${c.defects.length})</h2>
<table>
  <tr><th>id</th><th>type</th><th>severity</th><th>confidence</th><th>evidence</th></tr>
  ${c.defects.map(defectRow).join("\n")}
</table>

<h2>Per-robot verdicts</h2>
<table>
  <tr><th>robot</th><th>check</th><th>verdict</th><th>measured</th><th>requirement</th></tr>
  ${verdictRows}
</table>

<h2>Measurements — every number carries its uncertainty and method</h2>
<table>
  <tr><th>measurement</th><th>value</th><th>uncertainty (2σ range)</th><th>n</th></tr>
  ${c.measurements.map(measurementRow).join("\n")}
</table>

<h2>Probe experiment</h2>
<table>
  <tr><th>dropped</th><th>rested</th><th>fell through (confirmed)</th><th>tunneling excluded</th><th>sim steps</th><th>timestep</th></tr>
  <tr class="mono"><td>${c.probeStats.probesDropped}</td><td>${c.probeStats.probesRested}</td><td>${c.probeStats.probesFellThrough}</td><td>${c.probeStats.tunnelingArtifactsExcluded}</td><td>${c.probeStats.simSteps}</td><td>${c.probeStats.fixedTimestep.toFixed(4)} s</td></tr>
</table>

<h2>Scale</h2>
<div class="sub">vendor factor ${c.scale.vendorFactor ?? "n/a"} · applied: ${c.scale.vendorFactorApplied} ${c.scale.agreement ? `· ${esc(c.scale.agreement)}` : ""}</div>

${
  c.selfValidation
    ? `<h2>Self-validation appendix</h2>
<div class="sub">${c.selfValidation.worldsTested} worlds, ${c.selfValidation.plantedDefects} planted defects — recall ${(100 * c.selfValidation.recall).toFixed(1)}% (95% CI ≥ ${(100 * c.selfValidation.recallCI95Low).toFixed(1)}%), precision ${(100 * c.selfValidation.precision).toFixed(1)}% (95% CI ≥ ${(100 * c.selfValidation.precisionCI95Low).toFixed(1)}%)</div>`
    : ""
}

<h2>Disclosures — scope, limits, and how to read this document</h2>
<ul class="disclosures">
  ${c.disclosures.map((d) => `<li>${esc(d)}</li>`).join("\n")}
</ul>

<footer>
  certificate content SHA-256 <span class="hash mono">${sha}</span> <span class="sub">(timestamp normalized out — stable across re-runs of the same survey)</span><br>
  generated by surveyor v${esc(opts.version ?? "0.1.0")} — deterministic for (worldId, seed, gravity); re-run to reproduce
</footer>
</body>
</html>`;
}
