/**
 * Surveyor viewer — main thread.
 *
 * Renders a world bundle (?world=/marble/<id>):
 *   - visuals: gaussian splats via Spark if a .spz is present, otherwise the
 *     visual-points.f32 splat centers as a THREE.Points cloud (offline-safe)
 *   - collider.glb as a toggleable wireframe               [W]
 *   - certificate.json defect regions as translucent boxes [B]
 *   - 2000 Rapier probe balls simulated in a Web Worker, drawn as an
 *     InstancedMesh; HUD shows render fps and worker steps/sec (GATE A).
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

const PROBE_COUNT = 2000;
const PROBE_RADIUS = 0.04;
const DROP_HEIGHT = 2; // metres above the raycast surface hit
const GRAVITY_Y = -9.81;

const SEVERITY_COLOR: Record<string, number> = {
  critical: 0xff3b30,
  major: 0xff9500,
  minor: 0xffd60a,
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
    `grade    ${hud.grade}   defects ${hud.defects}\n` +
    `${hud.status}\n` +
    `[W] wireframe  [B] defect boxes  [F] flip splats`;
}
setInterval(renderHud, 250);

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
scene.add(probeMesh);

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

// -------------------------------------------------------------- overlays

function buildDefectBoxes(cert: Certificate): THREE.Group {
  const group = new THREE.Group();
  group.name = "defects";
  for (const d of cert.defects ?? []) {
    const min = new THREE.Vector3(...d.region.min);
    const max = new THREE.Vector3(...d.region.max);
    const size = new THREE.Vector3().subVectors(max, min).max(new THREE.Vector3(0.02, 0.02, 0.02));
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const color = SEVERITY_COLOR[d.severity] ?? 0xff3b30;
    const boxGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const fill = new THREE.Mesh(
      boxGeom,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: d.severity === "critical" ? 0.28 : 0.16,
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
  return group;
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
      hud.status = "physics running";
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
      hud.status = `worker error: ${msg.message}`;
    }
  };
  worker.onerror = (e) => {
    hud.status = `worker failed: ${e.message}`;
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

// ------------------------------------------------------------------- main

async function loadSplats(dir: string): Promise<THREE.Object3D | undefined> {
  const url = await findSplatUrl(dir);
  if (!url) return undefined;
  try {
    const spark = await import("@sparkjsdev/spark");
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
  let wireframe: THREE.Object3D | undefined;
  try {
    const gltf = await new GLTFLoader().loadAsync(`${dir}/collider.glb`);
    const soup = extractTriSoup(gltf.scene);
    hud.triangles = soup.indices.length / 3;

    const wfGeom = new THREE.BufferGeometry();
    // The soup buffers are about to be transferred to the worker — copy them
    // for the wireframe first.
    wfGeom.setAttribute("position", new THREE.BufferAttribute(soup.positions.slice(), 3));
    wfGeom.setIndex(new THREE.BufferAttribute(soup.indices.slice(), 1));
    wireframe = new THREE.Mesh(
      wfGeom,
      new THREE.MeshBasicMaterial({ color: 0x3bd6c6, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    wireframe.name = "collider-wireframe";
    scene.add(wireframe);

    // Frame the camera on the collider.
    const bb = new THREE.Box3().setFromBufferAttribute(wfGeom.getAttribute("position") as THREE.BufferAttribute);
    const center = bb.getCenter(new THREE.Vector3());
    const radius = bb.getSize(new THREE.Vector3()).length() / 2 || 5;
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius * 0.9, radius * 0.7, radius * 0.9));
    camera.near = Math.max(radius / 1000, 0.01);
    camera.far = radius * 20;
    camera.updateProjectionMatrix();

    startPhysics(soup);
  } catch (err) {
    hud.status = `collider.glb failed: ${String(err)}`;
  }

  // --- visuals: splats, else points ---
  let splatObject = await loadSplats(dir);
  if (splatObject) {
    scene.add(splatObject);
  } else {
    const points = await fetchVisualPoints(dir);
    if (points && points.length > 0) {
      const cloud = buildPointsCloud(points);
      cloud.name = "visual-points";
      scene.add(cloud);
      splatObject = cloud;
      hud.visualMode = `points (${(points.length / 3).toLocaleString()} splat centers)`;
    } else {
      hud.visualMode = "none (no .spz, no visual-points.f32)";
    }
  }

  // --- certificate overlay ---
  let defectGroup: THREE.Group | undefined;
  if (certificate) {
    hud.grade = certificate.grade ?? "-";
    hud.defects = certificate.defects?.length ?? 0;
    defectGroup = buildDefectBoxes(certificate);
    scene.add(defectGroup);
    const floor = certificate.measurements?.find((m) => m.name === "floor_plane_height");
    if (floor) {
      const grid = new THREE.GridHelper(20, 40, 0x2a3142, 0x1a2030);
      grid.position.y = floor.value;
      scene.add(grid);
    }
  } else {
    hud.grade = "no certificate.json";
  }

  // --- keys ---
  addEventListener("keydown", (e) => {
    if (e.key === "w" || e.key === "W") {
      if (wireframe) wireframe.visible = !wireframe.visible;
    } else if (e.key === "b" || e.key === "B") {
      if (defectGroup) defectGroup.visible = !defectGroup.visible;
    } else if (e.key === "f" || e.key === "F") {
      // .spz files are y-down; flip if the visuals look upside-down relative
      // to the collider. Applies to whichever visual object is active.
      if (splatObject) splatObject.rotateX(Math.PI);
    }
  });

  if (hud.status === "loading bundle…") hud.status = "ready";
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
