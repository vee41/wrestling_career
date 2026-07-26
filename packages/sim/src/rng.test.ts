import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-2");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() stays within [0, 1)", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() stays within the inclusive bounds", () => {
    const rng = createRng("int-bounds");
    for (let i = 0; i < 500; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("fork() is deterministic and independent of the parent stream position", () => {
    const a = createRng("fork-seed").fork("wrestler-1");
    const b = createRng("fork-seed");
    b.next();
    b.next();
    const forkedFromMoved = b.fork("wrestler-1");
    expect(a.next()).toBe(forkedFromMoved.next());
  });

  it("fork() with different labels yields different streams", () => {
    const base = createRng("fork-seed-2");
    const forkA = base.fork("a");
    const forkB = base.fork("b");
    expect(forkA.next()).not.toBe(forkB.next());
  });

  it("shuffle() does not mutate the input and is a permutation", () => {
    const rng = createRng("shuffle-seed");
    const input = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled.slice().sort()).toEqual(input.slice().sort());
  });

  it("pick() only returns elements from the array", () => {
    const rng = createRng("pick-seed");
    const items = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it("pick() throws on an empty array", () => {
    const rng = createRng("empty-pick");
    expect(() => rng.pick([])).toThrow();
  });
});
