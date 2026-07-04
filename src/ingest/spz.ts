/**
 * Minimal SPZ (Niantic gaussian-splat format) position extractor.
 *
 * We only need splat CENTERS (the visual-evidence point cloud); alphas,
 * colors, scales, rotations, and SH coefficients are skipped. Written
 * in-house because the available npm loader is browser-bound and fails in
 * Node — and 60 lines beat a broken dependency.
 *
 * Format (v2): gzip stream containing
 *   header:  uint32 magic 0x5053474e ("NGSP"), uint32 version,
 *            uint32 numPoints, uint8 shDegree, uint8 fractionalBits,
 *            uint8 flags, uint8 reserved
 *   then positions: numPoints * 3 components, each a little-endian
 *   24-bit two's-complement integer with `fractionalBits` fractional bits.
 */
import { gunzipSync } from "node:zlib";

export interface SpzInfo {
  numPoints: number;
  version: number;
  shDegree: number;
  positions: Float32Array;
  /** opacity 0..1 per splat — low-alpha floaters are not surface claims */
  alphas: Float32Array;
  /** max Gaussian scale (m) per splat — a fat splat's surface extends far from its center */
  maxScales: Float32Array;
}

const SPZ_MAGIC = 0x5053474e;

export function parseSpzPositions(spzFile: Buffer): SpzInfo {
  const raw = gunzipSync(spzFile);
  if (raw.length < 16) throw new Error("SPZ: file too short after gunzip");
  const magic = raw.readUInt32LE(0);
  if (magic !== SPZ_MAGIC) throw new Error(`SPZ: bad magic 0x${magic.toString(16)} (expected NGSP)`);
  const version = raw.readUInt32LE(4);
  const numPoints = raw.readUInt32LE(8);
  const shDegree = raw.readUInt8(12);
  const fractionalBits = raw.readUInt8(13);

  if (version !== 2) throw new Error(`SPZ: unsupported version ${version} (only v2 24-bit fixed point implemented)`);
  const need = 16 + numPoints * 9;
  if (raw.length < need) throw new Error(`SPZ: truncated positions block (${raw.length} < ${need})`);

  const positions = new Float32Array(numPoints * 3);
  const scale = 1 / (1 << fractionalBits);
  let off = 16;
  for (let i = 0; i < numPoints * 3; i++) {
    // little-endian 24-bit two's complement
    let v = raw[off] | (raw[off + 1] << 8) | (raw[off + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    positions[i] = v * scale;
    off += 3;
  }

  // after positions: alphas (1B each), colors (3B each), scales (3B each,
  // log-encoded: s = exp(b/16 - 10)), then rotations + SH which we skip
  const alphas = new Float32Array(numPoints);
  const maxScales = new Float32Array(numPoints);
  const alphaOff = off;
  const scalesOff = alphaOff + numPoints + numPoints * 3;
  if (raw.length >= scalesOff + numPoints * 3) {
    for (let i = 0; i < numPoints; i++) alphas[i] = raw[alphaOff + i] / 255;
    for (let i = 0; i < numPoints; i++) {
      const b = Math.max(raw[scalesOff + i * 3], raw[scalesOff + i * 3 + 1], raw[scalesOff + i * 3 + 2]);
      maxScales[i] = Math.exp(b / 16 - 10);
    }
  } else {
    alphas.fill(1);
    // maxScales stays 0 — no inflation without data
  }
  return { numPoints, version, shDegree, positions, alphas, maxScales };
}
