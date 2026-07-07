/**
 * Surveyor viewer — main thread (integrated demo app).
 *
 * Boot flow (docs/demo-five-beats.md):
 *   load bundle (?world=/marble/<id>) → spawn the certify worker (the REAL
 *   headless certify/repair core in the browser) → progress overlay while the
 *   survey runs → trust map paints as instanced quads at floor height
 *   (green confirmed / yellow observed / red divergent / dark unknown) →
 *   certificate + repair panels mount in the right sidebar → Run All drives
 *   the repair plan through the worker engine (fail-and-adapt rendered LOUD)
 *   → when every defect has an outcome: final full recertify, navmesh spawns
 *   rebuilt, and the rover patrol starts (over patches, around quarantine).
 *
 * Also still renders the original Gate-A layers: splat/point visuals,
 * collider wireframe, 2000-ball Rapier probe rain in its own worker.
 *
 * The UI is staged as the five-beat story (docs/ui-redesign-spec.md): a
 * bottom-center stepper drives Meet → Survey → Certificate → Repair →
 * Certified; the survey starts when Beat 2 is entered (not at boot) so the
 * trust-map paint is always witnessed.
 *
 * Keys: [1-5]/[→←]/[Space] five-beat stepper  [D] dev overlay
 *       [W] wireframe  [T] trust map  [P] patrol  [B] defect boxes  [F] flip splats  [I] camera
 *       [R] raw twin run (Beats 1–3 — drives the raw physics into a certificate-confirmed hole)
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  resolveBundleDir,
  fetchMetadata,
  fetchCertificate,
  fetchVisualPoints,
  findSplatUrl,
  type Certificate,
} from "./bundle";
import type { InitMsg, WorkerToMain } from "./protocol";
import { CertifyWorkerClient, type SpawnPoint } from "./workerClient";
import { mountCertificatePanel } from "./ui/certificatePanel";
import { mountRepairPanel } from "./ui/repairPanel";
import { mountMissionLog } from "./ui/missionLog";
import { loadCassette } from "./cassetteReplay";
import type {
  CertificateSummary,
  DefectSummary,
  RecertifyResult,
  RepairDriver,
  RepairStep,
  StepResult,
} from "./ui/protocol";
import { startPatrol, type Aabb as PatrolAabb, type PatrolHandle } from "./patrol";
import { createTwinRun } from "./twinRun";
import { buildVisualGround, type VisualGround } from "./visualGround";
import { TrustLayer } from "./trustLayer";
import { mountStepper, type Beat } from "./ui/stepper";
import { showGradeReveal, skipGradeReveal } from "./ui/gradeReveal";
import {
  beforeAfterSummary,
  BTN,
  gradeStory,
  HINT,
  INTRO,
  MODEL_CLASS_DISCLOSURE,
  NARRATE,
  phaseLine,
  TRUST_LEGEND,
} from "./ui/humanize";
import type { TrustMapPayload } from "./workerClient";

const PROBE_COUNT = 2000;
const PROBE_RADIUS = 0.04;
const DROP_HEIGHT = 2; // metres above the raycast surface hit
const GRAVITY_Y = -9.81;
const CERTIFY_SEED = 1234;

const SEVERITY_COLOR: Record<string, number> = {
  critical: 0xff3b30,
  major: 0xff9500,
  minor: 0xffd60a,
};
const OUTCOME_COLOR: Record<string, number> = {
  quarantined: 0xc792ea,
  accepted: 0x5fa8ff,
  escalated: 0xff453a,
};

// ------------------------------------------------------------------ scene

const container = document.getElementById("app")!;
const hudEl = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

// Everything loaded from the bundle in VIEWER coordinates lives in this
// group; when apply_vendor_scale bakes a metric factor into the engine's
// world, the group is scaled to match, so wireframe/splats/probes stay
// aligned with the (engine-coordinate) trust map, defect boxes and patrol.
const worldGroup = new THREE.Group();
worldGroup.name = "world";
scene.add(worldGroup);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 500);
camera.position.set(4, 3, 6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(5, 10, 4);
scene.add(dir);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// -------------------------------------------------------------------- HUD

interface HudState {
  worldId: string;
  visualMode: string;
  grade: string;
  defects: number;
  triangles: number;
  probes: number;
  renderFps: number;
  workerSps: number;
  status: string;
}

const hud: HudState = {
  worldId: "…",
  visualMode: "loading",
  grade: "-",
  defects: 0,
  triangles: 0,
  probes: 0,
  renderFps: 0,
  workerSps: 0,
  status: "loading bundle…",
};

function fpsClass(v: number, good: number, okay: number): string {
  return v >= good ? "ok" : v >= okay ? "warn" : "bad";
}

function renderHud(): void {
  const fps = hud.renderFps.toFixed(0);
  const sps = hud.workerSps.toFixed(0);
  hudEl.innerHTML =
    `<span class="big ${fpsClass(hud.renderFps, 50, 25)}">render ${fps} fps</span>  ` +
    `<span class="big ${fpsClass(hud.workerSps, 55, 30)}">physics ${sps} steps/s</span>\n` +
    `world    ${hud.worldId}\n` +
    `visuals  ${hud.visualMode}\n` +
    `collider ${hud.triangles.toLocaleString()} tris   probes ${hud.probes}\n` +
    `grade    ${hud.grade}   open defects ${hud.defects}\n` +
    `${hud.status}\n` +
    `[1-5] beats  [Space] action  [→/←] step  [D] dev\n` +
    `[W] wireframe  [T] trust  [P] patrol  [B] boxes  [F] flip  [I] camera  [R] raw run`;
}
setInterval(renderHud, 250);

// ---------------------------------------------------------- dev mode (D)
// One boolean, default OFF, persisted. Reveals the raw HUD and every .sv-raw
// annotation (ids, seeds, actionIds, raw log lines, [low..high] format).
// It never changes layout — toggling it live on stage is safe.

const DEV_KEY = "sv-dev";
let devMode = false;

function setDevMode(on: boolean): void {
  devMode = on;
  document.body.classList.toggle("sv-dev", on);
  hudEl.style.display = on ? "block" : "none";
  try {
    localStorage.setItem(DEV_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the toggle just won't persist */
  }
  if (on) repairPanel.expandLog(true); // dev: the raw log is always open
}

/** Never steal keys from a focused control (spec §1.3 guard). */
function isUiKeyTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || t.isContentEditable;
}

// ------------------------------------------------- certify worker + panels

const client = new CertifyWorkerClient();
const trustLayer = new TrustLayer(scene);

// Right sidebar hosting both panels (certificate on top, repair below).
const sidebar = document.createElement("div");
sidebar.id = "sv-sidebar";
Object.assign(sidebar.style, {
  position: "fixed",
  top: "10px",
  right: "10px",
  bottom: "10px",
  width: "384px",
  display: "none", // hidden until Beat 3 — the grade reveal is its entrance
  flexDirection: "column",
  gap: "10px",
  zIndex: "20",
} satisfies Partial<CSSStyleDeclaration>);
document.body.appendChild(sidebar);

const certificatePanel = mountCertificatePanel(sidebar);
Object.assign(certificatePanel.el.style, { flex: "1 1 55%", minHeight: "0", width: "100%" });

