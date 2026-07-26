// Deterministic id generation: a per-tick counter, never Date.now()/Math.random(),
// so identical inputs always produce identical ids (determinism, see rng.ts).

export interface IdFactory {
  next(prefix: string): string;
}

export function createIdFactory(tick: number): IdFactory {
  const counters = new Map<string, number>();
  return {
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-t${tick}-${n}`;
    },
  };
}
