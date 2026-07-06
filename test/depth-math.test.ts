/**
 * Math core of the image-depth instrument (model-free): equirect projection
 * roundtrips, pinhole crop geometry, and the robust affine calibration.
 */
import { describe, expect, it } from "vitest";
import { fitAffineDepth, metricDepth, spearman } from "../src/depth/affine.js";
import {
  dirFromYawPitch,
  equirectDir,
  equirectUV,
  renderPinholeCrop,
  rotateYaw,
  type Image,
} from "../src/depth/equirect.js";
import { splatDepthPano, sampleDepthPano } from "../src/depth/assetDepth.js";
import { hashSeed, mulberry32 } from "../src/core/prng.js";

describe("equirect projection", () => {
  it("dir → uv → dir roundtrips across the sphere", () => {
    const W = 720, H = 360;
    for (const yaw of [-2.8, -1.2, 0, 0.7, 2.9]) {
      for (const pitch of [-1.2, -0.4, 0, 0.5, 1.3]) {
        const d = dirFromYawPitch(yaw, pitch);
        const { u, v } = equirectUV(d, W, H);
        const d2 = equirectDir(u, v, W, H);
        expect(Math.hypot(d2.x - d.x, d2.y - d.y, d2.z - d.z)).toBeLessThan(0.02);
      }
    }
  });

  it("yaw offset in equirectUV and rotateYaw agree", () => {
    const off = 0.83;
    const d = dirFromYawPitch(0.4, 0.2);
    // rotating the direction INTO the world frame, then projecting with no
    // offset == projecting the pano-frame direction with the offset applied
    const a = equirectUV(rotateYaw(d, off), 720, 360, off);
    const b = equirectUV(d, 720, 360, 0);
    expect(Math.abs(a.u - b.u)).toBeLessThan(0.6);
    expect(Math.abs(a.v - b.v)).toBeLessThan(1e-6);
  });

  it("pinhole crop: center pixel looks along the crop axis; borders spread by fov", () => {
    const pano: Image = { data: new Uint8Array(64 * 32 * 3), width: 64, height: 32, channels: 3 };
    const crop = renderPinholeCrop(pano, 0.9, -0.3, 80, 21);
    const ci = (10 * 21 + 10) * 3;
    const fwd = dirFromYawPitch(0.9, -0.3);
    expect(Math.hypot(crop.dirs[ci] - fwd.x, crop.dirs[ci + 1] - fwd.y, crop.dirs[ci + 2] - fwd.z)).toBeLessThan(0.01);
    // corner ray angle from axis ≈ atan(sqrt(2) · tan(fov/2)) — just assert > fov/2
    const corner = { x: crop.dirs[0], y: crop.dirs[1], z: crop.dirs[2] };
    const dot = corner.x * fwd.x + corner.y * fwd.y + corner.z * fwd.z;
    expect(Math.acos(dot)).toBeGreaterThan((80 / 2 / 180) * Math.PI * 0.9);
  });
});

describe("robust affine depth calibration", () => {
  it("recovers scale/shift through 25% outliers", () => {
    const rng = mulberry32(hashSeed(7, "affine-test"));
    const S = 0.35, T = 0.02;
    const pred: number[] = [];
    const metric: number[] = [];
    for (let i = 0; i < 400; i++) {
      const d = 0.8 + rng() * 12; // metres
      const clean = (1 / d - T) / S;
      const outlier = rng() < 0.25;
      pred.push(outlier ? clean * (0.2 + rng() * 2.5) : clean + (rng() - 0.5) * 0.01);
      metric.push(d);
    }
    const fit = fitAffineDepth(pred, metric);
    expect(Math.abs(fit.s - S) / S).toBeLessThan(0.08);
    expect(fit.inlierFraction).toBeGreaterThan(0.6);
    expect(fit.medianRelDepthErr).toBeLessThan(0.08);
    const d0 = metricDepth(fit, (1 / 3.0 - T) / S)!;
    expect(Math.abs(d0 - 3.0)).toBeLessThan(0.25);
  });

  it("spearman: monotone ≈ 1, reversed ≈ −1", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(spearman(a, a.map((x) => x * 3 + 1))).toBeCloseTo(1, 5);
    expect(spearman(a, a.map((x) => -x))).toBeCloseTo(-1, 5);
  });
});

describe("splat depth pano", () => {
  it("bins the nearest point per direction", () => {
    // two points along +z at 2 m and 5 m, one along +x at 3 m
    const pts = new Float32Array([0, 0, 2, 0, 0, 5, 3, 0, 0]);
    const pano = splatDepthPano(pts, { x: 0, y: 0, z: 0 }, 360, 180);
    const uvZ = equirectUV({ x: 0, y: 0, z: 1 }, 360, 180);
    const uvX = equirectUV({ x: 1, y: 0, z: 0 }, 360, 180);
    expect(sampleDepthPano(pano, uvZ.u, uvZ.v)).toBeCloseTo(2, 5);
    expect(sampleDepthPano(pano, uvX.u, uvX.v)).toBeCloseTo(3, 5);
  });
});