const repairPanel = mountRepairPanel(sidebar, {
  driver: makeRepairDriver(client),
  onCertificate: applyCertificate,
  onRunAllComplete: () => void sweepRemaining(),
  onCaught: () => {
    // fail-and-adapt: flash the new defect's box in the world and show the
    // defect appear in the (auto-expanded) Defects section.
    certificatePanel.expandSection("defects");
    flashDefectBoxes(3000);
  },
});
Object.assign(repairPanel.el.style, { flex: "1 1 45%", minHeight: "0", width: "100%" });
repairPanel.log("waiting for survey…");

// ---- MISSION LOG (C7): recorded-episode replay narrating Beat 4 --------
// Cassette is a static asset: assets/traces/repair-episode.jsonl (vite
// publicDir "../assets") → served at /traces/repair-episode.jsonl. Wifi-off.
const MISSION_LOG_CASSETTE_URL = "/traces/repair-episode.jsonl";

const missionLog = mountMissionLog(sidebar, {
  onToolCall: (name, args) => driveRepairCard(name, args),
  // the canonical 305-event episode runs 75.7 s at speed 1 — ×2 lands the
  // replay on ENDGAME's ~35 s Beat-4 window (setSpeed adjusts live if
  // rehearsal wants it different)
  speed: 2,
});
Object.assign(missionLog.el.style, {
  flex: "1 1 50%",
  minHeight: "0",
  width: "100%",
} satisfies Partial<CSSStyleDeclaration>);
missionLog.el.style.display = "none"; // Beat 4 only — applyBeat owns visibility

