import { describe, expect, it } from "vitest";
import type { MatchResult, Show } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { updatePopularity } from "./popularity.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";

function ctxAt(tick: number): TickContext {
  return { tick, rng: createRng(`phase373:${tick}`), ids: createIdFactory(tick), events: [] };
}

function result(id: string, showId: string, wrestlerIds: string[], winnerWrestlerId = wrestlerIds[0]!): MatchResult {
  return {
    id, matchSlotId: `${id}-slot`, showId, participantWrestlerIds: wrestlerIds, winnerWrestlerId,
    quality: 50, crowdResponse: 50, chemistry: 50, storyAdvancement: 0,
    performances: wrestlerIds.map((wrestlerId) => ({
      wrestlerId, performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0,
    })),
  };
}

function recordAppearance(world: ReturnType<typeof createTestWorld>, tick: number, wrestlerIds: string[], id = `history-${tick}`): void {
  const showId = `${id}-show`;
  world.shows.push({ id: showId, tick, kind: "tv", card: [{ id: `${id}-slot`, participantWrestlerIds: wrestlerIds, position: "mid", intents: {} }] });
  world.matchResults.push(result(id, showId, wrestlerIds));
}

describe("Phase 3.7.3 roster roles", () => {
  it("turns a rare legend return into scarcity, then penalizes an immediate repeat", () => {
    const world = createTestWorld({ wrestlerCount: 1, humanCount: 0 });
    const legend = world.wrestlers[0]!;
    legend.role = "legend";
    const popularity = findPopularity(world, legend.id);
    popularity.generalPopularity = 99;
    popularity.starPower = 100;
    popularity.currentReaction = 50;
    popularity.momentum = 0;
    world.config.popularity.crowdIgnitionChance = 0;
    recordAppearance(world, 2, [legend.id]);
    const returnShow: Show = { id: "legend-return-show", tick: 50, kind: "tv", card: [{ id: "legend-return-slot", participantWrestlerIds: [legend.id], position: "mid", intents: {} }] };
    world.shows.push(returnShow);
    const returnResult = result("legend-return", returnShow.id, [legend.id]);
    updatePopularity(world, ctxAt(50), [returnResult]);
    world.matchResults.push(returnResult);

    expect(popularity.momentum).toBeGreaterThan(10);
    expect(popularity.generalPopularity).toBeLessThanOrEqual(100);

    popularity.fatigue = 100;
    const repeatShow: Show = { id: "legend-repeat-show", tick: 53, kind: "tv", card: [{ id: "legend-repeat-slot", participantWrestlerIds: [legend.id], position: "mid", intents: {} }] };
    world.shows.push(repeatShow);
    updatePopularity(world, ctxAt(53), [result("legend-repeat", repeatShow.id, [legend.id])]);

    expect(popularity.momentum).toBeLessThan(0);
  });

  it("only regulars lose bounded relevance during a prolonged absence", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const regular = world.wrestlers[0]!;
    const legend = world.wrestlers[1]!;
    regular.role = "regular";
    legend.role = "legend";
    world.config.popularity.idleGravityFactor = 1;
    for (const wrestler of [regular, legend]) {
      const popularity = findPopularity(world, wrestler.id);
      popularity.generalPopularity = 60;
      popularity.starPower = 60;
      recordAppearance(world, 2, [wrestler.id], `start-${wrestler.id}`);
    }
    for (let tick = 3; tick <= 110; tick++) updatePopularity(world, ctxAt(tick), []);

    expect(findPopularity(world, regular.id).generalPopularity).toBe(40);
    expect(findPopularity(world, legend.id).generalPopularity).toBe(60);
    expect(findPopularity(world, regular.id).starPower).toBe(60);
  });

  it("awards a durable rub and status event for defeating a rare-appearance act", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const winner = world.wrestlers[0]!;
    const legend = world.wrestlers[1]!;
    legend.role = "legend";
    for (const wrestler of [winner, legend]) {
      const popularity = findPopularity(world, wrestler.id);
      popularity.generalPopularity = popularity.starPower = popularity.currentReaction = 50;
      popularity.momentum = 0;
    }
    const before = findPopularity(world, winner.id).starPower;
    updatePopularity(world, ctxAt(2), [result("rub", "rub-show", [winner.id, legend.id], winner.id)]);

    expect(findPopularity(world, winner.id).starPower).toBe(before + world.config.popularity.rubStarPowerGain);
    expect(world.events.some((event) => event.type === "popularity_changed" && event.wrestlerIds[0] === winner.id && event.data.reason === "status_rise")).toBe(true);
  });

  it("keeps rare roles out of open rotation and title slots while story-attached appearances remain valid", () => {
    const world = createTestWorld({ wrestlerCount: 8, humanCount: 0 });
    const legend = world.wrestlers[2]!;
    const partTimer = world.wrestlers[3]!;
    legend.role = "legend";
    partTimer.role = "part_timer";
    world.config.tvCardSize = { min: 2, max: 2 };
    world.config.booking.multiWayChance = 0;

    const openCard = bookShow(world, ctxAt(1), 2);
    expect(openCard.card.flatMap((slot) => slot.participantWrestlerIds)).not.toContain(legend.id);
    expect(openCard.card.flatMap((slot) => slot.participantWrestlerIds)).not.toContain(partTimer.id);

    world.stories.push({
      id: "rare-program", participantWrestlerIds: [partTimer.id, world.wrestlers[4]!.id], tension: "grudge", tensionDescription: "A meaningful return program.",
      stakes: "pride", audienceInterest: 80, momentum: 20, coherence: 80, phase: "building", unresolvedDevelopments: [],
    });
    const storyCard = bookShow(world, ctxAt(4), 5);
    expect(storyCard.card.some((slot) => slot.storyId === "rare-program" && slot.participantWrestlerIds.includes(partTimer.id))).toBe(true);

    world.titles[0]!.holderId = legend.id;
    world.config.pleIntervalWeeks = 1;
    const pleCard = bookShow(world, ctxAt(1), 2);
    expect(pleCard.card.some((slot) => slot.titleId === world.titles[0]!.id && slot.participantWrestlerIds.includes(legend.id))).toBe(false);
  });
});
