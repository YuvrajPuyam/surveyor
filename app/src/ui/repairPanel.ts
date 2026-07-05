/**
 * Repair panel — proposes a scripted repair plan from a certificate summary
 * (scale first if scale_error present, then hole patches, then quarantine of
 * visual lies, then acceptance of robot-relative sills), drives a
 * RepairDriver (worker-backed in the integrated app), and renders the live
 * log.
 *
 * THE fail-and-adapt moment: when a driver's regional recertify returns
 * newDefects, the certifier caught the repair — the panel renders it LOUD
 * (pulsing banner) and, for a fitted_slab patch, automatically reverts and
 * retries with mesh_fill (the exact sequence from the first real Marble
 * world, un-staged).
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
}

export interface RepairPanelHandle {
  el: HTMLElement;
  /** Rebuild the proposed plan from a (re)loaded certificate. */
  setPlan(cert: CertificateSummary): void;
  /** Append a line to the live log ("info" | "ok" | "warn" | "loud"). */
  log(line: string, kind?: LogKind): void;
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
 *  3. quarantine visual lies (visual_only_surface + phantom_collider) in bulk
 *  4. accept_defect for raised sills (robot-relative; the verdict stands)
 */
export function proposePlan(cert: CertificateSummary): RepairStep[] {
  const open = (type: string) => cert.defects.filter((d) => d.type === type && isOpen(d));
  const steps: RepairStep[] = [];
  let n = 0;

  const scaleDefects = open("scale_error");
  if (scaleDefects.length > 0 && !cert.scale?.vendorFactorApplied) {
    n += 1;
    const vf = cert.scale?.vendorFactor;
    const est = cert.scale?.estimated?.value;
    steps.push({
      id: "step-scale",
      kind: "apply_vendor_scale",
      label: `${n}. Apply vendor scale${vf !== undefined ? ` ×${vf.toFixed(3)}` : ""}`,
      detail:
        vf !== undefined && est !== undefined
          ? `vendor ${vf.toFixed(3)} vs independent estimate ${est.toFixed(2)} — they agree; one transform re-measures the whole world`
          : "vendor metric scale factor shipped but never applied",
      defectIds: scaleDefects.map((d) => d.id),
    });
  }

  for (const hole of open("collider_hole")) {
    n += 1;
    steps.push({
      id: `step-patch-${hole.id}`,
      kind: "patch_hole",
      label: `${n}. Patch hole ${hole.id} (fitted_slab)`,
      detail: hole.description ?? "collider hole under visually intact surface",
      defectIds: [hole.id],
      method: "fitted_slab",
    });
  }

  const lies = [...open("visual_only_surface"), ...open("phantom_collider")];
  if (lies.length > 0) {
    n += 1;
    steps.push({
      id: "step-quarantine-lies",
      kind: "quarantine",
      label: `${n}. Quarantine ${lies.length} visual lie${lies.length === 1 ? "" : "s"}`,
      detail: "surfaces whose visuals and physics disagree and cannot be reconciled — excluded so no training episode touches the lie",
      defectIds: lies.map((d) => d.id),
      reason: "visual/physics disagreement is unrepairable; region excluded from the navigable area",
    });
  }

  const sills = open("raised_sill");
  if (sills.length > 0) {
    n += 1;
    steps.push({
      id: "step-accept-sills",
      kind: "accept_defect",
      label: `${n}. Accept ${sills.length} raised sill${sills.length === 1 ? "" : "s"}`,
      detail: "negotiability is robot-relative: fails the rover, passes the quadruped — the verdict stands, no repair needed",
      defectIds: sills.map((d) => d.id),
      reason: "genuinely raised sill; robot-relative verdict stands (rover FAIL / quadruped PASS)",
    });
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
  const runAllBtn = el("button", "sv-btn sv-btn-primary", "Run All") as HTMLButtonElement;
  head.appendChild(runAllBtn);
  panel.appendChild(head);

  // ---- fail-and-adapt banner slot (hidden until the certifier catches one)
  const bannerSlot = el("div", "sv-banner-slot");
  panel.appendChild(bannerSlot);

  // ---- plan list
  const planList = el("div", "sv-plan-list");
  panel.appendChild(planList);

  // ---- live log
  const logTitle = el("div", "sv-section-title", "LIVE LOG");
  panel.appendChild(logTitle);
  const logArea = el("div", "sv-log");
  panel.appendChild(logArea);

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
    row.appendChild(el("span", "sv-log-text", line));
    logArea.appendChild(row);
    logArea.scrollTop = logArea.scrollHeight;
  }

  // --------------------------------------------------------------- banner

  let banner: HTMLElement | undefined;

  function showCaughtBanner(rec: RecertifyResult): void {
    banner?.remove();
    banner = el("div", "sv-adapt-banner");
    banner.appendChild(el("div", "sv-adapt-title", "CERTIFIER CAUGHT THE REPAIR"));
    for (const d of rec.newDefects) {
      banner.appendChild(
        el(
          "div",
          "sv-adapt-defect",
          `NEW ${d.severity} ${d.type.replace(/_/g, " ")}: ${d.description ?? d.id}`,
        ),
      );
    }
    banner.appendChild(
      el("div", "sv-adapt-note", "repaired is never invisible to this instrument"),
    );
    bannerSlot.replaceChildren(banner);
  }

  function resolveBanner(text: string): void {
    if (!banner) return;
    banner.classList.add("sv-adapt-resolved");
    banner.appendChild(el("div", "sv-adapt-recovered", text));
  }

  // ----------------------------------------------------------- step state

  function setStatus(view: StepView, status: StepStatus): void {
    view.status = status;
    view.statusChip.textContent = status.toUpperCase();
    view.statusChip.className = `sv-step-status sv-step-${status}`;
    view.row.classList.toggle("sv-step-row-running", status === "running");
    view.row.classList.toggle("sv-step-row-caught", status === "caught");
    view.execBtn.disabled = status === "running" || status === "done";
    view.revertBtn.style.display =
      view.actionId && (status === "done" || status === "caught") ? "" : "none";
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
      resolveBanner("→ adapted: revert + mesh_fill — repair holds");
      view.step.method = "mesh_fill";
      view.execBtn.textContent = "Execute";
      setStatus(view, "done");
      return "done";
    }
    if (res2.recertify) reportRecertify(res2.recertify);
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
      label: `Quarantine ${view.step.defectIds.join(", ")} (after 2 failed repairs)`,
      detail: "fitted_slab and mesh_fill both failed regional recertify",
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
    log("region quarantined — no training episode touches the lie", "ok");
    resolveBanner("→ adapted: revert ×2 + quarantine — the region is excluded, honestly");
    setStatus(view, "done");
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
      const row = el("div", "sv-step-row");

      const top = el("div", "sv-step-top");
      const statusChip = el("span", "sv-step-status sv-step-pending", "PENDING");
      top.appendChild(statusChip);
      top.appendChild(el("span", "sv-step-label", step.label));

      const execBtn = el("button", "sv-btn", "Execute") as HTMLButtonElement;
      const revertBtn = el("button", "sv-btn sv-btn-danger", "Revert") as HTMLButtonElement;
      revertBtn.style.display = "none";
      top.appendChild(execBtn);
      top.appendChild(revertBtn);
      row.appendChild(top);

      row.appendChild(el("div", "sv-step-detail", step.detail));
      if (step.defectIds.length > 0) {
        row.appendChild(
          el(
            "div",
            "sv-step-defects",
            `defects: ${step.defectIds.slice(0, 6).join(", ")}${step.defectIds.length > 6 ? ` +${step.defectIds.length - 6} more` : ""}`,
          ),
        );
      }
      planList.appendChild(row);

      const view: StepView = { step, status: "pending", row, statusChip, execBtn, revertBtn };
      execBtn.addEventListener("click", () => {
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
      revertBtn.addEventListener("click", () => void revertStep(view));
      return view;
    });

    if (steps.length === 0) {
      planList.appendChild(el("div", "sv-empty", "no open defects — nothing to repair"));
    }
  }

  runAllBtn.addEventListener("click", () => {
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
        setTimeout(() => runAllBtn.click(), 30);
      } else if (completed) {
        opts.onRunAllComplete?.();
      }
    })();
  });

  return {
    el: panel,
    setPlan(cert: CertificateSummary): void {
      renderPlan(proposePlan(cert));
    },
    log,
    destroy: () => panel.remove(),
  };
}