let missionLogStarted = false;
function startMissionLogReplay(): void {
  if (missionLogStarted) return;
  missionLogStarted = true;
  loadCassette(MISSION_LOG_CASSETTE_URL)
    .then((cassette) => missionLog.start(cassette))
    .catch((err: unknown) => {
      missionLogStarted = false; // allow a retry on the next Space
      repairPanel.log(
        `mission log: cassette failed to load — ${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
    });
}

/**
 * A recorded tool call visually drives the matching repair-plan card: pulse
 * the card whose raw footer (".sv-step-defects": rawLabel + defect ids)
 * mentions the call's defectId, else the card of the same step kind.
 * Cosmetic only (sv-ml-drive outline) — the card's real status chip stays
 * owned by the live Run All engine.
 */
function driveRepairCard(name: string, args: unknown): void {
  const a = (args ?? {}) as Record<string, unknown>;
  const defectId = typeof a["defectId"] === "string" ? (a["defectId"] as string) : undefined;
  const KIND_LABEL: Record<string, string> = {
    apply_vendor_scale: "Apply vendor scale",
    patch_hole: "Patch hole",
    quarantine: "Quarantine",
    accept_defect: "Accept",
  };
  const label = KIND_LABEL[name];
  let target: HTMLElement | undefined;
  for (const card of Array.from(repairPanel.el.querySelectorAll<HTMLElement>(".sv-card"))) {
    const footer = card.querySelector(".sv-step-defects")?.textContent ?? "";
    if (defectId && footer.includes(defectId)) {
      target = card;
      break;
    }
    if (!target && label && footer.includes(label)) target = card;
  }
  if (!target) return;
  target.classList.remove("sv-ml-drive");
  void target.offsetWidth; // restart the pulse animation
  target.classList.add("sv-ml-drive");
  window.setTimeout(() => target.classList.remove("sv-ml-drive"), 900);
}

// ------------------------------------------------------- integration state

let latestCert: CertificateSummary | undefined;
let spawnsCache: SpawnPoint[] | undefined;
let patrolHandle: PatrolHandle | undefined;
let finalized = false;
let viewerScale = 1;
let scaleActionId: string | undefined;
let colliderWireframe: THREE.Object3D | undefined;
let splatObject: THREE.Object3D | undefined;
// --- beat-flow state
let bundleDir: string | undefined;
let certStarted = false;
let certDone = false;
let introRevealed = false;
let beforeGrade: string | undefined; // first live grade — the Beat-5 "before"
let beforeDefectCount: number | undefined; // first survey's count — explains Beat-5's larger total

client.onPhase = (phase, detail) => {
  hud.status = phase === "ready" ? "ready" : `${phase.replace(/-/g, " ")}${detail ? ` — ${detail}` : ""}`;
  // narrator: humanized phase lines while the survey (Beat 2) or a Beat-4
  // recertify is running; other beats own their narration.
  if (stepper.current === 2 && !certDone) {
    narrateStanding(phaseLine(phase, PROBE_COUNT));
  } else if (stepper.current === 4) {
    if (phase === "recertifying") narrateStanding(phaseLine(phase, PROBE_COUNT));
    else if (phase === "ready") narrateStanding("");
  }
};

client.onTrustMap = (tm) => {
  trustLayer.paint(tm);
  setTrustDim(stepper.current === 5); // repaint resets the material opacity
  updateLegend(tm);
};

client.onDefects = (ev) => {
  hud.grade = ev.grade;
  hud.defects = ev.openDefectIds.length;
  updateLiveDefects(ev.defects);
};

// determinism chip: content SHA-256 from the worker after every (re)certify —
// the same bytes the CLI and report.html hash, so a live re-run matches the
// hash pre-printed on the Devpost
client.onHash = (hash) => certificatePanel.setHash(hash);

// ----------------------------------------------------- beat 1: intro card

const introCard = document.createElement("div");
introCard.className = "sv-intro";
const introWorld = document.createElement("div");
introWorld.className = "sv-intro-world";
introCard.appendChild(introWorld);
const introLine = document.createElement("div");
introLine.className = "sv-intro-line";
introLine.innerHTML = INTRO.line1Html; // static copy from humanize — safe
introCard.appendChild(introLine);
const introBtn = document.createElement("button");
introBtn.className = "sv-btn sv-btn-primary";
introBtn.textContent = INTRO.btn1;
introBtn.addEventListener("click", () => {
  introBtn.blur();
  onPrimaryBeat1();
});
introCard.appendChild(introBtn);
document.body.appendChild(introCard);

function onPrimaryBeat1(): void {
  if (!introRevealed) {
    introRevealed = true;
    if (colliderWireframe) colliderWireframe.visible = true;
    introLine.innerHTML = INTRO.line2Html;
    introBtn.textContent = INTRO.btn2;
    stepper.setPrimaryHint(HINT.startSurvey);
  } else {
    stepper.advance();
  }
}

// -------------------------------------------------- beat 2: trust legend

const legend = document.createElement("div");
legend.className = "sv-legend";
legend.style.display = "none";
function legendChip(cls: string, label: string): HTMLElement {
  const chip = document.createElement("div");
  chip.className = `sv-legend-chip ${cls}`;
  const dot = document.createElement("span");
  dot.className = "sv-legend-dot";
  chip.appendChild(dot);
  const lab = document.createElement("span");
  lab.textContent = label;
  chip.appendChild(lab);
  const count = document.createElement("span");
  count.className = "sv-legend-count";
  chip.appendChild(count);
  legend.appendChild(chip);
  return count;
}
const legendVerified = legendChip("sv-legend-verified", TRUST_LEGEND.verified);
const legendObserved = legendChip("sv-legend-observed", TRUST_LEGEND.observed);
const legendLying = legendChip("sv-legend-lying", TRUST_LEGEND.lying);
document.body.appendChild(legend);

function updateLegend(tm: TrustMapPayload): void {
  let verified = 0;
  let observed = 0;
  let lying = 0;
  for (const s of tm.states) {
    if (s === "verified") verified += 1;
    else if (s === "observed") observed += 1;
    else if (s === "lying") lying += 1;
  }
  legendVerified.textContent = verified.toLocaleString();
  legendObserved.textContent = observed.toLocaleString();
  legendLying.textContent = lying.toLocaleString();
}

// ---------------------------------------- beat 5: before/after + export

const beforeAfterCard = document.createElement("div");
beforeAfterCard.className = "sv-beforeafter";
beforeAfterCard.style.display = "none";
Object.assign(beforeAfterCard.style, { width: "100%", flex: "none" } satisfies Partial<CSSStyleDeclaration>);
sidebar.appendChild(beforeAfterCard);

function buildBeforeAfterCard(): void {
  beforeAfterCard.replaceChildren();
  if (!latestCert) return;
  const after = latestCert.grade;
  const before = beforeGrade ?? after;

  const grades = document.createElement("div");
  grades.className = "sv-beforeafter-grades";
  const b = document.createElement("span");
  b.className = `sv-beforeafter-letter sv-grade-${before}`;
  b.textContent = before;
  grades.appendChild(b);
  const arrow = document.createElement("span");
  arrow.className = "sv-beforeafter-arrow";
  arrow.textContent = "→";
  grades.appendChild(arrow);
  const a = document.createElement("span");
  a.className = `sv-beforeafter-letter sv-grade-${after}`;
  a.textContent = after;
  grades.appendChild(a);
  beforeAfterCard.appendChild(grades);

  const sub = document.createElement("div");
  sub.className = "sv-beforeafter-sub";
  for (const t of ["before", "after"]) {
    const s = document.createElement("span");
    s.textContent = t;
    sub.appendChild(s);
  }
  beforeAfterCard.appendChild(sub);

  const summary = beforeAfterSummary(latestCert, beforeDefectCount);
  const found = document.createElement("div");
  found.className = "sv-beforeafter-found";
  found.textContent = summary.found;
  beforeAfterCard.appendChild(found);
  if (summary.breakdown) {
    const breakdown = document.createElement("div");
    breakdown.className = "sv-beforeafter-breakdown";
    breakdown.textContent = summary.breakdown;
    beforeAfterCard.appendChild(breakdown);
  }

  const disclosure = document.createElement("div");
  disclosure.className = "sv-beforeafter-disclosure";
  disclosure.textContent = MODEL_CLASS_DISCLOSURE;
  beforeAfterCard.appendChild(disclosure);

  const buttons = document.createElement("div");
  buttons.className = "sv-beforeafter-buttons";
  const exportBtn = document.createElement("button");
  exportBtn.className = "sv-btn sv-btn-primary";
  exportBtn.textContent = BTN.export;
  exportBtn.addEventListener("click", () => {
    exportBtn.blur();
    downloadCertificate();
  });
  buttons.appendChild(exportBtn);
  beforeAfterCard.appendChild(buttons);
}

function downloadCertificate(): void {
  if (!latestCert) return;
  // export the FULL certificate (the artifact the CLI writes and the content
  // hash covers) — the compact summary is only a rendering shape
  void client
    .getFullCertificate()
    .catch(() => latestCert)
    .then((cert) => {
      const blob = new Blob([JSON.stringify(cert, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `certificate-${latestCert!.worldId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
}

// -------------------------------------------------- narrator + trust force

let standingNarration = "";
/** The line the narrator returns to after a flash. */
function narrateStanding(text: string): void {
  standingNarration = text;
  stepper.narrate(text);
}
let narrateFlashTimer: number | undefined;
/** 1.5s narrator flash (e.g. a refused forward jump), then restore. */
function flashNarrate(text: string): void {
  stepper.narrate(text);
  clearTimeout(narrateFlashTimer);
  narrateFlashTimer = window.setTimeout(() => stepper.narrate(standingNarration), 1500);
}

function setTrustVisible(on: boolean): void {
  if (trustLayer.visible !== on) trustLayer.toggle();
}

/** Beat 5 dims the trust map so the rover reads; repaints re-apply it. */
function setTrustDim(dim: boolean): void {
  const mesh = scene.getObjectByName("trust-map") as THREE.Mesh | undefined;
  if (!mesh) return;
  (mesh.material as THREE.MeshBasicMaterial).opacity = dim ? 0.17 : 0.42;
}

function ensureCertificationStarted(): void {
  if (certStarted || !bundleDir) return;
  certStarted = true;
  void startCertification(bundleDir);
}

// --------------------------------------------------------- twin run (C6)
// Raw-world failure run (Beats 1–3, key R) + Beat-5 delivery camera. The raw
// physics executes in the probe worker, which holds the collider exactly as
// shipped — repairs only ever mutate the certify engine's copy.
// C12: the raw-run planner reads the VISUAL floor (splat centers) to justify
// its crossing — built once the bundle's points load.

let visualGround: VisualGround | undefined;

const twinRun = createTwinRun({
  scene,
  camera,
  controls,
  getCollider: () => colliderWireframe,
  getVisualGround: () => visualGround,
  narrate: narrateStanding,
  flash: flashNarrate,
  setStatus: (t) => {
    hud.status = t;
  },
});

// ------------------------------------------------------------ the stepper

const stepper = mountStepper(document.body, {
  canEnter(beat) {
    if (beat <= 2) return true;
    if (beat <= 4) {
      if (!certDone) {
        flashNarrate(NARRATE.stillSurveying);
        return false;
      }
      return true;
    }
    if (!finalized) {
      flashNarrate(NARRATE.finishRepairsFirst);
      return false;
    }
    return true;
  },
  onPrimary(beat) {
    switch (beat) {
      case 1:
        onPrimaryBeat1();
        break;
      case 2:
        if (certDone) stepper.advance();
        else flashNarrate(NARRATE.stillSurveying);
        break;
      case 3:
        if (!skipGradeReveal()) stepper.advance();
        break;
      case 4:
        if (finalized) stepper.advance();
        else {
          startMissionLogReplay(); // the recorded agent narrates…
          repairPanel.runAll(); // …while the live engine executes the plan
        }
        break;
      case 5:
        togglePatrol();
        break;
    }
  },
  onEnter(beat, from) {
    applyBeat(beat, from);
  },
});

/** Visibility matrix per beat (spec §3.1). Called on every beat change. */
function applyBeat(beat: Beat, from: Beat): void {
  introCard.style.display = beat === 1 ? "" : "none";
  legend.style.display = beat === 2 ? "" : "none";
  sidebar.style.display = beat >= 3 ? "flex" : "none";
  repairPanel.el.style.display = beat === 4 ? "" : "none";
  missionLog.el.style.display = beat === 4 ? "" : "none";
  if (beat === 4) missionLog.resume();
  else missionLog.pause(); // never narrate over other beats (no-op before start)
  beforeAfterCard.style.display = beat === 5 ? "" : "none";
  certificatePanel.setCompact(beat >= 4);

  // twin run (C6): the untouched raw physics only exists during Beats 1–3
  // (repairs mutate the engine's collider and rescale the viewer from Beat 4)
  const rawPossible = beat <= 3 && viewerScale === 1;
  twinRun.setAvailability(rawPossible, rawPossible ? undefined : NARRATE.rawRunUnavailable);
  if (beat > 3) twinRun.stopRaw();
  if (beat !== 5) twinRun.stopFollow();

  // trust map per beat; the T key stays a free toggle within a beat
  setTrustVisible(beat !== 1);
  setTrustDim(beat === 5);

  switch (beat) {
    case 1:
      narrateStanding("");
      stepper.setPrimaryHint(introRevealed ? HINT.startSurvey : HINT.revealPhysics);
      break;
    case 2:
      ensureCertificationStarted();
      if (certDone) {
        narrateStanding(NARRATE.surveyDone);
        stepper.setPrimaryHint(HINT.seeCertificate);
        stepper.armAdvance(true);
      } else {
        narrateStanding(phaseLine("certifying", PROBE_COUNT));
        stepper.setPrimaryHint("");
      }
      break;
    case 3:
      narrateStanding("");
      stepper.setPrimaryHint(HINT.proposeRepairs);
      if (from < 3 && latestCert) {
        // the sidebar appears when the grade letter flies into it
        sidebar.style.display = "none";
        void showGradeReveal(latestCert.grade, gradeStory(latestCert.grade)).then(() => {
          if (stepper.current >= 3) sidebar.style.display = "flex";
        });
      }
      break;
    case 4:
      narrateStanding("");
      if (finalized) {
        stepper.setPrimaryHint(HINT.seeVerdict);
        stepper.armAdvance(true);
      } else {
        stepper.setPrimaryHint(HINT.runPlan);
      }
      break;
    case 5:
      buildBeforeAfterCard();
      narrateStanding(NARRATE.delivery);
      stepper.setPrimaryHint(HINT.delivery);
      if (!patrolHandle && spawnsCache) beginPatrol();
      break;
  }
}

// boot: Beat 1's visibility, then restore the persisted dev toggle
applyBeat(1, 1);
try {
  if (localStorage.getItem(DEV_KEY) === "1") setDevMode(true);
} catch {
  /* no persistence available */
}

// ------------------------------------------------------ certificate apply

function isOpenDefect(d: DefectSummary): boolean {
  return !d.outcome || d.outcome === "OPEN";
}

/** Single sink for every refreshed certificate: panel, HUD, defect boxes. */
function applyCertificate(cert: CertificateSummary): void {
  latestCert = cert;
  certificatePanel.update(cert);
  hud.grade = cert.grade;
  hud.defects = cert.defects.filter(isOpenDefect).length;
  updateLiveDefects(cert.defects);
  twinRun.setCertificate(cert); // raw-run route follows the freshest survey
}

async function refreshFloorY(): Promise<void> {
  try {
    const res = await client.queryMeasurement("floor_plane_height");
    if (Array.isArray(res) && res.length > 0) trustLayer.setFloorY(res[0].value);
  } catch {
    /* keep the previous floor height */
  }
}

// -------------------------------------------------------------- overlays

function addRegionBox(
  group: THREE.Group,
  min: number[],
  max: number[],
  color: number,
  fillOpacity: number,
): void {
  const lo = new THREE.Vector3(min[0], min[1], min[2]);
  const hi = new THREE.Vector3(max[0], max[1], max[2]);
  const size = new THREE.Vector3().subVectors(hi, lo).max(new THREE.Vector3(0.02, 0.02, 0.02));
  const center = new THREE.Vector3().addVectors(lo, hi).multiplyScalar(0.5);
  const boxGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
  const fill = new THREE.Mesh(
    boxGeom,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.position.copy(center);
  group.add(fill);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeom),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
  edges.position.copy(center);
  group.add(edges);
}

/** Pre-survey overlay from the bundle's static certificate.json (viewer coords → worldGroup). */
function buildStaticDefectBoxes(cert: Certificate): THREE.Group {
  const group = new THREE.Group();
  group.name = "defects-static";
  const RANK: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  const capped = [...(cert.defects ?? [])]
    .sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3))
    .slice(0, 200);
  for (const d of capped) {
    addRegionBox(
      group,
      d.region.min,
      d.region.max,
      SEVERITY_COLOR[d.severity] ?? 0xff3b30,
      d.severity === "critical" ? 0.28 : 0.16,
    );
  }
  return group;
}

let staticDefectGroup: THREE.Group | undefined;
let liveDefectGroup: THREE.Group | undefined;
let defectBoxesVisible = false; // pretty world by default — B opts into the overlay

/**
 * Live overlay from the certify worker (engine coords → scene root).
 * Open defects keep severity colors; quarantined regions stay visible in
 * purple (the rover routes AROUND them); fixed defects disappear.
 */
function updateLiveDefects(defects: DefectSummary[]): void {
  liveDefectGroup?.removeFromParent();
  staticDefectGroup?.removeFromParent();
  staticDefectGroup = undefined;

  const group = new THREE.Group();
  group.name = "defects-live";
  // never let a pathological certificate bury the world: render the most
  // severe boxes only, and say how many are hidden
  const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  const MAX_BOXES = 200;
  const sorted = [...defects].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3),
  );
  const shown = sorted.slice(0, MAX_BOXES);
  if (defects.length > MAX_BOXES) {
    hud.status = `defect boxes: showing ${MAX_BOXES} most severe of ${defects.length}`;
  }
  for (const d of shown) {
    if (!d.region) continue;
    const outcome = d.outcome && d.outcome !== "OPEN" ? String(d.outcome) : "OPEN";
    if (outcome === "fixed") continue;
    const color =
      outcome === "OPEN"
        ? (SEVERITY_COLOR[d.severity] ?? 0xff3b30)
        : (OUTCOME_COLOR[outcome] ?? 0x8a93a8);
    const opacity = outcome === "OPEN" ? (d.severity === "critical" ? 0.28 : 0.16) : 0.07;
    addRegionBox(group, d.region.min, d.region.max, color, opacity);
  }
  group.visible = defectBoxesVisible;
  scene.add(group);
  liveDefectGroup = group;
}

