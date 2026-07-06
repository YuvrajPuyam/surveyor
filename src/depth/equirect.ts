/**
 * Equirectangular (360° pano) geometry — the projection math for the
 * image-depth instrument. Pure functions, no I/O, unit-tested.
 *
 * Conventions (locked to the bundle world frame = collider frame):
 *   yaw θ ∈ [−π, π): 0 looks toward +z, +θ turns toward +x (θ = atan2(x, z))
 *   pitch φ ∈ [−π/2, π/2]: + looks up (+y)
 *   pano u: left edge = θ −π, wraps; v: top = φ +π/2 (image rows go DOWN)
 *   An unknown constant yaw offset between the pano frame and the world
 *   frame is expected — it is FITTED downstream, never assumed.
 */
import type { Vec3 } from "../core/geom.js";

export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: c * Math.sin(yaw), y: Math.sin(pitch), z: c * Math.cos(yaw) };
}

export function yawPitchFromDir(d: Vec3): { yaw: number; pitch: number } {
  const r = Math.hypot(d.x, d.y, d.z) || 1;
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y / r))) };
}

/** Pixel center (u, v) of a W×H equirect for a view direction (+ yaw offset). */
export function equirectUV(d: Vec3, W: number, H: number, yawOffset = 0): { u: number; v: number } {
  const { yaw, pitch } = yawPitchFromDir(d);
  let t = (yaw - yawOffset + Math.PI) / (2 * Math.PI); // 0..1 across width
  t -= Math.floor(t); // wrap
  const s = (Math.PI / 2 - pitch) / Math.PI; // 0 top .. 1 bottom
  return { u: t * W - 0.5, v: s * H - 0.5 };
}

/** View direction for a pixel center of a W×H equirect (+ yaw offset). */
export function equirectDir(u: number, v: number, W: number, H: number, yawOffset = 0): Vec3 {
  const yaw = ((u + 0.5) / W) * 2 * Math.PI - Math.PI + yawOffset;
  const pitch = Math.PI / 2 - ((v + 0.5) / H) * Math.PI;
  return dirFromYawPitch(yaw, pitch);
}

export interface Image {
  data: Uint8Array | Uint8ClampedArray; // interleaved
  width: number;
  height: number;
  channels: number;
}

/** Bilinear sample of one channel set at (u, v) with horizontal wrap. */
export function sampleEquirect(img: Image, u: number, v: number, out: number[]): void {
  const { width: W, height: H, channels: C, data } = img;
  const u0f = Math.floor(u);
  const v0 = Math.max(0, Math.min(H - 1, Math.floor(v)));
  const v1 = Math.max(0, Math.min(H - 1, v0 + 1));
  const fu = u - u0f;
  const fv = Math.max(0, Math.min(1, v - v0));
  const u0 = ((u0f % W) + W) % W;
  const u1 = (u0 + 1) % W;
  for (let c = 0; c < C; c++) {
    const p00 = data[(v0 * W + u0) * C + c];
    const p10 = data[(v0 * W + u1) * C + c];
    const p01 = data[(v1 * W + u0) * C + c];
    const p11 = data[(v1 * W + u1) * C + c];
    out[c] = (p00 * (1 - fu) + p10 * fu) * (1 - fv) + (p01 * (1 - fu) + p11 * fu) * fv;
  }
}

export interface PinholeCrop {
  /** crop pixels, RGB interleaved */
  data: Uint8Array;
  size: number;
  /** view direction IN PANO FRAME for each crop pixel (size×size×3 flat) */
  dirs: Float32Array;
  yaw: number;
  pitch: number;
  fovDeg: number;
}

/**
 * Render a pinhole (perspective) crop from an equirect pano — monocular
 * depth models are trained on perspective images; feeding them raw
 * equirect (especially near the poles) is out-of-distribution.
 */
export function renderPinholeCrop(pano: Image, yaw: number, pitch: number, fovDeg: number, size: number): PinholeCrop {
  const f = size / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const fwd = dirFromYawPitch(yaw, pitch);
  // camera basis: right = normalize(fwd × worldUp)… with yaw/pitch only (no roll)
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up = {
    x: -Math.sin(pitch) * Math.sin(yaw),
    y: Math.cos(pitch),
    z: -Math.sin(pitch) * Math.cos(yaw),
  };
  const data = new Uint8Array(size * size * 3);
  const dirs = new Float32Array(size * size * 3);
  const px: number[] = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5 - size / 2;
      const cy = size / 2 - (y + 0.5);
      let dx = fwd.x * f + right.x * cx + up.x * cy;
      let dy = fwd.y * f + right.y * cx + up.y * cy;
      let dz = fwd.z * f + right.z * cx + up.z * cy;
      const n = Math.hypot(dx, dy, dz);
      dx /= n;
      dy /= n;
      dz /= n;
      const i = y * size + x;
      dirs[i * 3] = dx;
      dirs[i * 3 + 1] = dy;
      dirs[i * 3 + 2] = dz;
      const { u, v } = equirectUV({ x: dx, y: dy, z: dz }, pano.width, pano.height);
      sampleEquirect(pano, u, v, px);
      if (pano.channels >= 3) {
        data[i * 3] = px[0];
        data[i * 3 + 1] = px[1];
        data[i * 3 + 2] = px[2];
      } else {
        data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = px[0];
      }
    }
  }
  return { data, size, dirs, yaw, pitch, fovDeg };
}

/** Rotate a pano-frame direction into the world frame by the fitted yaw offset. */
export function rotateYaw(d: Vec3, yawOffset: number): Vec3 {
  if (yawOffset === 0) return d;
  const c = Math.cos(yawOffset);
  const s = Math.sin(yawOffset);
  // yaw rotation consistent with dirFromYawPitch (θ measured from +z toward +x)
  return { x: c * d.x + s * d.z, y: d.y, z: -s * d.x + c * d.z };
}
