/**
 * Human-readable Markdown certificate — written beside certificate.json on
 * every certify run that writes output. The JSON is the machine contract;
 * this is the page a human actually reads.
 *
 * Display vocabulary (non-negotiable): confirmed / observed / divergent —
 * the internal schema field `lyingPct` is a frozen name and never shown.
 * Defects are GROUPED by type: a 14,000-row list is noise, a table of
 * counts with plain-language meaning is a report.
 */
import type { Certificate, Defect, Measurement, Verdict } from "../core/types.js";

const DEFECT_MEANING: Record<string, { label: string; meaning: string }> = {
  collider_hole: {
    label: "collider hole",
    meaning: "visuals show a surface, physics has nothing — anything standing there falls through",
  },
  phantom_collider: {
    label: "phantom collider",
    meaning: "physics surface with no visual support — an invisible barrier, or geometry the camera never saw",
  },
  visual_only_surface: {
    label: "ghost geometry",
    meaning: "a visible surface (wall, rock, prop) with no collider behind it — you can walk straight through it",
  },
  scale_error: {
    label: "metric scale error",
    meaning: "the world's size disagrees with priors/vendor metadata — every trained policy inherits the wrong meters",
  },
  raised_sill: {
    label: "raised sill / step",
    meaning: "a step at a passage; whether it is passable depends on the robot (see per-robot verdicts)",
  },
  clearance_violation: {
    label: "clearance violation",
    meaning: "a passage narrower or lower than a robot's envelope requires",
  },
};

const fmt = (v: number, digits = 2) => Number(v.toFixed(digits)).toLocaleString("en-US");

function measurementLine(m: Measurement): string {
  return (
    `- **${m.name}** = ${fmt(m.value, 3)} ${m.unit}` +
    `  _(range ${fmt(m.uncertainty.low, 3)}…${fmt(m.uncertainty.high, 3)}${m.n ? `, n=${m.n}` : ""})_\n` +
    `  ↳ ${m.method}\n`
  );
}

function verdictRows(verdicts: Verdict[]): string {
  const mark = (v: Verdict) => (v.pass === true ? "PASS" : v.pass === false ? "**FAIL**" : "n/a");
  const rows = verdicts.map(
    (v) =>
      `| ${v.robotId} | ${v.check.replace(/_/g, " ")} | ${mark(v)} | ` +
      `${v.measured ? `${fmt(v.measured.value)} ${v.measured.unit}` : "—"} | ${v.requirement} |`,
  );
  return ["| robot | check | verdict | measured | requirement |", "|---|---|---|---|---|", ...rows].join("\n");
}

