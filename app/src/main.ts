/**
 * Surveyor viewer — main thread (integrated demo app).
 *
 * Boot flow (docs/demo-five-beats.md):
 *   load bundle (?world=/marble/<id>) → spawn the certify worker (the REAL
 *   headless certify/repair core in the browser) → progress overlay while the
 *   survey runs → trust map paints as instanced quads at floor height
 *   (green verified / yellow observed / red lying / dark unknown) →
 *   certificate + repair panels mount in the right sidebar → Run All drives
 *   the repair plan through the worker engine (fail-and-adapt rendered LOUD)
 *   → when every defect has an outcome: final full recertify, navmesh spawns
 *   rebuilt, and the rover patrol starts (over patches, around quarantine).
 *
 * Also still renders the original Gate-A layers: splat/point visuals,
 * collider wireframe, 2000-ball Rapier probe rain in its own worker.
 *
 * Keys: [W] wireframe  [T] trust map  [P] patrol  [B] defect boxes  [F] flip splats
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
import { CertifyWorkerClient, type CertifyPhase, type SpawnPoint } from "./workerClient";
import { mountCertificatePanel } from "./ui/certificatePanel";
import { mountRepairPanel } from "./ui/repairPanel";
import type {
  CertificateSummary,
  DefectSummary,
  RecertifyResult,
  RepairDriver,
  RepairStep,
  StepResult,
} from "./ui/protocol";
import { startPatrol, type Aabb as PatrolAabb, type PatrolHandle } from "./patrol";
import { TrustLayer } from "./trustLayer";

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
    `[W] wireframe  [T] trust map  [P] patrol  [B] defect boxes  [F] flip splats`;
}
setInterval(renderHud, 250);

// -------------------------------------------------------- survey overlay

const surveyOverlay = document.createElement("div");
Object.assign(surveyOverlay.style, {
  position: "fixed",
  top: "10px",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: "30",
  font: "12px/1.5 ui-monospace, Consolas, monospace",
  fontWeight: "700",
  letterSpacing: "0.04em",
  color: "#ffd60a",
  background: "rgba(10, 13, 20, 0.9)",
  border: "1px solid rgba(255, 214, 10, 0.45)",
  borderRadius: "6px",
  padding: "6px 14px",
  display: "none",
  pointerEvents: "none",
  maxWidth: "44vw",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} satisfies Partial<CSSStyleDeclaration>);
document.body.appendChild(surveyOverlay);

function showSurveyOverlay(text: string): void {
  surveyOverlay.textContent = `◐ ${text}`;
  surveyOverlay.style.display = "block";
}
function hideSurveyOverlay(): void {
  surveyOverlay.style.display = "none";
}

const PHASE_LABEL: Record<CertifyPhase, string> = {
  "fetching-collider": "fetching collider.glb",
  "parsing-collider": "parsing collider",
  "fetching-visual-points": "fetching visual points",
  "physics-init": "building physics world",
  certifying: "SURVEY RUNNING",
  recertifying: "RE-CERTIFYING",
  ready: "ready",
};

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
  display: "flex",
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
});
Object.assign(repairPanel.el.style, { flex: "1 1 45%", minHeight: "0", width: "100%" });
repairPanel.log("waiting for survey…");

// ------------------------------------------------------- integration state

let latestCert: CertificateSummary | undefined;
let spawnsCache: SpawnPoint[] | undefined;
let patrolHandle: PatrolHandle | undefined;
let finalized = false;
let viewerScale = 1;
let scaleActionId: string | undefined;
let colliderWireframe: THREE.Object3D | undefined;
let splatObject: THREE.Object3D | undefined;

client.onPhase = (phase, detail) => {
  if (phase === "ready") {
    hideSurveyOverlay();
    return;
  }
  const label = PHASE_LABEL[phase] ?? phase;
  showSurveyOverlay(detail ? `${label} — ${detail}` : label);
  hud.status = label.toLowerCase();
};

client.onTrustMap = (tm) => {
  trustLayer.paint(tm);
};

client.onDefects = (ev) => {
  hud.grade = ev.grade;
  hud.defects = ev.openDefectIds.length;
  updateLiveDefects(ev.defects);
};

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
  for (const d of cert.defects ?? []) {
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
let defectBoxesVisible = true;

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
  for (const d of defects) {
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

function toggleDefectBoxes(): void {
  defectBoxesVisible = !defectBoxesVisible;
  if (staticDefectGroup) staticDefectGroup.visible = defectBoxesVisible;
  if (liveDefectGroup) liveDefectGroup.visible = defectBoxesVisible;
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
            `quarantined ${r.defectIds.length} region(s) — excluded from the navigable area; no training episode touches the lie`,
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
    beginPatrol();
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
  for (const d of latestCert?.defects ?? []) {
    if (d.outcome === "quarantined" && d.region) {
      quarantine.push({
        min: [d.region.min[0], d.region.min[1], d.region.min[2]],
        max: [d.region.max[0], d.region.max[1], d.region.max[2]],
      });
    }
  }
  patrolHandle = startPatrol(scene, {
    spawns: spawnsCache,
    quarantine,
    collider: colliderWireframe,
    showLabel: false, // sidebar owns the bottom-right corner; HUD carries the honesty line
  });
  hud.status = "rover patrol: navmesh waypoint-following (not a learned policy)";
  repairPanel.log(
    `rover patrol started — ${patrolHandle.waypoints.length} waypoints, over patches, around ${quarantine.length} quarantined region(s) [P toggles]`,
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
    repairPanel.setPlan(cert);
    const open = cert.defects.filter(isOpenDefect).length;
    repairPanel.log(
      `survey complete — grade ${cert.grade}, ${cert.defects.length} defect(s), ${open} open`,
      open > 0 ? "warn" : "ok",
    );
    if (open > 0) repairPanel.log("review the proposed plan below, then Run All (or execute step by step)");
    await refreshFloorY();
    hud.status = "survey complete — certificate panel is live";
    maybeFinalize(cert);
  } catch (err) {
    hideSurveyOverlay();
    const msg = err instanceof Error ? err.message : String(err);
    hud.status = `certification failed: ${msg}`;
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
    } else if (msg.kind === "error") {
      hud.status = `probe worker error: ${msg.message}`;
    }
  };
  worker.onerror = (e) => {
    hud.status = `probe worker failed: ${e.message}`;
  };

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

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w") {
    if (colliderWireframe) colliderWireframe.visible = !colliderWireframe.visible;
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
    if (patrolHandle) {
      patrolHandle.stop();
      patrolHandle = undefined;
      hud.status = "patrol stopped";
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
    hud.visualMode = `splats (${url.split("/").pop()})`;
    return splat;
  } catch (err) {
    console.warn("Spark splat load failed, falling back to point cloud:", err);
    return undefined;
  }
}

async function main(): Promise<void> {
  const dir = resolveBundleDir();
  hud.worldId = dir.split("/").pop() ?? dir;

  const [metadata, certificate] = await Promise.all([fetchMetadata(dir), fetchCertificate(dir)]);
  if (metadata?.worldId) hud.worldId = metadata.worldId.slice(0, 8);

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
      new THREE.MeshBasicMaterial({ color: 0x3bd6c6, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    wireframe.name = "collider-wireframe";
    wireframe.visible = false; // pretty world first — W is the Beat-1 reveal
    worldGroup.add(wireframe);
    colliderWireframe = wireframe;

    // Start the camera INSIDE the world at eye height — splat worlds are
    // captured from within; from outside you see the dark backs of the
    // gaussians and only the wireframe reads. Key I toggles inside/orbit.
    const bb = new THREE.Box3().setFromBufferAttribute(wfGeom.getAttribute("position") as THREE.BufferAttribute);
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const radius = size.length() / 2 || 5;
    const eyeY = bb.min.y + Math.min(1.6, size.y * 0.6); // eye height, clamped for dollhouse-scale worlds
    const longAxis = size.x >= size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const inside = new THREE.Vector3(center.x, eyeY, center.z).addScaledVector(longAxis, -Math.max(size.x, size.z) * 0.25);
    const orbit = center.clone().add(new THREE.Vector3(radius * 0.9, radius * 0.7, radius * 0.9));
    camera.position.copy(inside);
    controls.target.copy(new THREE.Vector3(center.x, eyeY, center.z).addScaledVector(longAxis, Math.max(size.x, size.z) * 0.2));
    camera.near = Math.max(radius / 1000, 0.01);
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    let insideView = true;
    addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "i") return;
      insideView = !insideView;
      camera.position.copy(insideView ? inside : orbit);
      controls.target.copy(insideView ? new THREE.Vector3(center.x, eyeY, center.z).addScaledVector(longAxis, Math.max(size.x, size.z) * 0.2) : center);
    });

    startPhysics(soup);
  } catch (err) {
    hud.status = `collider.glb failed: ${String(err)}`;
  }

  // --- visuals: splats, else points ---
  splatObject = await loadSplats(dir);
  (window as unknown as Record<string, unknown>).__dbg = { scene, worldGroup, camera, renderer, get splat() { return splatObject; } };
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
    // Show the shipped certificate immediately; the live survey replaces it.
    if (certificate.grade && certificate.trust) {
      certificatePanel.update(certificate as unknown as CertificateSummary);
    }
  } else {
    hud.grade = "no certificate.json";
    trustLayer.setFloorY(metadata?.groundPlaneY ?? 0);
  }

  if (hud.status === "loading bundle…") hud.status = "bundle loaded — starting survey";

  // --- live certification in the certify worker (does not block the viewer) ---
  void startCertification(dir);
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
