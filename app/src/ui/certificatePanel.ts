/**
 * Certificate panel — plain-DOM rendering of a certificate summary
 * (summarizeCertificate shape from src/agent/tools.ts, or the raw
 * certificate.json — both are accepted).
 *
 * Redesigned per docs/ui-redesign-spec.md: five collapsible sections
 * (Trust, Robot verdicts, Defects, Measurements, Fine print), each a single
 * human summary line when collapsed; expanding keeps the existing VERBATIM
 * rendering (values, ranges, methods lines) intact. Raw ids/formats are
 * annotated in `.sv-raw` spans revealed by the D dev toggle; the human
 * bracket format lives in `.sv-hum` spans hidden in dev mode.
 *
 * Quality bar: the certificate is the product. Verdict pairs where the same
 * check fails one robot and passes another (rover-FAIL / quadruped-PASS) are
 * contrast-highlighted — "sim-readiness is relative to the robot".
 */
import "./panels.css";
import type { CertificateSummary, DefectSummary, MeasurementLike, VerdictSummary } from "./protocol";
import {
  basisLine,
  checkName,
  confidencePhrase,
  CONFIDENCE_TOOLTIP,
  CONTRAST_TAG,
  defectDisplayName,
  defectExplainer,
  defectsSummary,
  fmtMeasurementHuman,
  fmtMeasurementRaw,
  gradeStory,
  measurementName,
  measurementsSummary,
  MEASUREMENTS_SCALE_ONLY_SUMMARY,
  outcomeChip,
  rationaleStory,
  requirementLine,
  scaleAgreement,
  scaleVendorLine,
  SECTION,
  trustSummary,
  verdictsSummary,
} from "./humanize";

export interface CertificatePanelHandle {
  el: HTMLElement;
  update(cert: CertificateSummary): void;
  /** Beat-4 slim sticky header; click on it restores the full panel. */
  setCompact(on: boolean): void;
  /** Force a section open (fail-and-adapt auto-expands "defects"). */
  expandSection(key: string): void;
  /** Certificate content SHA-256 (determinism chip) — from the worker after every (re)certify. */
  setHash(hash: string | undefined): void;
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

/** value in both formats: human "(confident: a–b)" + raw "[a..b]" (dev). */
function measurementSpan(m: MeasurementLike, cls: string): HTMLElement {
  const wrap = el("span", cls);
  wrap.appendChild(el("span", "sv-hum", fmtMeasurementHuman(m)));
  wrap.appendChild(el("span", "sv-raw", fmtMeasurementRaw(m)));
  return wrap;
}

function outcomeOf(d: DefectSummary): string {
  return d.outcome && d.outcome !== "OPEN" ? String(d.outcome) : "OPEN";
}

function robotOf(v: VerdictSummary): string {
  return v.robot ?? v.robotId ?? "?";
}

// ------------------------------------------------------------ body renders
// Each render*Body fills the EXPANDED body of one collapsible section.

function renderTrustBody(cert: CertificateSummary, body: HTMLElement): void {
  const t = trustSummary(cert.trust);
  body.appendChild(el("div", "sv-trust-line", t.tested));
  body.appendChild(el("div", "sv-trust-line", t.lying));
  body.appendChild(el("div", "sv-trust-line sv-trust-line-dim", t.untested));

  // proportional bar: verified green, lying red, remainder dim (observed/unknown)
  const bar = el("div", "sv-trust-bar");
  const v = el("div", "sv-trust-bar-verified");
  v.style.width = `${Math.max(0, Math.min(100, cert.trust.verifiedPct))}%`;
  const l = el("div", "sv-trust-bar-lying");
  l.style.width = `${Math.max(0, Math.min(100, cert.trust.lyingPct))}%`;
  bar.appendChild(v);
  bar.appendChild(l);
  body.appendChild(bar);

  body.appendChild(el("div", "sv-rationale", rationaleStory(cert)));
  // the raw rationale string moved here (and to the grade badge tooltip)
  if (cert.gradeRationale) body.appendChild(el("div", "sv-rationale sv-rationale-raw", cert.gradeRationale));
}

function renderVerdictsBody(cert: CertificateSummary, body: HTMLElement): void {
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
    const gh = el("div", "sv-verdict-check", checkName(check));
    gh.title = check;
    if (contrast) gh.appendChild(el("span", "sv-contrast-tag", CONTRAST_TAG));
    group.appendChild(gh);

    for (const v of verdicts) {
      const passCls = v.pass === true ? "sv-pass" : v.pass === false ? "sv-fail" : "sv-noteval";
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
      if (v.measured) top.appendChild(measurementSpan(v.measured, "sv-verdict-measured"));
      row.appendChild(top);

      const req = el("div", "sv-verdict-req", requirementLine(v.requirement));
      req.title = `requires: ${v.requirement}`;
      row.appendChild(req);
      if (v.measured?.method) row.appendChild(el("div", "sv-method", v.measured.method));
      if (v.gravityNote) row.appendChild(el("div", "sv-gravity-note", v.gravityNote));
      group.appendChild(row);
    }
    body.appendChild(group);
  }
}

