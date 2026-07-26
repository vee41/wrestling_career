import { describe, expect, it } from "vitest";
import { worldStateSchema } from "@wrestling/contracts";
import { runTick } from "./tick.js";
import { createTestWorld } from "./test-helpers.js";

// PLAN Phase 2 "Done when": a 12-week simulated season with 30 AI wrestlers
// and 0 humans runs without errors, producing a non-degenerate world (title
// changes hands or is credibly defended, >=5 distinct stories occur,
// popularity rankings shuffle).
const WEEKS = 12;
const TICKS_PER_WEEK = 3;

describe("12-week / 30-wrestler / 0-human season", () => {
  it("runs to completion and produces a non-degenerate world", () => {
    let world = createTestWorld({ wrestlerCount: 30, humanCount: 0, seed: "season-fixture" });

    const startingRanking = rankByPopularity(world);

    for (let i = 0; i < WEEKS * TICKS_PER_WEEK; i++) {
      const result = runTick(world, [], `season:${i}`);
      expect(() => worldStateSchema.parse(result.world)).not.toThrow();
      world = result.world;
    }

    // Title changes hands or is credibly defended at least once.
    const titleEvents = world.events.filter((e) => e.type === "title_change");
    expect(titleEvents.length).toBeGreaterThan(0);
    expect(world.championId).toBeDefined();

    // At least 5 distinct stories occurred over the season.
    expect(world.stories.length).toBeGreaterThanOrEqual(5);

    // Popularity rankings shuffle — the final order isn't identical to the
    // starting order.
    const endingRanking = rankByPopularity(world);
    expect(endingRanking).not.toEqual(startingRanking);
  });
});

function rankByPopularity(world: ReturnType<typeof createTestWorld>): string[] {
  return world.popularity
    .slice()
    .sort((a, b) => b.generalPopularity - a.generalPopularity)
    .map((p) => p.wrestlerId);
}
