/**
 * Certificate panel — plain-DOM rendering of a certificate summary
 * (summarizeCertificate shape from src/agent/tools.ts, or the raw
 * certificate.json — both are accepted).
 *
 * Quality bar: the certificate is the product. Every number is shown with
 * its [low..high] range and its methods line VERBATIM. Verdict pairs where
 * the same check fails one robot and passes another (rover-FAIL /
 * quadruped-PASS) are contrast-highlighted — "sim-readiness is relative to
 * the robot".
 */
import "./panels.css";
import type { CertificateSummary, DefectSummary, MeasurementLike, VerdictSummary } from "./protocol";

export interface CertificatePanelHandle {
  el: HTMLElement;
  update(cert: CertificateSummary): void;
  destroy(): void;
}

// ------------------------------------------------------------ DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function num(v: number): string {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toFixed(d);
}

function rangeOf(m: MeasurementLike): [number, number] | undefined {
  if (m.uncertainty) return [m.uncertainty.low, m.uncertainty.high];
  if (m.range && m.range.length >= 2) {
    const lo = m.range[0];
    const hi = m.range[1];
    if (lo !== undefined && hi !== undefined) return [lo, hi];
  }
  return undefined;
}

/** "0.30 m [0.20..0.40]" */
function fmtMeasurement(m: MeasurementLike): string {
  const r = rangeOf(m);
  const base = `${num(m.value)} ${m.unit}`;
  return r ? `${base}  [${num(r[0])}..${num(r[1])}]` : base;
}

function outcomeOf(d: DefectSummary): string {
  return d.outcome && d.outcome !== "OPEN" ? d.outcome : "OPEN";
}

// ---------------------------------------------------------------- section

function section(title: string, hint?: string): { root: HTMLElement; body: HTMLElement } {
  const root = el("section", "sv-section");
  const h = el("div", "sv-section-title", title);
  if (hint) h.appendChild(el("span", "sv-section-hint", hint));
  root.appendChild(h);
  const body = el("div", "sv-section-body");
  root.appendChild(body);
  return { root, body };
}

// ----------------------------------------------------------------- render

function renderHeader(cert: CertificateSummary): HTMLElement {
  const head = el("div", "sv-cert-head");

  const left = el("div", "sv-cert-head-left");
  left.appendChild(el("div", "sv-cert-title", "PHYSICS CERTIFICATE"));
  const gravity = typeof cert.gravity === "string" ? cert.gravity : cert.gravity?.name;
  left.appendChild(
    el("div", "sv-cert-world", `${cert.worldId}${gravity ? `  ·  gravity: ${gravity}` : ""}`),
  );
  head.appendChild(left);

  const badge = el("div", `sv-grade sv-grade-${cert.grade}`, cert.grade);
  badge.title = cert.gradeRationale ?? "";
  head.appendChild(badge);

  return head;
}

function renderTrust(cert: CertificateSummary): HTMLElement {
  const { root, body } = section("TRUST");
  const row = el("div", "sv-trust-row");

  const mk = (cls: string, label: string, pct: number) => {
    const chip = el("div", `sv-trust-chip ${cls}`);
    chip.appendChild(el("div", "sv-trust-pct", `${pct.toFixed(1)}%`));
    chip.appendChild(el("div", "sv-trust-label", label));
    return chip;
  };
  row.appendChild(mk("sv-trust-verified", "verified", cert.trust.verifiedPct));
  row.appendChild(mk("sv-trust-lying", "lying", cert.trust.lyingPct));
  body.appendChild(row);

  // proportional bar: verified green, lying red, remainder dim (observed/unknown)
  const bar = el("div", "sv-trust-bar");
  const v = el("div", "sv-trust-bar-verified");
  v.style.width = `${Math.max(0, Math.min(100, cert.trust.verifiedPct))}%`;
  const l = el("div", "sv-trust-bar-lying");
  l.style.width = `${Math.max(0, Math.min(100, cert.trust.lyingPct))}%`;
  bar.appendChild(v);
  bar.appendChild(l);
  body.appendChild(bar);

  if (cert.gradeRationale) body.appendChild(el("div", "sv-rationale", cert.gradeRationale));
  return root;
}

function robotOf(v: VerdictSummary): string {
  return v.robot ?? v.robotId ?? "?";
}

function renderVerdicts(cert: CertificateSummary): HTMLElement {
  const { root, body } = section("ROBOT VERDICTS", "per-robot, per-check");

  // Group by check so a rover-FAIL / quadruped-PASS split is visible as a pair.
  const groups = new Map<string, VerdictSummary[]>();
  for (const v of cert.robotVerdicts) {
    const list = groups.get(v.check);
    if (list) list.push(v);
    else groups.set(v.check, [v]);
  }

  for (const [check, verdicts] of groups) {
    const hasFail = verdicts.some((v) => v.pass === false);
    const hasPass = verdicts.some((v) => v.pass === true);
    const contrast = hasFail && hasPass;

    const group = el("div", `sv-verdict-group${contrast ? " sv-verdict-contrast" : ""}`);
    const gh = el("div", "sv-verdict-check", check.replace(/_/g, " "));
    if (contrast) gh.appendChild(el("span", "sv-contrast-tag", "same world · two verdicts"));
    group.appendChild(gh);

    for (const v of verdicts) {
      const passCls =
        v.pass === true ? "sv-pass" : v.pass === false ? "sv-fail" : "sv-noteval";
      const row = el(
        "div",
        `sv-verdict-row ${passCls}${contrast ? (v.pass === true ? " sv-contrast-pass" : v.pass === false ? " sv-contrast-fail" : "") : ""}`,
      );

      const top = el("div", "sv-verdict-top");
      top.appendChild(el("span", "sv-verdict-robot", robotOf(v)));
      top.appendChild(
        el(
          "span",
          `sv-verdict-chip ${passCls}`,
          v.pass === true ? "PASS" : v.pass === false ? "FAIL" : "NOT EVALUATED",
        ),
      );
      if (v.measured) top.appendChild(el("span", "sv-verdict-measured", fmtMeasurement(v.measured)));
      row.appendChild(top);

      row.appendChild(el("div", "sv-verdict-req", `requires: ${v.requirement}`));
      if (v.measured?.method) row.appendChild(el("div", "sv-method", v.measured.method));
      if (v.gravityNote) row.appendChild(el("div", "sv-gravity-note", v.gravityNote));
      group.appendChild(row);
    }
    body.appendChild(group);
  }
  return root;
}

