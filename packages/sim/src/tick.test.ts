import { describe, expect, it } from "vitest";
import { exampleWorldState, worldStateSchema } from "@wrestling/contracts";
import { runTick } from "./tick.js";
import { createTestWorld } from "./test-helpers.js";

describe("runTick smoke tests", () => {
  it("runs one tick on the contracts fixture without throwing and stays schema-valid", () => {
    const { world, events } = runTick(exampleWorldState, [], "smoke-1");
    expect(() => worldStateSchema.parse(world)).not.toThrow();
    expect(world.tick).toBe(exampleWorldState.tick + 1);
    expect(Array.isArray(events)).toBe(true);
  });

  it("runs one tick on a 30-wrestler synthetic world without throwing", () => {
    const world0 = createTestWorld();
    const { world } = runTick(world0, [], "smoke-2");
    expect(() => worldStateSchema.parse(world)).not.toThrow();
  });

  it("does not mutate the input world", () => {
    const world0 = createTestWorld();
    const snapshot = JSON.stringify(world0);
    runTick(world0, [], "smoke-3");
    expect(JSON.stringify(world0)).toBe(snapshot);
  });

  it("runs many consecutive ticks (a full season) without throwing", () => {
    let world = createTestWorld();
    for (let i = 0; i < 36; i++) {
      const result = runTick(world, [], `season-smoke:${i}`);
      expect(() => worldStateSchema.parse(result.world)).not.toThrow();
      world = result.world;
    }
  });
});
