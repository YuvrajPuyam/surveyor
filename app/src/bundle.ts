/**
 * World-bundle fetching. A bundle directory (served by the Vite dev server,
 * publicDir = ../assets) contains:
 *   collider.glb         physics shell
 *   splat-*.spz          gaussian splats (real Marble worlds)
 *   visual-points.f32    raw float32 xyz triples (splat centers) — fallback
 *   metadata.json        worldId, metricScaleFactor, groundPlaneY
 *   certificate.json     survey output (optional): defects, trust, grade
 */

export interface Region {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Defect {
  id: string;
  type: string;
  severity: "critical" | "major" | "minor";
  region: Region;
  description?: string;
}

export interface Certificate {
  grade?: string;
  defects?: Defect[];
  trust?: {
    cellSizeM: number;
    cols: number;
    rows: number;
    counts: Record<string, number>;
    verifiedPct?: number;
    lyingPct?: number;
  };
  measurements?: Array<{ name: string; value: number; unit: string }>;
}

export interface WorldMetadata {
  worldId?: string;
  source?: string;
  metricScaleFactor?: number;
  groundPlaneY?: number;
}

/** Normalize the ?world= param: allow both "/marble/<id>" and "/assets/marble/<id>". */
export function resolveBundleDir(): string {
  const params = new URLSearchParams(location.search);
  let dir = params.get("world") ?? "/marble/7188e250-e2ff-43e7-babb-73834c22e932";
  if (dir.startsWith("/assets/")) dir = dir.slice("/assets".length);
  if (!dir.startsWith("/")) dir = `/${dir}`;
  if (dir.endsWith("/")) dir = dir.slice(0, -1);
  return dir;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return undefined; // SPA fallback page, not JSON
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export function fetchMetadata(dir: string): Promise<WorldMetadata | undefined> {
  return fetchJson<WorldMetadata>(`${dir}/metadata.json`);
}

export function fetchCertificate(dir: string): Promise<Certificate | undefined> {
  return fetchJson<Certificate>(`${dir}/certificate.json`);
}

export async function fetchVisualPoints(dir: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${dir}/visual-points.f32`);
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return undefined; // SPA fallback page, not raw floats
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 12 || buf.byteLength % 4 !== 0) return undefined;
    const floats = new Float32Array(buf);
    return floats.length % 3 === 0 ? floats : floats.subarray(0, floats.length - (floats.length % 3));
  } catch {
    return undefined;
  }
}

const SPLAT_CANDIDATES = ["splat-100k.spz", "splat-500k.spz", "splat-full.spz", "splat.spz", "visual.spz"];

/** Find a splat file in the bundle (no directory listing over HTTP, so probe known names). */
export async function findSplatUrl(dir: string): Promise<string | undefined> {
  const params = new URLSearchParams(location.search);
  const override = params.get("splat");
  const names = override ? [override] : SPLAT_CANDIDATES;
  for (const name of names) {
    const url = `${dir}/${name}`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && !type.includes("text/html")) return url;
    } catch {
      /* keep probing */
    }
  }
  return undefined;
}
