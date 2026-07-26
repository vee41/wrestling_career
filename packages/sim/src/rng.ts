// CLAUDE.md hard rule: all randomness flows through this seeded RNG. No
// caller may reach for Math.random()/Date.now() anywhere in packages/sim.

/** FNV-1a 32-bit string hash — used only to turn a seed string into a numeric state. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** Pick one element uniformly at random. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle; returns a new array, does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * A new, independent RNG deterministically derived from this one and a
   * label. Use this instead of sharing one stream across subsystems whose
   * call order might vary — e.g. one fork per match, per wrestler decision —
   * so results stay identical regardless of iteration order elsewhere.
   */
  fork(label: string): Rng;
}

function createFromState(state: number): Rng {
  const next = mulberry32(state);
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error("Rng.pick called with an empty array");
      const idx = Math.floor(next() * items.length);
      return items[Math.min(idx, items.length - 1)] as (typeof items)[number];
    },
    shuffle(items) {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        const b = copy[j] as (typeof copy)[number];
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
    fork(label) {
      return createFromState(hashSeed(`${state}:${label}`));
    },
  };
}

/** Create a deterministic RNG from a string or numeric seed. */
export function createRng(seed: string | number): Rng {
  const state = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  return createFromState(state);
}