function setDefectBoxes(on: boolean): void {
  defectBoxesVisible = on;
  if (staticDefectGroup) staticDefectGroup.visible = on;
  if (liveDefectGroup) liveDefectGroup.visible = on;
}

function toggleDefectBoxes(): void {
  setDefectBoxes(!defectBoxesVisible);
}

let defectFlashTimer: number | undefined;

/** Fail-and-adapt: force the boxes on for a beat so the new defect reads. */
function flashDefectBoxes(ms: number): void {
  if (defectBoxesVisible) return; // the user already has them on — leave them
  setDefectBoxes(true);
  clearTimeout(defectFlashTimer);
  defectFlashTimer = window.setTimeout(() => setDefectBoxes(false), ms);
}

// -------------------------------------------------------------- rescaling

/**
 * apply_vendor_scale bakes a metric factor into the engine's world; scale the
 * viewer's world group to match and keep the camera framing visually stable.
 */
function applyViewerScale(factor: number): void {
  const rel = factor / viewerScale;
  if (rel === 1) return;
  viewerScale = factor;
  worldGroup.scale.setScalar(factor);
  worldGroup.updateMatrixWorld(true);
  controls.target.multiplyScalar(rel);
  camera.position.multiplyScalar(rel);
  camera.near *= rel;
  camera.far *= rel;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------- repair driver
// Bridges the repair panel's RepairDriver contract onto the certify worker:
// each mutating step runs the engine tool AND the verifying recertify, so the
// panel can detect fail-and-adapt (recertify.newDefects.length > 0).

function makeRepairDriver(c: CertifyWorkerClient): RepairDriver {
  return {
    async runStep(step: RepairStep): Promise<StepResult> {
      const log: string[] = [];
      let actionId: string | undefined;
      let actionIds: string[] | undefined;
      let recertify: RecertifyResult | undefined;
      let replan = false;

      switch (step.kind) {
        case "apply_vendor_scale": {
          const before = await c.queryMeasurement("doorway_width");
          const r = await c.applyVendorScale();
          actionId = r.actionId;
          scaleActionId = r.actionId;
          log.push(
            `vendor scale ×${r.factorApplied.toFixed(3)} applied — re-measuring the whole world (full recertify)`,
          );
          applyViewerScale(r.factorApplied);
          // Full recertify at the corrected scale. Findings (re)measured at the
          // new scale are NOT a caught repair — the trace-verified flow is:
          // recertify(full) → get_certificate → re-plan (StepResult.replan).
          const rec = await c.recertify("full");
          await refreshFloorY();
          const after = await c.queryMeasurement("doorway_width");
          if (Array.isArray(before) && before.length > 0 && Array.isArray(after) && after.length > 0) {
            log.push(`doorway_width re-measured: ${before[0].value.toFixed(2)} m → ${after[0].value.toFixed(2)} m`);
          }
          log.push(
            `recertify (full) at corrected scale: grade ${rec.grade} · ${rec.resolvedDefectIds.length} defect(s) resolved by the transform · ${rec.newDefects.length} finding(s) re-measured at the new scale · ${rec.openDefects?.length ?? 0} open`,
          );
          replan = true;
          break;
        }
        case "patch_hole": {
          const defectId = step.defectIds[0];
          if (!defectId) return { ok: false, error: "patch step carries no defectId" };
          const method = step.method ?? "fitted_slab";
          const r = await c.patchHole(defectId, method);
          actionId = r.actionId;
          log.push(
            `${method} patch on ${defectId} (slab top y = ${r.slabTopY.toFixed(3)} m) — regional recertify to verify`,
          );
          recertify = await c.recertify("regional", defectId);
          await refreshFloorY();
          break;
        }
        case "quarantine": {
          const r = await c.quarantine(
            step.defectIds,
            step.reason ?? "quarantined from repair panel",
          );
          actionIds = r.actionIds;
          actionId = r.actionIds[r.actionIds.length - 1];
          log.push(
            `quarantined ${r.defectIds.length} region(s) — excluded from the navigable area; no training episode touches the divergent region`,
          );
          break;
        }
        case "accept_defect": {
          const r = await c.acceptDefect(step.defectIds, step.reason ?? "accepted — verdict stands");
          log.push(
            `accepted ${r.defectIds.length} defect(s) — robot-relative verdict stands, no repair`,
          );
          break;
        }
        default:
          return { ok: false, error: `unknown step kind '${(step as RepairStep).kind}'` };
      }

      const certificate: CertificateSummary = await c.getCertificate();
      latestCert = certificate;
      maybeFinalize(certificate, recertify);
      return { ok: true, actionId, actionIds, log, recertify, certificate, replan };
    },

    async revert(actionId: string): Promise<StepResult> {
      const r = await c.revert(actionId);
      if (actionId === scaleActionId) {
        applyViewerScale(1);
        scaleActionId = undefined;
      }
      const certificate: CertificateSummary = await c.getCertificate();
      latestCert = certificate;
      return {
        ok: true,
        log: [`reverted ${r.reverted} (stack discipline: later actions revert too)`],
        certificate,
      };
    },
  };
}

// ------------------------------------------------- finalize → rover patrol

/**
 * End-of-plan sweep. Findings discovered DURING repair verification stay open
 * in the engine ledger (recertify newDefects survive reverts) and are not part
 * of the scripted plan — resolve them per policy, exactly like the recorded
 * real-world episode: accept robot-relative findings, quarantine the rest.
 */
async function sweepRemaining(): Promise<void> {
  if (finalized) return;
  try {
    const cert: CertificateSummary = await client.getCertificate();
    const open = cert.defects.filter(isOpenDefect);
    if (open.length === 0) {
      maybeFinalize(cert);
      return;
    }
    repairPanel.log(
      `${open.length} finding(s) still open (discovered during repair verification) — bulk-resolving per policy`,
      "warn",
    );
    const acceptTypes = new Set(["raised_sill", "clearance_violation"]);
    const toAccept = open.filter((d) => acceptTypes.has(d.type)).map((d) => d.id);
    const toQuarantine = open.filter((d) => !acceptTypes.has(d.type)).map((d) => d.id);
    if (toAccept.length > 0) {
      await client.acceptDefect(toAccept, "robot-relative negotiability — the verdict stands, no repair needed");
      repairPanel.log(`accepted ${toAccept.length} robot-relative finding(s) — the verdicts stand`);
    }
    if (toQuarantine.length > 0) {
      await client.quarantine(
        toQuarantine,
        "unrepairable or repair-resistant region — excluded from the navigable area",
      );
      repairPanel.log(`quarantined ${toQuarantine.length} region(s) — excluded from the navigable area`);
    }
    const fresh: CertificateSummary = await client.getCertificate();
    applyCertificate(fresh);
    maybeFinalize(fresh);
  } catch (err) {
    repairPanel.log(`sweep failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
  }
}

/** When every defect has an outcome: final full recertify → spawns → patrol. */
function maybeFinalize(cert: CertificateSummary, recertify?: RecertifyResult): void {
  if (finalized) return;
  if (recertify && recertify.newDefects.length > 0) return; // fail-and-adapt in progress
  if (cert.defects.some(isOpenDefect)) return;
  finalized = true;
  // Detach so the repair panel finishes rendering the step first.
  setTimeout(() => {
    void finalizeAndPatrol();
  }, 0);
}

let finalizePasses = 0;
const MAX_FINALIZE_PASSES = 3;

async function finalizeAndPatrol(): Promise<void> {
  try {
    if (stepper.current === 4) narrateStanding(NARRATE.resolving);
    repairPanel.log("all defects have outcomes — final FULL recertify to grade the repaired world…");
    const rec = await client.recertify("full");
    await refreshFloorY();
    const cert: CertificateSummary = await client.getCertificate();
    applyCertificate(cert);
    repairPanel.setPlan(cert);
    repairPanel.log(
      `final grade: ${rec.grade} · ${rec.openDefects?.length ?? 0} open defects`,
      rec.newDefects.length === 0 ? "ok" : "warn",
    );
    if (rec.newDefects.length > 0) {
      finalizePasses += 1;
      finalized = false;
      if (finalizePasses < MAX_FINALIZE_PASSES) {
        repairPanel.log(
          `final recertify surfaced ${rec.newDefects.length} new finding(s) — the instrument re-checks its own repairs; resolving and re-grading (pass ${finalizePasses}/${MAX_FINALIZE_PASSES})`,
          "warn",
        );
        await sweepRemaining();
        return;
      }
      repairPanel.log("new findings keep surfacing — patrol on hold, review the plan", "warn");
      return;
    }
    const sp = await client.rebuildSpawns();
    spawnsCache = sp.spawns;
    repairPanel.log(`navmesh + spawns rebuilt: ${sp.spawns.length} verified spawn points`, "ok");
    // NOTE (C6): the delivery run starts when Beat 5 is ENTERED — departure
    // and arrival are witnessed, instead of the rover looping in the background.
    if (stepper.current === 4) {
      narrateStanding(NARRATE.recertified);
      stepper.setPrimaryHint(HINT.seeVerdict);
      stepper.armAdvance(true);
    }
  } catch (err) {
    repairPanel.log(`finalize failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
    finalized = false;
  }
}

function beginPatrol(): void {
  patrolHandle?.stop();
  patrolHandle = undefined;
  if (!spawnsCache || spawnsCache.length < 2) {
    repairPanel.log("not enough spawn points to patrol", "warn");
    return;
  }
  const quarantine: PatrolAabb[] = [];
  const patched: PatrolAabb[] = [];
  for (const d of latestCert?.defects ?? []) {
    if (!d.region) continue;
    const box: PatrolAabb = {
      min: [d.region.min[0], d.region.min[1], d.region.min[2]],
      max: [d.region.max[0], d.region.max[1], d.region.max[2]],
    };
    if (d.outcome === "quarantined") quarantine.push(box);
    else if (d.outcome === "fixed") patched.push(box);
  }
  // C6: start→goal delivery — first verified spawn to the farthest verified
  // spawn (the depot), over patched floor, around the roped-off regions.
  patrolHandle = startPatrol(scene, {
    spawns: spawnsCache,
    quarantine,
    patched,
    mode: "delivery",
    collider: colliderWireframe,
    showLabel: false, // sidebar owns the bottom-right corner; HUD carries the honesty line
    onArrive: () => {
      if (stepper.current === 5) narrateStanding(NARRATE.deliveryArrived);
      hud.status = "delivery complete — certified route held end to end";
      repairPanel.log("delivery complete — the certified route held end to end", "ok");
    },
  });
  hud.status = "rover delivery: navmesh waypoint-following (not a learned policy)";
  if (stepper.current === 5) {
    narrateStanding(NARRATE.delivery);
    twinRun.followDelivery(patrolHandle.rover, patrolHandle.waypoints);
  }
  repairPanel.log(
    `rover delivery started — ${patrolHandle.waypoints.length} waypoints, spawn → depot, over ${patched.length} patch(es), around ${quarantine.length} quarantined region(s) [P toggles]`,
    "ok",
  );
}

// ---------------------------------------------------------- certification

async function startCertification(dir: string): Promise<void> {
  try {
    repairPanel.log(`survey starting: ${dir} (seed ${CERTIFY_SEED}, ${PROBE_COUNT} probes)`);
    const res = await client.initBundle(dir, { seed: CERTIFY_SEED, probeCount: PROBE_COUNT });
    const cert: CertificateSummary = res.certificate;
    applyCertificate(cert);
    if (beforeGrade === undefined) beforeGrade = cert.grade; // the Beat-5 "before"
    if (beforeDefectCount === undefined) beforeDefectCount = cert.defects.length;
    repairPanel.setPlan(cert);
    const open = cert.defects.filter(isOpenDefect).length;
    repairPanel.log(
      `survey complete — grade ${cert.grade}, ${cert.defects.length} defect(s), ${open} open`,
      open > 0 ? "warn" : "ok",
    );
    if (open > 0) repairPanel.log("review the proposed plan below, then Run All (or execute step by step)");
    await refreshFloorY();
    hud.status = "survey complete — certificate panel is live";
    certDone = true;
    if (stepper.current === 2) {
      narrateStanding(NARRATE.surveyDone);
      stepper.setPrimaryHint(HINT.seeCertificate);
      stepper.armAdvance(true);
    }
    maybeFinalize(cert);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hud.status = `certification failed: ${msg}`;
    narrateStanding(NARRATE.surveyFailed);
    repairPanel.log(`certification failed: ${msg}`, "warn");
  }
}

// -------------------------------------------------------- collider loading

interface TriSoup {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Bake world transforms and merge every mesh primitive into one soup. */
function extractTriSoup(root: THREE.Object3D): TriSoup {
  root.updateMatrixWorld(true);
  const parts: Array<{ pos: Float32Array; idx: Uint32Array }> = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute("position");
    if (!posAttr) return;
    const pos = new Float32Array(posAttr.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
    }
    let idx: Uint32Array;
    if (geom.index) {
      idx = Uint32Array.from(geom.index.array);
    } else {
      idx = new Uint32Array(posAttr.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
    }
    parts.push({ pos, idx });
  });
  let vtx = 0;
  let ind = 0;
  for (const p of parts) {
    vtx += p.pos.length;
    ind += p.idx.length;
  }
  const positions = new Float32Array(vtx);
  const indices = new Uint32Array(ind);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.pos, vo);
    for (let i = 0; i < p.idx.length; i++) indices[io + i] = p.idx[i]! + vo / 3;
    vo += p.pos.length;
    io += p.idx.length;
  }
  return { positions, indices };
}

