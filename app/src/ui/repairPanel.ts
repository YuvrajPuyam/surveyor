/**
 * Repair panel — proposes a scripted repair plan from a certificate summary
 * (scale first if scale_error present, then hole patches, then quarantine of
 * ghost geometry, then acceptance of robot-relative sills), drives a
 * RepairDriver (worker-backed in the integrated app), and renders the live
 * log behind a collapsed "Show the work" expander.
 *
 * Steps render as cards with human copy (humanize.repairCardCopy); the copy
 * bug where the scale step asserted "they agree" regardless of the numbers
 * is fixed at the source: proposePlan derives the agreement text from
 * humanize.scaleAgreement (vendorFactor vs the estimate's 2-SD band).
 *
 * THE fail-and-adapt moment: when a driver's regional recertify returns
 * newDefects, the certifier caught the repair — the panel renders it LOUD
 * (pulsing banner + timed sub-rows on the card) and, for a fitted_slab
 * patch, automatically reverts and retries with mesh_fill (the exact
 * sequence from the first real Marble world, un-staged).
 */
import "./panels.css";
import type {
  CertificateSummary,
  DefectSummary,
  RecertifyResult,
  RepairDriver,
  RepairStep,
  StepResult,
} from "./protocol";
import {
  BTN,
  caughtBanner,
  humanizeLogLine,
  repairCardCopy,
  scaleAgreement,
  SHOW_THE_WORK,
  statusChipLabel,
  SUBROW,
} from "./humanize";

export interface RepairPanelOptions {
  driver: RepairDriver;
  /** Called whenever a step result carries a refreshed certificate. */
  onCertificate?: (cert: CertificateSummary) => void;
  /**
   * Called when Run All finishes every step without pausing. Findings
   * discovered DURING repair verification stay open in the engine ledger
   * (they are not part of this plan) — the host should sweep them to
   * outcomes and trigger the final recertify.
   */
  onRunAllComplete?: () => void;
  /** Called when the certifier catches a repair (fail-and-adapt starts). */
  onCaught?: (newDefects: DefectSummary[]) => void;
}

export interface RepairPanelHandle {
  el: HTMLElement;
  /** Rebuild the proposed plan from a (re)loaded certificate. */
  setPlan(cert: CertificateSummary): void;
  /** Append a line to the live log ("info" | "ok" | "warn" | "loud"). */
  log(line: string, kind?: LogKind): void;
  /** Run the whole plan (Space in Beat 4 drives this — no synthetic clicks). */
  runAll(): void;
  /** Expand/collapse the "Show the work" raw log. */
  expandLog(on: boolean): void;
  destroy(): void;
}

type LogKind = "info" | "ok" | "warn" | "loud";
type StepStatus = "pending" | "running" | "done" | "caught" | "failed" | "reverted";
/** executeStep outcome: a step status, or "replan" when the driver signals the
 *  world was re-measured wholesale (StepResult.replan) and the plan is stale. */
type StepOutcome = StepStatus | "replan";

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

// -------------------------------------------------------------- plan rules

function isOpen(d: DefectSummary): boolean {
  return !d.outcome || d.outcome === "OPEN";
}

/**
 * Scripted plan order (docs/sprint-tomorrow.md lane D):
 *  1. apply_vendor_scale if any open scale_error (one transform can resolve
 *     every scale-dependent defect — always evaluated first)
 *  2. patch_hole fitted_slab per open collider_hole
 *  3. quarantine ghost geometry (visual_only_surface + phantom_collider) in bulk
 *  4. accept_defect for raised sills (robot-relative; the verdict stands)
 *
 * label/detail carry the HUMAN card copy (humanize); rawLabel/rawDetail keep
 * the machine strings for dev mode. Agreement copy is DERIVED from the
 * numbers — never asserted.
 */