function renderDefects(cert: CertificateSummary): HTMLElement {
  const bySev = { critical: 0, major: 0, minor: 0 } as Record<string, number>;
  for (const d of cert.defects) bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
  const { root, body } = section(
    `DEFECTS (${cert.defects.length})`,
    `${bySev.critical ?? 0} critical · ${bySev.major ?? 0} major · ${bySev.minor ?? 0} minor`,
  );

  for (const d of cert.defects) {
    const row = el("div", `sv-defect sv-sev-${d.severity}`);

    const top = el("div", "sv-defect-top");
    top.appendChild(el("span", `sv-sev-dot sv-sev-${d.severity}`));
    top.appendChild(el("span", "sv-defect-type", d.type.replace(/_/g, " ")));
    top.appendChild(el("span", "sv-defect-conf", `conf ${(d.confidence * 100).toFixed(0)}%`));
    const outcome = outcomeOf(d);
    const chip = el("span", `sv-outcome sv-outcome-${outcome.toLowerCase()}`, outcome);
    if (d.outcomeNote) chip.title = d.outcomeNote;
    top.appendChild(chip);
    row.appendChild(top);

    if (d.description) row.appendChild(el("div", "sv-defect-desc", d.description));

    if (d.evidence && d.evidence.length > 0) {
      const ev = el("div", "sv-evidence");
      for (const e of d.evidence) {
        const tag = el("span", "sv-evidence-kind", e.kind + (e.count !== undefined ? ` ×${e.count}` : ""));
        if (e.detail) tag.title = e.detail;
        ev.appendChild(tag);
      }
      row.appendChild(ev);
    }
    body.appendChild(row);
  }
  return root;
}

function renderScale(cert: CertificateSummary): HTMLElement | undefined {
  const s = cert.scale;
  if (!s) return undefined;
  const { root, body } = section("METRIC SCALE");
  body.appendChild(
    el(
      "div",
      "sv-scale-row",
      `vendor factor: ${s.vendorFactor !== undefined ? num(s.vendorFactor) : "n/a"} · applied: ${s.vendorFactorApplied ? "YES" : "NO"}`,
    ),
  );
  if (s.estimated) {
    body.appendChild(
      el("div", "sv-scale-row", `independent estimate: ${fmtMeasurement(s.estimated)}`),
    );
    if (s.estimated.method) body.appendChild(el("div", "sv-method", s.estimated.method));
  }
  if (s.agreement) body.appendChild(el("div", "sv-scale-agreement", s.agreement));
  return root;
}

function renderMeasurements(cert: CertificateSummary): HTMLElement | undefined {
  const ms = cert.measurements;
  if (!ms || ms.length === 0) return undefined;
  const { root, body } = section(`MEASUREMENTS (${ms.length})`, "value [low..high] · methods verbatim");
  for (const m of ms) {
    const row = el("div", "sv-measure");
    const top = el("div", "sv-measure-top");
    top.appendChild(el("span", "sv-measure-name", m.name));
    top.appendChild(el("span", "sv-measure-value", fmtMeasurement(m)));
    row.appendChild(top);
    const basis = m.uncertainty?.basis ?? m.basis;
    if (basis) row.appendChild(el("div", "sv-measure-basis", `uncertainty basis: ${basis}`));
    if (m.method) row.appendChild(el("div", "sv-method", m.method));
    body.appendChild(row);
  }
  return root;
}

function renderDisclosures(cert: CertificateSummary): HTMLElement | undefined {
  const ds = cert.disclosures;
  if (!ds || ds.length === 0) return undefined;
  const footer = el("footer", "sv-disclosures");
  footer.appendChild(el("div", "sv-section-title", "DISCLOSURES"));
  for (const d of ds) footer.appendChild(el("div", "sv-disclosure", d));
  return footer;
}

// ------------------------------------------------------------------ mount

/**
 * Mount the certificate panel into `parent`. When `parent` is document.body
 * the panel floats top-right; otherwise it fills its container.
 */
export function mountCertificatePanel(
  parent: HTMLElement,
  cert?: CertificateSummary,
): CertificatePanelHandle {
  const panel = el("div", "sv-panel sv-panel-certificate");
  if (parent === document.body) panel.classList.add("sv-float-tr");
  parent.appendChild(panel);

  function render(c: CertificateSummary): void {
    panel.replaceChildren();
    panel.appendChild(renderHeader(c));
    panel.appendChild(renderTrust(c));
    panel.appendChild(renderVerdicts(c));
    panel.appendChild(renderDefects(c));
    const scale = renderScale(c);
    if (scale) panel.appendChild(scale);
    const measures = renderMeasurements(c);
    if (measures) panel.appendChild(measures);
    const disc = renderDisclosures(c);
    if (disc) panel.appendChild(disc);
  }

  if (cert) render(cert);
  else panel.appendChild(el("div", "sv-empty", "no certificate loaded"));

  return {
    el: panel,
    update: render,
    destroy: () => panel.remove(),
  };
}
