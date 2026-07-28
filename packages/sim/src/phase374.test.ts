import { describe, expect, it } from "vitest";
import type { MatchResult, Show } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";

function ctxAt(tick: number, seed = "phase374"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function makeEveryShowAPle(world: ReturnType<typeof createTestWorld>): void {
  world.config.pleIntervalWeeks = 1;
  world.config.pleCardSize = { min: 4, max: 4 };
  world.config.booking.multiWayChance = 0;
  for (const wrestler of world.wrestlers) {
    const popularity = findPopularity(world, wrestler.id);
    popularity.generalPopularity = 1;
    popularity.momentum = 0;
  }
}

function addStory(world: ReturnType<typeof createTestWorld>, id: string, participants: string[], phase: "building" | "peaking", audienceInterest = 80, momentum = 30): void {
  world.stories.push({
    id, participantWrestlerIds: participants, tension: "grudge", tensionDescription: "An intensely personal program.",
    stakes: "pride", audienceInterest, momentum, coherence: 80, phase, unresolvedDevelopments: [],
  });
}

function priorTitleMatch(world: ReturnType<typeof createTestWorld>, participants: string[], titleId: string): void {
  const show: Show = {
    id: "prior-title-show", tick: 2, kind: "ple",
    card: [{ id: "prior-title-slot", participantWrestlerIds: participants, position: "main_event", titleId, intents: {} }],
  };
  const result: MatchResult = {
    id: "prior-title-match", matchSlotId: "prior-title-slot", showId: show.id,
    participantWrestlerIds: participants, winnerWrestlerId: participants[0]!, quality: 70, crowdResponse: 70,
    chemistry: 60, storyAdvancement: 50,
    performances: participants.map((wrestlerId) => ({
      wrestlerId, performanceScore: 70, characterCredibilityDelta: 0, physicalCost: 0,
      gmReactionDelta: 0, backstageReactionDelta: 0,
    })),
  };
  world.shows.push(show);
  world.matchResults.push(result);
}

describe("Phase 3.7.4 heat-ranked card builder", () => {
  it("puts a hotter non-title program over a low-heat title defense", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0 });
    makeEveryShowAPle(world);
    const worldTitle = world.titles[0]!;
    findPopularity(world, "wrestler-2").momentum = 25;
    for (const wrestlerId of ["wrestler-4", "wrestler-5"]) {
      const popularity = findPopularity(world, wrestlerId);
      popularity.generalPopularity = 80;
      popularity.momentum = 30;
    }
    addStory(world, "white-hot-grudge", ["wrestler-4", "wrestler-5"], "peaking", 90, 40);

    const show = bookShow(world, ctxAt(1), 2);
    const titleMatch = show.card.find((slot) => slot.titleId === worldTitle.id)!;

    expect(show.card.find((slot) => slot.position === "main_event")?.storyId).toBe("white-hot-grudge");
    expect(titleMatch.position).not.toBe("main_event");
  });

  it("leaves a fresh belt undefended when no contender is ready", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0 });
    makeEveryShowAPle(world);

    const show = bookShow(world, ctxAt(1), 2);

    expect(show.card.some((slot) => slot.titleId !== undefined)).toBe(false);
  });

  it("forces a stale belt onto a PLE even without a hot contender", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0 });
    makeEveryShowAPle(world);
    const worldTitle = world.titles[0]!;

    const show = bookShow(world, ctxAt(25), 26);

    expect(show.card.some((slot) => slot.titleId === worldTitle.id)).toBe(true);
  });

  it("allows a peaking title-feud rematch when it is the hottest program", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0 });
    makeEveryShowAPle(world);
    const worldTitle = world.titles[0]!;
    const participants = [worldTitle.holderId!, "wrestler-2"];
    for (const wrestlerId of participants) {
      const popularity = findPopularity(world, wrestlerId);
      popularity.generalPopularity = 85;
      popularity.momentum = 35;
    }
    addStory(world, "hot-title-trilogy", participants, "peaking", 95, 45);
    priorTitleMatch(world, participants, worldTitle.id);

    const show = bookShow(world, ctxAt(4), 5);

    expect(show.card.some((slot) => slot.storyId === "hot-title-trilogy" && slot.titleId === worldTitle.id)).toBe(true);
  });
});