// ------------------------------------------------------------ probe render

const probeGeom = new THREE.SphereGeometry(PROBE_RADIUS, 8, 6);
const probeMat = new THREE.MeshBasicMaterial({ color: 0x4dd2ff });
const probeMesh = new THREE.InstancedMesh(probeGeom, probeMat, PROBE_COUNT);
probeMesh.frustumCulled = false;
probeMesh.count = 0;
worldGroup.add(probeMesh);

const tmpMat = new THREE.Matrix4();

function updateProbes(positions: Float32Array): void {
  const n = Math.min(positions.length / 3, PROBE_COUNT);
  probeMesh.count = n;
  for (let i = 0; i < n; i++) {
    tmpMat.makeTranslation(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    probeMesh.setMatrixAt(i, tmpMat);
  }
  probeMesh.instanceMatrix.needsUpdate = true;
}

function buildPointsCloud(points: Float32Array): THREE.Points {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(points, 3));
  // Color by height for legibility on the demo laptop projector.
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const colors = new Float32Array(points.length);
  const span = Math.max(bb.max.y - bb.min.y, 1e-6);
  const c = new THREE.Color();
  for (let i = 0; i < points.length; i += 3) {
    const t = (points[i + 1]! - bb.min.y) / span;
    c.setHSL(0.6 - 0.5 * t, 0.55, 0.38 + 0.3 * t);
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.015, vertexColors: true, sizeAttenuation: true });
  return new THREE.Points(geom, mat);
}

