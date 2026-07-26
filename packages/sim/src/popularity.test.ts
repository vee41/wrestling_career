import { describe, expect, it } from "vitest";
import type { MatchResult } from "@wrestling/contracts";
import { updatePopularity } from "./popularity.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import type { TickContext } from "./context.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";

function ctxAt(tick: number): TickContext {
  return { tick, rng: createRng(`popularity-test:${tick}`), ids: createIdFactory(tick), events: [] };
}

describe("updatePopularity", () => {
  it("GDD §14 hard requirement: a losing wrestler can still gain popularity from a strong performance", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    const winner = findPopularity(world, "wrestler-0");
    const loser = findPopularity(world, "wrestler-1");
    winner.generalPopularity = 50;
    winner.currentReaction = 50;
    winner.momentum = 0;
    loser.generalPopularity = 20;
    loser.currentReaction = 20;
    loser.momentum = 0;

    const result: MatchResult = {
      id: "m1",
      matchSlotId: "slot-1",
      showId: "show-1",
      participantWrestlerIds: ["wrestler-0", "wrestler-1"],
      winnerWrestlerId: "wrestler-0",
      quality: 80,
      crowdResponse: 85,
      chemistry: 75,
      storyAdvancement: 0,
      performances: [
        {
          wrestlerId: "wrestler-0",
          performanceScore: 55,
          characterCredibilityDelta: 0,
          physicalCost: 20,
          gmReactionDelta: 0,
          backstageReactionDelta: 0,
        },
        {
          // The loser puts in the far stronger showing.
          wrestlerId: "wrestler-1",
          performanceScore: 90,
          characterCredibilityDelta: 10,
          physicalCost: 25,
          gmReactionDelta: 5,
          backstageReactionDelta: 0,
        },
      ],
    };

    updatePopularity(world, ctxAt(1), [result]);

    const loserAfter = findPopularity(world, "wrestler-1");
    const winnerAfter = findPopularity(world, "wrestler-0");
    expect(loserAfter.generalPopularity).toBeGreaterThan(20);
    expect(loserAfter.currentReaction).toBeGreaterThan(20);
    expect(loserAfter.momentum).toBeGreaterThan(0);
    // The loser's underlying trend (momentum, uncapped by the per-tick move
    // cap) should clearly outpace the winner's weaker showing — popularity
    // here is driven by performance, never by `winnerWrestlerId`.
    expect(loserAfter.momentum).toBeGreaterThan(winnerAfter.momentum);
  });

  it("keeps every popularity dimension within its schema bounds across repeated updates", () => {
    const world = createTestWorld({ wrestlerCount: 4 });
    for (const p of world.popularity) {
      p.generalPopularity = 95;
      p.currentReaction = 95;
      p.momentum = 95;
    }
    let tick = 0;
    for (let i = 0; i < 20; i++) {
      const result: MatchResult = {
        id: `m${i}`,
        matchSlotId: `slot-${i}`,
        showId: `show-${i}`,
        participantWrestlerIds: ["wrestler-0", "wrestler-1"],
        winnerWrestlerId: "wrestler-0",
        quality: 100,
        crowdResponse: 100,
        chemistry: 100,
        storyAdvancement: 0,
        performances: [
          {
            wrestlerId: "wrestler-0",
            performanceScore: 100,
            characterCredibilityDelta: 0,
            physicalCost: 100,
            gmReactionDelta: 0,
            backstageReactionDelta: 0,
          },
          {
            wrestlerId: "wrestler-1",
            performanceScore: 100,
            characterCredibilityDelta: 0,
            physicalCost: 100,
            gmReactionDelta: 0,
            backstageReactionDelta: 0,
          },
        ],
      };
      updatePopularity(world, ctxAt(tick), [result]);
      tick++;
    }
    for (const p of world.popularity) {
      expect(p.generalPopularity).toBeGreaterThanOrEqual(0);
      expect(p.generalPopularity).toBeLessThanOrEqual(100);
      expect(p.currentReaction).toBeGreaterThanOrEqual(0);
      expect(p.currentReaction).toBeLessThanOrEqual(100);
      expect(p.momentum).toBeGreaterThanOrEqual(-100);
      expect(p.momentum).toBeLessThanOrEqual(100);
      expect(p.fatigue).toBeGreaterThanOrEqual(0);
      expect(p.fatigue).toBeLessThanOrEqual(100);
    }
  });

  it("decays momentum and relieves fatigue for wrestlers who did not compete", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    const popularity = findPopularity(world, "wrestler-0");
    popularity.momentum = 40;
    popularity.fatigue = 50;
    updatePopularity(world, ctxAt(1), []);
    expect(popularity.momentum).toBeLessThan(40);
    expect(popularity.fatigue).toBeLessThan(50);
  });
});