export function proposePlan(cert: CertificateSummary): RepairStep[] {
  const open = (type: string) => cert.defects.filter((d) => d.type === type && isOpen(d));
  const steps: RepairStep[] = [];

  const scaleDefects = open("scale_error");
  if (scaleDefects.length > 0 && !cert.scale?.vendorFactorApplied) {
    const vf = cert.scale?.vendorFactor;
    const est = cert.scale?.estimated?.value;
    const agr = scaleAgreement(cert.scale);
    const step: RepairStep = {
      id: "step-scale",
      kind: "apply_vendor_scale",
      label: "",
      detail: "",
      rawLabel: `Apply vendor scale${vf !== undefined ? ` ×${vf.toFixed(3)}` : ""}`,
      rawDetail:
        vf !== undefined && est !== undefined
          ? `vendor ${vf.toFixed(3)} vs independent estimate ${est.toFixed(2)} — ${agr.agrees ? "they agree" : "they DISAGREE"}; one transform re-measures the whole world`
          : "vendor metric scale factor shipped but never applied",
      defectIds: scaleDefects.map((d) => d.id),
    };
    const copy = repairCardCopy(step, cert);
    step.label = copy.title;
    step.detail = copy.body;
    steps.push(step);
  }

  for (const hole of open("collider_hole")) {
    const step: RepairStep = {
      id: `step-patch-${hole.id}`,
      kind: "patch_hole",
      label: "",
      detail: "",
      rawLabel: `Patch hole ${hole.id} (fitted_slab)`,
      rawDetail: hole.description ?? "collider hole under visually intact surface",
      defectIds: [hole.id],
      method: "fitted_slab",
    };
    const copy = repairCardCopy(step, cert);
    step.label = copy.title;
    step.detail = copy.body;
    steps.push(step);
  }

  const ghosts = [...open("visual_only_surface"), ...open("phantom_collider")];
  if (ghosts.length > 0) {
    const step: RepairStep = {
      id: "step-quarantine-ghosts",
      kind: "quarantine",
      label: "",
      detail: "",
      rawLabel: `Quarantine ${ghosts.length} ghost surface${ghosts.length === 1 ? "" : "s"}`,
      rawDetail:
        "surfaces whose visuals and physics disagree and cannot be reconciled — excluded so no training episode touches the divergent region",
      defectIds: ghosts.map((d) => d.id),
      reason: "visual/physics disagreement is unrepairable; region excluded from the navigable area",
    };
    const copy = repairCardCopy(step, cert);
    step.label = copy.title;
    step.detail = copy.body;
    steps.push(step);
  }

  const sills = open("raised_sill");
  if (sills.length > 0) {
    const step: RepairStep = {
      id: "step-accept-sills",
      kind: "accept_defect",
      label: "",
      detail: "",
      rawLabel: `Accept ${sills.length} raised sill${sills.length === 1 ? "" : "s"}`,
      rawDetail:
        "negotiability is robot-relative — each sill is judged per robot envelope; the measured verdicts stand, no repair needed",
      defectIds: sills.map((d) => d.id),
      reason: "genuinely raised sill; per-robot verdicts stand as measured",
    };
    const copy = repairCardCopy(step, cert);
    step.label = copy.title;
    step.detail = copy.body;
    steps.push(step);
  }

  return steps;
}

// ------------------------------------------------------------------ mount

interface StepView {
  step: RepairStep;
  status: StepStatus;
  actionId?: string;
  row: HTMLElement;
  statusChip: HTMLElement;
  subRows: HTMLElement;
  rawFooter: HTMLElement;
  execBtn: HTMLButtonElement;
  revertBtn: HTMLButtonElement;
}

/**
 * Mount the repair panel into `parent`. When `parent` is document.body the
 * panel floats bottom-right; otherwise it fills its container.
 */