function renderDefectsBody(cert: CertificateSummary, body: HTMLElement): void {
  const ordinals = new Map<string, number>(); // per-type counters, display order
  // outdoor certificates can carry 15k+ defects — rendering them all as DOM
  // rows freezes the tab. Cap the list; severity sort puts the worst first.
  const MAX_ROWS = 400;
  const SEV: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  const listed = [...cert.defects].sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3)).slice(0, MAX_ROWS);
  if (cert.defects.length > MAX_ROWS) {
    body.appendChild(
      el("div", "sv-defect-desc", `showing the ${MAX_ROWS} most severe of ${cert.defects.length.toLocaleString()} defects — the full list lives in certificate.json`),
    );
  }
  for (const d of listed) {
    const ord = (ordinals.get(d.type) ?? 0) + 1;
    ordinals.set(d.type, ord);

    const row = el("div", `sv-defect sv-sev-${d.severity}`);

    const top = el("div", "sv-defect-top");
    top.appendChild(el("span", `sv-sev-dot sv-sev-${d.severity}`));
    const name = el("span", "sv-defect-type", defectDisplayName(d, ord));
    name.title = `${d.id} · ${d.type}`;
    top.appendChild(name);
    top.appendChild(el("span", "sv-defect-id sv-raw", d.id));
    const conf = el("span", "sv-defect-conf", confidencePhrase(d.confidence));
    conf.title = CONFIDENCE_TOOLTIP;
    top.appendChild(conf);
    const outcome = outcomeOf(d);
    const chipCopy = outcomeChip(outcome);
    const chip = el("span", `sv-outcome sv-outcome-${outcome.toLowerCase()}`, chipCopy.label);
    chip.title = d.outcomeNote ? `${chipCopy.tooltip} — ${d.outcomeNote}` : chipCopy.tooltip;
    top.appendChild(chip);
    row.appendChild(top);

    const explainer = defectExplainer(d);
    if (explainer) row.appendChild(el("div", "sv-defect-desc", explainer));
    if (d.description && d.description !== explainer) {
      row.appendChild(el("div", "sv-defect-raw sv-raw sv-raw-block", `raw: ${d.description}`));
    }

    if (d.evidence && d.evidence.length > 0) {
      const ev = el("div", "sv-evidence");
      for (const e of d.evidence) {
        const tag = el("span", "sv-evidence-kind", e.kind + (e.count !== undefined ? ` ×${e.count}` : ""));
        if (e.detail) tag.title = e.detail;
        ev.appendChild(tag);
      }
      row.appendChild(ev);
    }
    // click-to-fly: the list is a MAP of the world — clicking a row asks the
    // viewer to transport the camera to the defect (decoupled via CustomEvent;
    // the panel stays plain DOM with no three.js knowledge)
    if (d.region) {
      row.style.cursor = "pointer";
      row.title = "click to fly to this defect in the world";
      row.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent("sv-jump-defect", {
            detail: { id: d.id, region: d.region, label: defectDisplayName(d, ord) },
          }),
        );
      });
    }
    body.appendChild(row);
  }
}

