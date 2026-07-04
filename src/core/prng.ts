/**
 * Deterministic seeded PRNG (mulberry32). Every stochastic step in the
 * certify pipeline draws from one of these so that a (worldId, seed) pair
 * always produces byte-identical certificates — the basis of the replay
 * cassette and the dead-wifi demo mode.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for deriving per-phase seeds from a root seed. */
export function hashSeed(root: number, label: string): number {
  let h = root >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