export function mountRepairPanel(parent: HTMLElement, opts: RepairPanelOptions): RepairPanelHandle {
  const panel = el("div", "sv-panel sv-panel-repair");
  if (parent === document.body) panel.classList.add("sv-float-br");
  parent.appendChild(panel);

  // ---- header
  const head = el("div", "sv-cert-head");
  head.appendChild(el("div", "sv-cert-title", "REPAIR PLAN"));
  const runAllBtn = el("button", "sv-btn sv-btn-primary", BTN.runAll) as HTMLButtonElement;
  head.appendChild(runAllBtn);
  panel.appendChild(head);

  // ---- fail-and-adapt banner slot (hidden until the certifier catches one)
  const bannerSlot = el("div", "sv-banner-slot");
  panel.appendChild(bannerSlot);

  // ---- plan list
  const planList = el("div", "sv-plan-list");
  panel.appendChild(planList);

  // ---- live log behind a collapsed "Show the work" expander
  const logHead = el("button", "sv-collapse-head sv-loghead") as HTMLButtonElement;
  const logChev = el("span", "sv-collapse-chev", "▸");
  logHead.appendChild(logChev);
  logHead.appendChild(el("span", "sv-collapse-title", SHOW_THE_WORK));
  panel.appendChild(logHead);
  const logArea = el("div", "sv-log");
  panel.appendChild(logArea);

  let logOpen = false;
  function expandLog(on: boolean): void {
    logOpen = on;
    logArea.style.display = on ? "" : "none";
    logChev.textContent = on ? "▾" : "▸";
    if (on) logArea.scrollTop = logArea.scrollHeight;
  }
  expandLog(false);
  logHead.addEventListener("click", () => {
    logHead.blur();
    expandLog(!logOpen);
  });

  let views: StepView[] = [];
  let busy = false;
  /** Freshest certificate seen in any StepResult — used to rebuild the plan on replan. */
  let lastCert: CertificateSummary | undefined;

  // ------------------------------------------------------------------ log

  function log(line: string, kind: LogKind = "info"): void {
    const t = new Date();
    const ts = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
    const row = el("div", `sv-log-line sv-log-${kind}`);
    row.appendChild(el("span", "sv-log-ts", ts));
    const human = humanizeLogLine(line);
    row.appendChild(el("span", "sv-log-text", human ?? line));
    // dev mode: the raw machine line in dim text underneath
    if (human !== undefined && human !== line) {
      row.appendChild(el("span", "sv-log-raw sv-raw sv-raw-block", line));
    }
    logArea.appendChild(row);
    logArea.scrollTop = logArea.scrollHeight;
  }

  // --------------------------------------------------------------- banner

  let banner: HTMLElement | undefined;

  function showCaughtBanner(rec: RecertifyResult): void {
    banner?.remove();
    const copy = caughtBanner(rec.newDefects);
    banner = el("div", "sv-adapt-banner");
    banner.appendChild(el("div", "sv-adapt-title", copy.title));
    for (let i = 0; i < copy.lines.length; i++) {
      const line = el("div", "sv-adapt-defect", copy.lines[i]);
      const d = rec.newDefects[i];
      if (d) {
        line.title = `${d.id} · ${d.type}`;
        line.appendChild(
          el("span", "sv-raw sv-raw-block", `NEW ${d.severity} ${d.type}: ${d.description ?? d.id}`),
        );
      }
      banner.appendChild(line);
    }
    banner.appendChild(el("div", "sv-adapt-note", copy.footnote));
    bannerSlot.replaceChildren(banner);
    opts.onCaught?.(rec.newDefects);
  }

  function resolveBanner(text: string): void {
    if (!banner) return;
    banner.classList.add("sv-adapt-resolved");
    banner.appendChild(el("div", "sv-adapt-recovered", text));
  }

  // ----------------------------------------------------------- step state

  function refreshRawFooter(view: StepView): void {
    const bits: string[] = [];
    if (view.step.rawLabel) bits.push(view.step.rawLabel);
    if (view.step.defectIds.length > 0) {
      bits.push(
        `defects: ${view.step.defectIds.slice(0, 6).join(", ")}${view.step.defectIds.length > 6 ? ` +${view.step.defectIds.length - 6} more` : ""}`,
      );
    }
    if (view.actionId) bits.push(`action: ${view.actionId}`);
    view.rawFooter.textContent = bits.join(" · ");
  }

  function setStatus(view: StepView, status: StepStatus): void {
    view.status = status;
    view.statusChip.textContent = statusChipLabel(status);
    view.statusChip.className = `sv-step-status sv-step-${status}`;
    view.statusChip.title = status.toUpperCase();
    view.row.classList.toggle("sv-step-row-running", status === "running");
    view.row.classList.toggle("sv-step-row-caught", status === "caught");
    view.execBtn.disabled = status === "running" || status === "done";
    view.revertBtn.style.display =
      view.actionId && (status === "done" || status === "caught") ? "" : "none";
    refreshRawFooter(view);
  }

  /** Timed sub-row on the card — the inline fail-and-adapt drama. */
  function addSubRow(view: StepView, text: string, kind: "info" | "ok" | "warn" = "info"): void {
    const row = el("div", `sv-card-sub sv-card-sub-${kind}`, text);
    view.subRows.appendChild(row);
    view.row.classList.add("sv-card-adapting");
  }

  function clearAdapting(view: StepView): void {
    view.row.classList.remove("sv-card-adapting");
  }

  // -------------------------------------------------------------- execute

  function reportRecertify(rec: RecertifyResult): void {
    log(
      `recertify (${rec.scope}): grade ${rec.grade}` +
        (rec.resolvedDefectIds.length > 0 ? ` · resolved ${rec.resolvedDefectIds.join(", ")}` : "") +
        (rec.openDefects ? ` · ${rec.openDefects.length} open` : ""),
      rec.newDefects.length > 0 ? "warn" : "ok",
    );
  }

  function absorbResult(res: StepResult): void {
    for (const line of res.log ?? []) log(line);
    if (res.certificate) {
      lastCert = res.certificate;
      opts.onCertificate?.(res.certificate);
    }
  }

  /** Rebuild the plan from the freshest certificate after a wholesale re-measure. */
  function handleReplan(): void {
    if (!lastCert) return;
    renderPlan(proposePlan(lastCert));
    log("plan rebuilt from the re-measured certificate", "info");
  }

  /** Run one step; returns the final status. Handles fail-and-adapt. */
  async function executeStep(view: StepView): Promise<StepOutcome> {
    setStatus(view, "running");
    log(`→ ${view.step.label}`);

    let res: StepResult;
    try {
      res = await opts.driver.runStep(view.step);
    } catch (err) {
      log(`step failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
      setStatus(view, "failed");
      return "failed";
    }

    absorbResult(res);
    if (!res.ok) {
      log(`step failed: ${res.error ?? "driver reported not-ok"}`, "warn");
      setStatus(view, "failed");
      return "failed";
    }
    view.actionId = res.actionId ?? view.actionId;

    // Wholesale re-measure (e.g. apply_vendor_scale): the step holds, but the
    // rest of the plan is stale — signal the caller to rebuild and continue.
    if (res.replan) {
      setStatus(view, "done");
      log(`${view.step.label} holds — world re-measured, plan is stale`, "ok");
      return "replan";
    }

    const rec = res.recertify;
    if (!rec) {
      setStatus(view, "done");
      return "done";
    }
    reportRecertify(rec);

    if (rec.newDefects.length === 0) {
      log(`${view.step.label} holds — certifier approved`, "ok");
      setStatus(view, "done");
      return "done";
    }

    // ---------------- the fail-and-adapt moment: render it LOUD ----------
    showCaughtBanner(rec);
    expandLog(true); // "Show the work" auto-expands during the drama
    log(
      `CERTIFIER CAUGHT THE REPAIR — ${rec.newDefects.length} new defect${rec.newDefects.length === 1 ? "" : "s"} created by the repair itself`,
      "loud",
    );

    const canAdapt =
      view.step.kind === "patch_hole" && view.step.method === "fitted_slab" && !!res.actionId;
    if (!canAdapt) {
      setStatus(view, "caught");
      return "caught";
    }

    // revert the offending action, retry with mesh_fill
    addSubRow(view, SUBROW.reverting, "warn");
    log(`reverting action ${res.actionId} …`, "warn");
    try {
      const rev = await opts.driver.revert(res.actionId as string);
      absorbResult(rev);
      if (!rev.ok) throw new Error(rev.error ?? "revert reported not-ok");
    } catch (err) {
      log(`revert failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
      setStatus(view, "caught");
      return "caught";
    }
    addSubRow(view, SUBROW.retrying);
    log("retrying with mesh_fill (conforming watertight fill) …");

    const retryStep: RepairStep = { ...view.step, method: "mesh_fill" };
    let res2: StepResult;
    try {
      res2 = await opts.driver.runStep(retryStep);
    } catch (err) {
      log(`mesh_fill retry failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
      return quarantineAfterFailedRepairs(view);
    }
    absorbResult(res2);
    view.actionId = res2.actionId ?? view.actionId;

    if (res2.ok && res2.recertify && res2.recertify.newDefects.length === 0) {
      reportRecertify(res2.recertify);
      log("mesh_fill holds — the certifier caught our own repair, and the retry passed", "ok");
      addSubRow(view, SUBROW.retryHolds, "ok");
      resolveBanner(SUBROW.retryHolds);
      view.step.method = "mesh_fill";
      view.execBtn.textContent = BTN.run;
      setStatus(view, "done");
      clearAdapting(view);
      expandLog(false); // the drama is over — re-collapse the raw log
      return "done";
    }
    if (res2.recertify) reportRecertify(res2.recertify);
    addSubRow(view, SUBROW.bothFailed, "warn");
    log(
      "mesh_fill did not pass recertify either — 2 failed repair attempts: quarantine per policy",
      "warn",
    );
    return quarantineAfterFailedRepairs(view, res2.ok ? res2.actionId : undefined);
  }

  /**
   * Rung 3 of fail-and-adapt (tool-policy line: quarantine "after 2 failed
   * repair attempts"): revert the failed retry, quarantine the region, mark
   * the step done. The region is excluded rather than papered over.
   */
  async function quarantineAfterFailedRepairs(
    view: StepView,
    revertActionId?: string,
  ): Promise<StepOutcome> {
    if (revertActionId) {
      log(`reverting failed retry ${revertActionId} …`, "warn");
      try {
        const rev = await opts.driver.revert(revertActionId);
        absorbResult(rev);
      } catch (err) {
        log(`revert failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
      }
    }
    const qStep: RepairStep = {
      id: `${view.step.id}-quarantine`,
      kind: "quarantine",
      label: "Rope off the area (after 2 failed repairs)",
      detail: "Two repair methods failed inspection — the region is excluded instead.",
      rawLabel: `Quarantine ${view.step.defectIds.join(", ")} (after 2 failed repairs)`,
      rawDetail: "fitted_slab and mesh_fill both failed regional recertify",
      defectIds: view.step.defectIds,
      reason:
        "2 failed repair attempts (fitted_slab, mesh_fill) — region excluded from the navigable area per policy",
    };
    let res: StepResult;
    try {
      res = await opts.driver.runStep(qStep);
    } catch (err) {
      log(`quarantine failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
      setStatus(view, "caught");
      return "caught";
    }
    absorbResult(res);
    if (!res.ok) {
      log(`quarantine failed: ${res.error ?? "driver reported not-ok"}`, "warn");
      setStatus(view, "caught");
      return "caught";
    }
    view.actionId = res.actionId ?? view.actionId;
    log("region quarantined — no training episode touches the divergent region", "ok");
    addSubRow(view, SUBROW.quarantined, "ok");
    resolveBanner(SUBROW.quarantined);
    setStatus(view, "done");
    clearAdapting(view);
    expandLog(false); // the drama is over — re-collapse the raw log
    return "done";
  }

  async function revertStep(view: StepView): Promise<void> {
    if (!view.actionId || busy) return;
    busy = true;
    log(`revert ${view.actionId} (stack discipline: later actions revert too)`, "warn");
    try {
      const res = await opts.driver.revert(view.actionId);
      absorbResult(res);
      setStatus(view, res.ok ? "reverted" : view.status);
      if (!res.ok) log(`revert failed: ${res.error ?? "driver reported not-ok"}`, "warn");
    } catch (err) {
      log(`revert failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------ plan list

  function renderPlan(steps: RepairStep[]): void {
    planList.replaceChildren();
    views = steps.map((step) => {
      const row = el("div", "sv-card");

      const top = el("div", "sv-step-top");
      const statusChip = el("span", "sv-step-status sv-step-pending", statusChipLabel("pending"));
      statusChip.title = "PENDING";
      top.appendChild(statusChip);
      const title = el("span", "sv-step-label", step.label);
      if (step.rawLabel) title.title = step.rawLabel;
      top.appendChild(title);

      const execBtn = el("button", "sv-btn", BTN.run) as HTMLButtonElement;
      const revertBtn = el("button", "sv-btn sv-btn-danger", BTN.undo) as HTMLButtonElement;
      revertBtn.style.display = "none";
      top.appendChild(execBtn);
      top.appendChild(revertBtn);
      row.appendChild(top);

      row.appendChild(el("div", "sv-card-body", step.detail));

      const subRows = el("div", "sv-card-subs");
      row.appendChild(subRows);

      const rawFooter = el("div", "sv-step-defects sv-raw sv-raw-block");
      row.appendChild(rawFooter);
      planList.appendChild(row);

      const view: StepView = { step, status: "pending", row, statusChip, subRows, rawFooter, execBtn, revertBtn };
      refreshRawFooter(view);
      execBtn.addEventListener("click", () => {
        execBtn.blur();
        if (busy) return;
        busy = true;
        void executeStep(view)
          .then((status) => {
            if (status === "replan") handleReplan();
          })
          .finally(() => {
            busy = false;
          });
      });
      revertBtn.addEventListener("click", () => {
        revertBtn.blur();
        void revertStep(view);
      });
      return view;
    });

    if (steps.length === 0) {
      planList.appendChild(el("div", "sv-empty", "no open defects — nothing to repair"));
    }
  }

  function runAll(): void {
    if (busy) return;
    busy = true;
    runAllBtn.disabled = true;
    log("Run All: executing plan in order (scale → holes → quarantine → sills)");
    void (async () => {
      let replanned = false;
      let completed = false;
      try {
        for (const view of views) {
          if (view.status !== "pending" && view.status !== "failed" && view.status !== "reverted")
            continue;
          const status = await executeStep(view);
          if (status === "replan") {
            replanned = true;
            break;
          }
          if (status === "caught" || status === "failed") {
            log(`Run All paused at "${view.step.label}" — resolve it, then continue`, "warn");
            return;
          }
        }
        if (!replanned) {
          log("Run All complete — recertify (full) to grade the repaired world", "ok");
          completed = true;
        }
      } finally {
        busy = false;
        runAllBtn.disabled = false;
      }
      if (replanned) {
        // Rebuild from the re-measured certificate and keep going — the demo
        // is one click; the countdown clock can't tell and neither can anyone.
        handleReplan();
        log("continuing Run All on the rebuilt plan…");
        setTimeout(() => runAll(), 30);
      } else if (completed) {
        opts.onRunAllComplete?.();
      }
    })();
  }

  runAllBtn.addEventListener("click", () => {
    runAllBtn.blur();
    runAll();
  });

  return {
    el: panel,
    setPlan(cert: CertificateSummary): void {
      lastCert = cert;
      renderPlan(proposePlan(cert));
    },
    log,
    runAll,
    expandLog,
    destroy: () => panel.remove(),
  };
}
