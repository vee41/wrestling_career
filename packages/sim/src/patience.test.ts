import { describe, expect, it } from "vitest";
import type { MatchResult, WorldEvent } from "@wrestling/contracts";
import { countRecentInteractions, patienceMultiplier, recentPerformanceReaction } from "./patience.js";
import { createTestWorld } from "./test-helpers.js";

function interactionEvent(tick: number, wrestlerId: string, intent: string): WorldEvent {
  return {
    id: `evt-${tick}-${wrestlerId}-${intent}`,
    tick,
    type: "interaction_resolved",
    summary: "test",
    wrestlerIds: [wrestlerId],
    data: { intent },
  };
}

describe("countRecentInteractions / patienceMultiplier", () => {
  it("counts only matching wrestler+intent events within the window", () => {
    const world = createTestWorld({ wrestlerCount: 3 });
    world.events.push(
      interactionEvent(1, "wrestler-0", "request_opportunity"),
      interactionEvent(2, "wrestler-0", "request_opportunity"),
      interactionEvent(2, "wrestler-0", "pitch_feud"),
      interactionEvent(2, "wrestler-1", "request_opportunity"),
      interactionEvent(0, "wrestler-0", "request_opportunity"),
    );
    // windowTicks=2, currentTick=2 -> only tick > 0 && tick <= 2 counts, so
    // the tick-0 event (out of window), the pitch_feud event (wrong
    // intent), and the wrestler-1 event (wrong wrestler) are all excluded.
    const count = countRecentInteractions(world, "wrestler-0", "request_opportunity", 2, 2);
    expect(count).toBe(2);
  });

  it("excludes events outside the window", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    world.events.push(interactionEvent(1, "wrestler-0", "request_opportunity"));
    const count = countRecentInteractions(world, "wrestler-0", "request_opportunity", 20, 6);
    expect(count).toBe(0);
  });

  it("patienceMultiplier decreases monotonically as repeats increase", () => {
    const values = [0, 1, 2, 3, 4].map((n) => patienceMultiplier(n));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1] as number);
    }
    expect(patienceMultiplier(0)).toBe(1);
  });
});

describe("recentPerformanceReaction (tuning gap #3)", () => {
  it("sums gmReactionDelta/backstageReactionDelta from recent matches for one wrestler, via the match's show tick", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    world.shows.push({ id: "show-old", tick: 0, card: [{ id: "slot-old", participantWrestlerIds: ["wrestler-0", "wrestler-1"], intents: {} }] });
    world.shows.push({ id: "show-recent", tick: 5, card: [{ id: "slot-recent", participantWrestlerIds: ["wrestler-0", "wrestler-1"], intents: {} }] });

    const perf = (wrestlerId: string, gm: number, backstage: number) => ({
      wrestlerId,
      performanceScore: 50,
      characterCredibilityDelta: 0,
      physicalCost: 10,
      gmReactionDelta: gm,
      backstageReactionDelta: backstage,
    });

    const outOfWindow: MatchResult = {
      id: "m-old",
      matchSlotId: "slot-old",
      showId: "show-old",
      participantWrestlerIds: ["wrestler-0", "wrestler-1"],
      winnerWrestlerId: "wrestler-0",
      quality: 50,
      crowdResponse: 50,
      chemistry: 50,
      storyAdvancement: 0,
      performances: [perf("wrestler-0", 100, 100), perf("wrestler-1", 0, 0)],
    };
    const inWindow: MatchResult = {
      id: "m-recent",
      matchSlotId: "slot-recent",
      showId: "show-recent",
      participantWrestlerIds: ["wrestler-0", "wrestler-1"],
      winnerWrestlerId: "wrestler-0",
      quality: 50,
      crowdResponse: 50,
      chemistry: 50,
      storyAdvancement: 0,
      performances: [perf("wrestler-0", 8, 4), perf("wrestler-1", -6, -3)],
    };
    world.matchResults.push(outOfWindow, inWindow);

    const reaction = recentPerformanceReaction(world, "wrestler-0", 6, 6);
    expect(reaction).toEqual({ gmReaction: 8, backstageReaction: 4 });

    const otherReaction = recentPerformanceReaction(world, "wrestler-1", 6, 6);
    expect(otherReaction).toEqual({ gmReaction: -6, backstageReaction: -3 });
  });
});
