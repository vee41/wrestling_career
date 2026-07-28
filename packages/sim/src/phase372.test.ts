import { describe, expect, it } from "vitest";
import type { MatchResult, Show } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { resolveShow } from "./match.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";

function ctxAt(tick: number, seed = "phase372"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function priorAppearance(world: ReturnType<typeof createTestWorld>): void {
  const participantWrestlerIds = world.wrestlers.map((wrestler) => wrestler.id);
  const priorShow: Show = {
    id: "previous-show", tick: 2, kind: "tv",
    card: [{ id: "previous-slot", participantWrestlerIds, position: "mid", intents: {} }],
  };
  const priorResult: MatchResult = {
    id: "previous-match", matchSlotId: "previous-slot", showId: priorShow.id, participantWrestlerIds,
    winnerWrestlerId: participantWrestlerIds[0]!, quality: 50, crowdResponse: 50, chemistry: 50, storyAdvancement: 0,
    performances: participantWrestlerIds.map((wrestlerId) => ({
      wrestlerId, performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0,
    })),
  };
  world.shows.push(priorShow);
  world.matchResults.push(priorResult);
}

describe("Phase 3.7.2 booking realism", () => {
  it("paces an unattached star who worked the immediately preceding show", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0, seed: "rest-tier" });
    world.config.tvCardSize = { min: 1, max: 1 };
    world.config.booking.multiWayChance = 0;
    world.config.booking.restPenalty = 300;
    for (const wrestler of world.wrestlers) findPopularity(world, wrestler.id).generalPopularity = 10;
    findPopularity(world, "wrestler-2").generalPopularity = 95;
    world.wrestlers.find((wrestler) => wrestler.id === "wrestler-2")!.role = "prospect";
    priorAppearance(world);

    const show = bookShow(world, ctxAt(4, "rest-tier"), 5);

    expect(show.card.flatMap((slot) => slot.participantWrestlerIds)).not.toContain("wrestler-2");
  });

  it("keeps a recently worked star eligible when an active story earns the slot", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0, seed: "story-exemption" });
    world.config.tvCardSize = { min: 1, max: 1 };
    for (const wrestler of world.wrestlers) findPopularity(world, wrestler.id).generalPopularity = 10;
    findPopularity(world, "wrestler-2").generalPopularity = 95;
    priorAppearance(world);
    world.stories.push({
      id: "earned-story", participantWrestlerIds: ["wrestler-2", "wrestler-3"], tension: "grudge",
      tensionDescription: "An earned program", stakes: "pride", audienceInterest: 80, momentum: 10,
      coherence: 80, phase: "building", unresolvedDevelopments: [],
    });

    const show = bookShow(world, ctxAt(4, "story-exemption"), 5);

    expect(show.card[0]?.storyId).toBe("earned-story");
    expect(show.card[0]?.participantWrestlerIds).toContain("wrestler-2");
  });

  it("books and resolves a configured undercard multi-way with every participant paid", () => {
    const world = createTestWorld({ wrestlerCount: 12, humanCount: 0, seed: "multi-way" });
    world.config.tvCardSize = { min: 4, max: 4 };
    world.config.booking.multiWayChance = 1;
    const show = bookShow(world, ctxAt(1, "multi-way"), 2);
    const multiWay = show.card.find((slot) => slot.participantWrestlerIds.length >= 3);
    expect(multiWay?.participantWrestlerIds).toHaveLength(4);
    const moneyBefore = new Map(multiWay!.participantWrestlerIds.map((id) => [id, world.wrestlers.find((wrestler) => wrestler.id === id)!.money]));

    const results = resolveShow(world, show, ctxAt(2, "multi-way"));
    const result = results.find((candidate) => candidate.matchSlotId === multiWay!.id)!;

    expect(result.performances).toHaveLength(4);
    expect(result.winnerWrestlerId).toBeTruthy();
    for (const wrestlerId of multiWay!.participantWrestlerIds) {
      expect(world.wrestlers.find((wrestler) => wrestler.id === wrestlerId)!.money).toBeGreaterThan(moneyBefore.get(wrestlerId)!);
    }
  });
});