// ----------------------------------------------------------------- worker

function startPhysics(soup: TriSoup): void {
  const worker = new Worker(new URL("./physicsWorker.ts", import.meta.url), { type: "module" });

  let lastStepCount = 0;
  let lastStepTime = performance.now();

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    if (msg.kind === "ready") {
      hud.probes = msg.probeCount;
    } else if (msg.kind === "frame") {
      updateProbes(msg.probePositions);
      const now = performance.now();
      const dt = (now - lastStepTime) / 1000;
      if (dt >= 0.5) {
        hud.workerSps = (msg.stepCount - lastStepCount) / dt;
        lastStepCount = msg.stepCount;
        lastStepTime = now;
      }
    } else if (msg.kind === "rover_frame") {
      twinRun.onRoverFrame(msg);
    } else if (msg.kind === "rover_done") {
      twinRun.onRoverDone(msg);
    } else if (msg.kind === "rover_probe_result") {
      twinRun.onRoverProbeResult(msg);
    } else if (msg.kind === "error") {
      hud.status = `probe worker error: ${msg.message}`;
    }
  };
  worker.onerror = (e) => {
    hud.status = `probe worker failed: ${e.message}`;
  };

  // twin run (C6): the raw-world rover run executes in THIS worker — it holds
  // the collider exactly as shipped, untouched by repairs.
  twinRun.attachPhysics((m) => worker.postMessage(m));

  const init: InitMsg = {
    kind: "init",
    positions: soup.positions,
    indices: soup.indices,
    probeCount: PROBE_COUNT,
    probeRadius: PROBE_RADIUS,
    dropHeight: DROP_HEIGHT,
    gravityY: GRAVITY_Y,
    seed: 1234,
  };
  worker.postMessage(init, [soup.positions.buffer, soup.indices.buffer]);
}