export function renderCertificateMd(cert: Certificate): string {
  const t = cert.trust;
  const known = t.counts.verified + t.counts.observed + t.counts.lying;
  const pct = (n: number) => (known > 0 ? ((100 * n) / known).toFixed(1) : "0.0");

  // ---- defects grouped by type & severity
  const open = cert.defects.filter((d) => !d.outcome || d.outcome === "escalated");
  const resolved = cert.defects.length - open.length;
  const groups = new Map<string, { severity: Defect["severity"]; count: number; confSum: number }>();
  for (const d of open) {
    const key = `${d.type}|${d.severity}`;
    const g = groups.get(key) ?? { severity: d.severity, count: 0, confSum: 0 };
    g.count++;
    g.confSum += d.confidence;
    groups.set(key, g);
  }
  const sevRank = { critical: 0, major: 1, minor: 2 } as const;
  const defectRows = [...groups.entries()]
    .sort((a, b) => sevRank[a[1].severity] - sevRank[b[1].severity] || b[1].count - a[1].count)
    .map(([key, g]) => {
      const type = key.split("|")[0];
      const info = DEFECT_MEANING[type] ?? { label: type, meaning: "" };
      return `| ${info.label} | ${g.severity} | ${g.count.toLocaleString("en-US")} | ${((100 * g.confSum) / g.count).toFixed(0)}% | ${info.meaning} |`;
    });

  const ext = cert.extendedChecks;

  const lines: string[] = [
    `# SURVEYOR CERTIFICATE`,
    ``,
    `**World** \`${cert.worldId}\``,
    ``,
    `# GRADE ${cert.grade}`,
    ``,
    `> ${cert.gradeRationale}`,
    ``,
    `| | |`,
    `|---|---|`,
    `| survey seed | ${cert.seed} |`,
    `| gravity | ${cert.gravity.name} (${cert.gravity.g} m/s²) |`,
    `| issued | ${cert.createdAt} |`,
    `| schema | ${cert.schemaVersion} |`,
    ``,
    `## Trust map — what the experiments actually touched`,
    ``,
    `Over **${known.toLocaleString("en-US")} surveyed cells** (${t.cellSizeM} m grid):`,
    ``,
    `- **${pct(t.counts.verified)}% confirmed** — a physical experiment (probe at rest or sustained rolling contact) agreed with the visual record`,
    `- **${pct(t.counts.observed)}% observed** — seen by the camera, never physically tested; no claim beyond appearance`,
    `- **${pct(t.counts.lying)}% divergent** — the visual and physical records DISAGREE beyond the vendor's own noise floor`,
    ``,
    `## Defects — ${open.length.toLocaleString("en-US")} open${resolved > 0 ? ` (${resolved.toLocaleString("en-US")} resolved/quarantined also on file)` : ""}`,
    ``,
    `| defect | severity | count | avg confidence | what it means |`,
    `|---|---|---|---|---|`,
    ...defectRows,
    ``,
    `## Per-robot verdicts — the same world, judged per body`,
    ``,
    verdictRows(cert.robotVerdicts),
    ``,
    `_Gravity sensitivity:_ ${
      cert.robotVerdicts
        .filter((v) => v.gravitySensitivity === "changes_with_gravity")
        .map((v) => v.check.replace(/_/g, " "))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ") || "none"
    } change with gravity; the rest are gravity-invariant.`,
    ``,
    `## Scale`,
    ``,
    `- vendor factor: ${cert.scale.vendorFactor !== undefined ? `${cert.scale.vendorFactor} (applied: ${cert.scale.vendorFactorApplied})` : "not shipped by vendor"}`,
    ...(cert.scale.estimated ? [measurementLine(cert.scale.estimated).trimEnd()] : []),
    ...(cert.scale.agreement ? [`- **agreement:** ${cert.scale.agreement}`] : []),
    ``,
    `## The experiment`,
    ``,
    `${cert.probeStats.probesDropped.toLocaleString("en-US")} seeded probes dropped · ` +
      `${cert.probeStats.probesRested.toLocaleString("en-US")} rested/rolled (surface confirmed) · ` +
      `${cert.probeStats.probesFellThrough.toLocaleString("en-US")} fell through · ` +
      `${cert.probeStats.tunnelingArtifactsExcluded.toLocaleString("en-US")} tunneling artifacts excluded by raycast cross-check`,
    ``,
    `${cert.probeStats.simSteps.toLocaleString("en-US")} deterministic steps at fixed dt ${cert.probeStats.fixedTimestep.toFixed(4)} s.`,
  ];

  if (ext) {
    lines.push(
      ``,
      `## Extended checks (informational — not graded)`,
      ``,
      `**Level audit**`,
      measurementLine(ext.levelAudit.tilt).trimEnd(),
      measurementLine(ext.levelAudit.planarityRms).trimEnd(),
      ``,
      `**Floaters** — ${ext.floaters.count.toLocaleString("en-US")} disconnected splat cluster(s), ${fmt(ext.floaters.pointSharePct)}% of points`,
      `  ↳ ${ext.floaters.measurement.method}`,
      ``,
      `**Scale consensus** — ${ext.scaleConsensus.agreement}`,
      ``,
      `**Settling** — ${ext.settling.verdict}`,
      ``,
      `**Reachability** — ${fmt(ext.reachability.fractionPct.value, 1)}% of visually-claimed floor physically reachable ` +
        `(${ext.reachability.reachableCells.toLocaleString("en-US")}/${ext.reachability.visualFloorCells.toLocaleString("en-US")} cells)`,
      `  ↳ ${ext.reachability.fractionPct.method}`,
    );
    if (ext.depthConsensus) {
      lines.push(
        ``,
        `**Depth consensus** — ${ext.depthConsensus.conclusive ? "conclusive" : "inconclusive"}: ` +
          `${ext.depthConsensus.cropsCalibrated} crops calibrated, Spearman ${fmt(ext.depthConsensus.consensusSpearman)}`,
        `  ↳ ${ext.depthConsensus.source}`,
      );
    }
  }

  lines.push(
    ``,
    `## Key measurements`,
    ``,
    ...cert.measurements.slice(0, 12).map((m) => measurementLine(m).trimEnd()),
    ...(cert.measurements.length > 12
      ? [`- _…and ${(cert.measurements.length - 12).toLocaleString("en-US")} more in certificate.json_`]
      : []),
    ``,
    `## Disclosures — the fine print that makes this honest`,
    ``,
    ...cert.disclosures.map((d) => `- ${d}`),
    ``,
    `---`,
    `_This report is a rendering of certificate.json; the JSON is the canonical, hashable artifact._`,
    ``,
  );

  return lines.join("\n");
}