function renderMeasurementsBody(cert: CertificateSummary, body: HTMLElement): void {
  // --- scale block first (§2.6): vendor line, estimate, agreement verbatim
  const s = cert.scale;
  if (s) {
    const block = el("div", "sv-scale-block");
    block.appendChild(el("div", "sv-scale-row", scaleVendorLine(s)));
    if (s.estimated) {
      const row = el("div", "sv-measure");
      const top = el("div", "sv-measure-top");
      const nm = el("span", "sv-measure-name", measurementName(s.estimated.name ?? "metric_scale_factor_estimate"));
      nm.title = s.estimated.name ?? "";
      top.appendChild(nm);
      top.appendChild(measurementSpan(s.estimated, "sv-measure-value"));
      row.appendChild(top);
      if (s.estimated.method) row.appendChild(el("div", "sv-method", s.estimated.method));
      block.appendChild(row);
    }
    // the certificate's own agreement sentence, VERBATIM
    if (s.agreement) block.appendChild(el("div", "sv-scale-agreement", s.agreement));
    // dev mode shows both: our derived comparison next to the verbatim line
    const derived = scaleAgreement(s);
    const derivedEl = el(
      "div",
      `sv-scale-derived sv-raw sv-raw-block${derived.agrees === false ? " sv-scale-disagree" : ""}`,
      `derived: ${derived.headline}`,
    );
    block.appendChild(derivedEl);
    body.appendChild(block);
  }

  const ms = cert.measurements;
  if (!ms || ms.length === 0) return;
  for (const m of ms) {
    const row = el("div", "sv-measure");
    const top = el("div", "sv-measure-top");
    const nm = el("span", "sv-measure-name", measurementName(m.name));
    nm.title = m.name;
    top.appendChild(nm);
    top.appendChild(measurementSpan(m, "sv-measure-value"));
    row.appendChild(top);
    const basis = m.uncertainty?.basis ?? m.basis;
    if (basis) row.appendChild(el("div", "sv-measure-basis", basisLine(basis)));
    if (m.method) row.appendChild(el("div", "sv-method", m.method));
    body.appendChild(row);
  }
}

function renderFinePrintBody(cert: CertificateSummary, body: HTMLElement): void {
  for (const d of cert.disclosures ?? []) body.appendChild(el("div", "sv-disclosure", d));
}

// ------------------------------------------------------------------ header