// ------------------------------------------------------------------- keys
// W/T/P/B/F/I are unchanged; the stepper owns →/←/N/1-5/Space/Enter; D is
// the dev overlay. All handlers ignore events aimed at focused controls.

function togglePatrol(): void {
  if (patrolHandle) {
    patrolHandle.stop();
    patrolHandle = undefined;
    twinRun.stopFollow();
    hud.status = "patrol stopped";
    if (stepper.current === 5) narrateStanding(NARRATE.patrolStopped);
  } else if (spawnsCache) {
    beginPatrol();
  } else {
    hud.status = "building navmesh spawns for patrol…";
    client
      .rebuildSpawns()
      .then((sp) => {
        spawnsCache = sp.spawns;
        beginPatrol();
      })
      .catch((err: unknown) => {
        hud.status = `spawns failed: ${err instanceof Error ? err.message : String(err)}`;
      });
  }
}

addEventListener("keydown", (e) => {
  if (isUiKeyTarget(e)) return;
  const k = e.key.toLowerCase();
  if (k === "w") {
    if (colliderWireframe) colliderWireframe.visible = !colliderWireframe.visible;
  } else if (k === "d") {
    setDevMode(!devMode);
  } else if (k === "b") {
    toggleDefectBoxes();
  } else if (k === "f") {
    // .spz files are y-down; flip if the visuals look upside-down relative
    // to the collider. Applies to whichever visual object is active.
    if (splatObject) splatObject.rotateX(Math.PI);
  } else if (k === "t") {
    const on = trustLayer.toggle();
    hud.status = `trust map ${on ? "on" : "off"}${trustLayer.painted ? "" : " (paints when the survey streams states)"}`;
  } else if (k === "p") {
    togglePatrol();
  } else if (k === "r") {
    // twin run (C6): raw-world failure run — Beats 1–3 only
    twinRun.trigger();
  }
});

// ------------------------------------------------------------------- main

async function loadSplats(dir: string): Promise<THREE.Object3D | undefined> {
  const url = await findSplatUrl(dir);
  if (!url) return undefined;
  try {
    const spark = await import("@sparkjsdev/spark");
    // Spark's renderer must be in the scene BEFORE splat meshes render —
    // auto-insertion can never trigger (three skips onBeforeRender for
    // empty meshes), so we add it explicitly per the Spark quickstart.
    if (!scene.getObjectByName("spark-renderer")) {
      const sparkRenderer = new spark.SparkRenderer({ renderer });
      sparkRenderer.name = "spark-renderer";
      scene.add(sparkRenderer);
    }
    const splat = new spark.SplatMesh({ url });
    await splat.initialized;
    // SPZ declares y-down; Spark converts to y-up on load — but Marble's
    // collider GLB (and our probe/trust frames) already match the RAW spz
    // coordinates, so Spark's conversion flips the visuals relative to the
    // physics. Rotate back so both files share one frame. Key F re-flips.
    splat.rotateX(Math.PI);
    hud.visualMode = `splats (${url.split("/").pop()})`;
    return splat;
  } catch (err) {
    console.warn("Spark splat load failed, falling back to point cloud:", err);
    return undefined;
  }
}