function renderHeader(cert: CertificateSummary, hash?: string): HTMLElement {
  const head = el("div", "sv-cert-head");

  const left = el("div", "sv-cert-head-left");
  left.appendChild(el("div", "sv-cert-title", "PHYSICS CERTIFICATE"));
  const gravity = typeof cert.gravity === "string" ? cert.gravity : cert.gravity?.name;
  left.appendChild(
    el("div", "sv-cert-world", `${cert.worldId}${gravity ? `  ·  gravity: ${gravity}` : ""}`),
  );
  const story = gradeStory(cert.grade);
  if (story) left.appendChild(el("div", "sv-cert-story", story));
  if (hash) {
    const chip = el("div", "sv-hash-chip", `⬡ ${hash.slice(0, 12)}`);
    chip.title =
      `certificate content SHA-256: ${hash}\n` +
      "Deterministic for (world, seed, gravity): re-run the survey and this hash reproduces. " +
      "Compare it to the hash printed on the Devpost.";
    left.appendChild(chip);
  }
  head.appendChild(left);

  const badge = el("div", `sv-grade sv-grade-${cert.grade}`, cert.grade);
  badge.title = cert.gradeRationale ?? "";
  head.appendChild(badge);

  return head;
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

  /** Open-state survives update() re-renders. Collapsed by default. */
  const openSections = new Set<string>();
  let lastCert: CertificateSummary | undefined;
  let compact = false;
  let certHash: string | undefined;

  function collapsible(
    key: string,
    title: string,
    summary: string,
    buildBody: (body: HTMLElement) => void,
    extraClass?: string,
  ): HTMLElement {
    const open = openSections.has(key);
    const root = el("section", `sv-collapse${open ? " sv-open" : ""}${extraClass ? ` ${extraClass}` : ""}`);
    const head = el("button", "sv-collapse-head") as HTMLButtonElement;
    head.appendChild(el("span", "sv-collapse-chev", open ? "▾" : "▸"));
    head.appendChild(el("span", "sv-collapse-title", title));
    head.appendChild(el("span", "sv-collapse-summary", summary));
    root.appendChild(head);
    const body = el("div", "sv-collapse-body");
    root.appendChild(body);
    if (open) buildBody(body); // lazy: collapsed sections carry no body DOM
    else body.style.display = "none";
    head.addEventListener("click", () => {
      head.blur(); // Space stays a stepper key
      if (openSections.has(key)) openSections.delete(key);
      else openSections.add(key);
      rerender();
    });
    return root;
  }

  function render(c: CertificateSummary): void {
    lastCert = c;
    panel.replaceChildren();

    // --- compact (Beat-4) slim sticky header — CSS shows exactly one of the two
    const compactHead = el("button", "sv-compact-head") as HTMLButtonElement;
    const miniBadge = el("span", `sv-grade sv-grade-mini sv-grade-${c.grade}`, c.grade);
    miniBadge.title = c.gradeRationale ?? "";
    compactHead.appendChild(miniBadge);
    compactHead.appendChild(el("span", "sv-compact-story", gradeStory(c.grade) || "PHYSICS CERTIFICATE"));
    compactHead.title = "show the full certificate";
    compactHead.addEventListener("click", () => {
      compactHead.blur();
      setCompact(false);
    });
    panel.appendChild(compactHead);

    // --- full panel
    const full = el("div", "sv-cert-full");
    full.appendChild(renderHeader(c, certHash));

    full.appendChild(collapsible("trust", SECTION.trust, trustSummary(c.trust).line, (b) => renderTrustBody(c, b)));

    const hasContrast = (() => {
      const byCheck = new Map<string, { pass: boolean; fail: boolean }>();
      for (const v of c.robotVerdicts) {
        const g = byCheck.get(v.check) ?? { pass: false, fail: false };
        if (v.pass === true) g.pass = true;
        if (v.pass === false) g.fail = true;
        byCheck.set(v.check, g);
      }
      for (const g of byCheck.values()) if (g.pass && g.fail) return true;
      return false;
    })();
    full.appendChild(
      collapsible(
        "verdicts",
        SECTION.verdicts,
        verdictsSummary(c),
        (b) => renderVerdictsBody(c, b),
        hasContrast ? "sv-collapse-marquee" : undefined,
      ),
    );

    full.appendChild(collapsible("defects", SECTION.defects, defectsSummary(c), (b) => renderDefectsBody(c, b)));

    if (c.scale || (c.measurements && c.measurements.length > 0)) {
      const summary =
        c.measurements && c.measurements.length > 0
          ? measurementsSummary(c.measurements.length)
          : MEASUREMENTS_SCALE_ONLY_SUMMARY;
      full.appendChild(
        collapsible("measurements", SECTION.measurements, summary, (b) => renderMeasurementsBody(c, b)),
      );
    }

    if (c.disclosures && c.disclosures.length > 0) {
      full.appendChild(
        collapsible("fineprint", SECTION.finePrint, SECTION.finePrintSummary, (b) => renderFinePrintBody(c, b)),
      );
    }

    panel.appendChild(full);
    panel.classList.toggle("sv-compact", compact);
  }

  function rerender(): void {
    if (lastCert) render(lastCert);
  }

  function setCompact(on: boolean): void {
    compact = on;
    panel.classList.toggle("sv-compact", on);
  }

  if (cert) render(cert);
  else panel.appendChild(el("div", "sv-empty", "no certificate loaded"));

  return {
    el: panel,
    update: render,
    setCompact,
    expandSection(key: string): void {
      if (openSections.has(key)) return;
      openSections.add(key);
      rerender();
    },
    setHash(hash: string | undefined): void {
      if (hash === certHash) return;
      certHash = hash;
      rerender();
    },
    destroy: () => panel.remove(),
  };
}