async function main(): Promise<void> {
  const dir = resolveBundleDir();
  bundleDir = dir; // Beat 2 owns startCertification(dir)
  hud.worldId = dir.split("/").pop() ?? dir;

  const [metadata, certificate] = await Promise.all([fetchMetadata(dir), fetchCertificate(dir)]);
  if (metadata?.worldId) hud.worldId = metadata.worldId.slice(0, 8);
  introWorld.textContent = hud.worldId;

  // --- collider ---
  try {
    const gltf = await new GLTFLoader().loadAsync(`${dir}/collider.glb`);
    const soup = extractTriSoup(gltf.scene);
    hud.triangles = soup.indices.length / 3;

    const wfGeom = new THREE.BufferGeometry();
    // The soup buffers are about to be transferred to the worker — copy them
    // for the wireframe first.
    wfGeom.setAttribute("position", new THREE.BufferAttribute(soup.positions.slice(), 3));
    wfGeom.setIndex(new THREE.BufferAttribute(soup.indices.slice(), 1));
    const wireframe = new THREE.Mesh(
      wfGeom,
      // DoubleSide is load-bearing: the twin run raycasts THIS mesh to derive
      // routes, and three's Raycaster respects material.side — FrontSide
      // silently misses floors whose torn-mesh triangles wind away, which
      // starves route derivation (Rapier's castDown has no such blindness).
      new THREE.MeshBasicMaterial({
        color: 0x3bd6c6,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    wireframe.name = "collider-wireframe";
    // pretty world first — the Beat-1 "Reveal the physics" (or W) shows it;
    // honor a reveal that happened while the collider was still loading
    wireframe.visible = introRevealed;
    worldGroup.add(wireframe);
    colliderWireframe = wireframe;

    // Start the camera INSIDE the world at eye height — splat worlds are
    // captured from within; from outside you see the dark backs of the
    // gaussians and only the wireframe reads. Key I toggles inside/orbit.
    const bb = new THREE.Box3().setFromBufferAttribute(wfGeom.getAttribute("position") as THREE.BufferAttribute);
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const radius = size.length() / 2 || 5;
    // find the real walkable surface by raycasting down near the center —
    // outdoor worlds carry background geometry far below the playable
    // surface, so "AABB floor + eye height" can put the camera underground
    const surfaceProbe = new THREE.Raycaster();
    const surfaceHits: number[] = [];
    for (const [fx, fz] of [[0.5, 0.5], [0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.5, 0.6]] as const) {
      const px = bb.min.x + size.x * fx;
      const pz = bb.min.z + size.z * fz;
      surfaceProbe.set(new THREE.Vector3(px, bb.max.y + 1, pz), new THREE.Vector3(0, -1, 0));
      const hit = surfaceProbe.intersectObject(wireframe, false)[0];
      if (hit) surfaceHits.push(hit.point.y);
    }
    surfaceHits.sort((a, b) => a - b);
    // Prefer the WORLD ORIGIN: Marble generates every world around (0,0,0) —
    // the capture viewpoint — and splat fidelity decays away from it. Probe
    // the surface at the origin first; AABB-center probes are the fallback.
    surfaceProbe.set(new THREE.Vector3(0, bb.max.y + 1, 0), new THREE.Vector3(0, -1, 0));
    const originHit = surfaceProbe.intersectObject(wireframe, false)[0];
    const surfaceY =
      originHit?.point.y ??
      (surfaceHits.length > 0 ? surfaceHits[Math.floor(surfaceHits.length / 2)] : bb.min.y);
    const eyeY = surfaceY + Math.min(1.6, size.y * 0.6); // eye height above the REAL surface
    const longAxis = size.x >= size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    // stand at the capture origin, look toward the world's content
    const inside = new THREE.Vector3(0, eyeY, 0);
    const lookDir = new THREE.Vector3(center.x, 0, center.z);
    if (lookDir.lengthSq() < 0.25) lookDir.copy(longAxis); // content centered on origin — look down the long axis
    lookDir.normalize();
    const orbit = center.clone().add(new THREE.Vector3(radius * 0.9, radius * 0.7, radius * 0.9));
    // splat fidelity decays away from the capture region — keep orbiting
    // inside it instead of letting the camera fly out to where gaussians smear
    controls.maxDistance = Math.max(3, radius * 0.6);
    camera.position.copy(inside);
    controls.target.copy(new THREE.Vector3(0, eyeY, 0).addScaledVector(lookDir, Math.max(3, radius * 0.3)));
    camera.near = Math.max(radius / 1000, 0.01);
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    let insideView = true;
    addEventListener("keydown", (e) => {
      if (isUiKeyTarget(e)) return;
      if (e.key.toLowerCase() !== "i") return;
      insideView = !insideView;
      camera.position.copy(insideView ? inside : orbit);
      controls.target.copy(insideView ? new THREE.Vector3(0, eyeY, 0).addScaledVector(lookDir, Math.max(3, radius * 0.3)) : center);
    });

    startPhysics(soup);
  } catch (err) {
    hud.status = `collider.glb failed: ${String(err)}`;
  }

  // --- visuals: splats, else points ---
  // re-anchor the camera to the splat-density centroid: worlds are captured
  // around their content, and standing where the visual mass is guarantees
  // we are inside the fidelity envelope (origin/AABB heuristics both failed
  // on worlds whose content is offset)
  const pointsForCam = await fetchVisualPoints(dir);
  if (pointsForCam && pointsForCam.length >= 3) {
    // C12: the vision planner's surface — same splat centers the camera
    // anchoring uses, gridded into a queryable visual-floor heightfield
    visualGround = buildVisualGround(pointsForCam);
    // densest vertical slab = the ground mass (naive centroids get dragged
    // under the surface by sky/background splats)
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 1; i < pointsForCam.length; i += 3) {
      if (pointsForCam[i] < yMin) yMin = pointsForCam[i];
      if (pointsForCam[i] > yMax) yMax = pointsForCam[i];
    }
    const BINS = 40;
    const binH = Math.max(1e-6, (yMax - yMin) / BINS);
    const counts = new Array(BINS).fill(0);
    for (let i = 1; i < pointsForCam.length; i += 3) {
      counts[Math.min(BINS - 1, Math.floor((pointsForCam[i] - yMin) / binH))]++;
    }
    const mode = counts.indexOf(Math.max(...counts));
    const y0 = yMin + (mode - 1) * binH, y1 = yMin + (mode + 2) * binH;
    // 2D density peak within the ground band: averages get pulled to the
    // center of ring-shaped background shells (empty space); the argmax
    // XZ cell is on the actual terrain by construction
    const cellsXZ = new Map<string, { n: number; sx: number; sy: number; sz: number }>();
    const CELL = 1.0;
    for (let i = 0; i < pointsForCam.length; i += 3) {
      const y = pointsForCam[i + 1];
      if (y < y0 || y > y1) continue;
      const k = `${Math.floor(pointsForCam[i] / CELL)},${Math.floor(pointsForCam[i + 2] / CELL)}`;
      let c = cellsXZ.get(k);
      if (!c) { c = { n: 0, sx: 0, sy: 0, sz: 0 }; cellsXZ.set(k, c); }
      c.n++; c.sx += pointsForCam[i]; c.sy += y; c.sz += pointsForCam[i + 2];
    }
    let best: { n: number; sx: number; sy: number; sz: number } | undefined;
    for (const c of cellsXZ.values()) if (!best || c.n > best.n) best = c;
    if (best && best.n > 30) {
      const cx = best.sx / best.n, gy = best.sy / best.n, cz = best.sz / best.n;
      camera.position.set(cx, gy + 1.6, cz);
      // look toward the overall band mass so the view faces the content
      let tx = 0, tz = 0, tn = 0;
      for (const c of cellsXZ.values()) { tx += c.sx; tz += c.sz; tn += c.n; }
      controls.target.set(tn > 0 ? tx / tn : cx + 3, gy + 1.2, tn > 0 ? tz / tn : cz);
      if (camera.position.distanceTo(controls.target) < 1) controls.target.set(cx + 3, gy + 1.2, cz);
    }
  }

  splatObject = await loadSplats(dir);
  (window as unknown as Record<string, unknown>).__dbg = { scene, worldGroup, camera, renderer, client, twinRun, THREE, get splat() { return splatObject; } };
  if (splatObject) {
    worldGroup.add(splatObject);
  } else {
    const points = await fetchVisualPoints(dir);
    if (points && points.length > 0) {
      const cloud = buildPointsCloud(points);
      cloud.name = "visual-points";
      worldGroup.add(cloud);
      splatObject = cloud;
      hud.visualMode = `points (${(points.length / 3).toLocaleString()} splat centers)`;
    } else {
      hud.visualMode = "none (no .spz, no visual-points.f32)";
    }
  }

  // --- static certificate overlay (replaced once the live survey lands) ---
  if (certificate) {
    // twin run (C6): until the live survey lands, the raw-run route derives
    // from the bundle's canonical certificate — same defects, same coords.
    twinRun.setCertificate(certificate);
    hud.grade = certificate.grade ?? "-";
    hud.defects = certificate.defects?.length ?? 0;
    staticDefectGroup = buildStaticDefectBoxes(certificate);
    staticDefectGroup.visible = defectBoxesVisible;
    worldGroup.add(staticDefectGroup);
    const floor = certificate.measurements?.find((m) => m.name === "floor_plane_height");
    const floorY = floor?.value ?? metadata?.groundPlaneY ?? 0;
    trustLayer.setFloorY(floorY);
    if (floor) {
      const grid = new THREE.GridHelper(20, 40, 0x2a3142, 0x1a2030);
      grid.position.y = floor.value;
      worldGroup.add(grid);
    }
    // Keep the shipped certificate's data (grid, floor, static boxes) but do
    // NOT feed the panel — the grade reveal is Beat 3's moment, and only the
    // live survey's certificate (Beat 2) is ever displayed.
  } else {
    hud.grade = "no certificate.json";
    trustLayer.setFloorY(metadata?.groundPlaneY ?? 0);
  }

  if (hud.status === "loading bundle…") hud.status = "bundle loaded — Beat 2 starts the survey";

  // NOTE: the live certification no longer starts at boot — Beat 2's onEnter
  // calls ensureCertificationStarted() so the trust-map paint is witnessed.
}

// ------------------------------------------------------------- render loop

let frames = 0;
let fpsWindowStart = performance.now();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsWindowStart >= 500) {
    hud.renderFps = (frames * 1000) / (now - fpsWindowStart);
    frames = 0;
    fpsWindowStart = now;
  }
});

main().catch((err: unknown) => {
  hud.status = `fatal: ${String(err)}`;
});
