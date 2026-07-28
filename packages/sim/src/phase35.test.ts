import { describe, expect, it } from "vitest";
import type { MatchResult, Show } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { resolveShow } from "./match.js";
import { updatePopularity } from "./popularity.js";
import { createTestWorld } from "./test-helpers.js";
import { advanceStories } from "./stories.js";
import { runTick } from "./tick.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";

function ctxAt(tick: number, seed = "phase35"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function result(id: string, winnerWrestlerId: string, loserWrestlerId: string): MatchResult {
  return {
    id,
    matchSlotId: `slot-${id}`,
    showId: `show-${id}`,
    participantWrestlerIds: [winnerWrestlerId, loserWrestlerId],
    winnerWrestlerId,
    quality: 60,
    crowdResponse: 60,
    chemistry: 60,
    storyAdvancement: 15,
    performances: [
      { wrestlerId: winnerWrestlerId, performanceScore: 70, characterCredibilityDelta: 5, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
      { wrestlerId: loserWrestlerId, performanceScore: 100, characterCredibilityDelta: -5, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
    ],
  };
}

describe("Phase 3.5 world structure", () => {
  it("derives TV/PLE cadence from config without forcing fresh belts onto the card", () => {
    const world = createTestWorld({ wrestlerCount: 16, humanCount: 0, seed: "ple-booking" });
    world.config.pleIntervalWeeks = 2;
    world.config.pleCardSize = { min: 6, max: 6 };
    const tv = bookShow(world, ctxAt(2, "tv"), 2);
    const ple = bookShow(world, ctxAt(5, "ple"), 5);

    expect(tv.kind).toBe("tv");
    expect(ple.kind).toBe("ple");
    expect(ple.card).toHaveLength(6);
    expect(ple.card.some((slot) => slot.titleId !== undefined)).toBe(false);
  });

  it("books and resolves a peaking story at its PLE blowoff", () => {
    const world = createTestWorld({ wrestlerCount: 8, humanCount: 0, seed: "blowoff" });
    world.stories.push({
      id: "story-blowoff", participantWrestlerIds: ["wrestler-2", "wrestler-3"], tension: "grudge",
      tensionDescription: "Two rivals demand a final fight", stakes: "pride", audienceInterest: 80,
      momentum: 20, coherence: 80, phase: "peaking", unresolvedDevelopments: [],
    });
    const show: Show = {
      id: "ple-blowoff", tick: 11, kind: "ple",
      card: [{ id: "slot-blowoff", participantWrestlerIds: ["wrestler-2", "wrestler-3"], storyId: "story-blowoff", position: "main_event", intents: {} }],
    };
    world.shows.push(show);
    const blowoff = { ...result("blowoff-result", "wrestler-2", "wrestler-3"), matchSlotId: "slot-blowoff", showId: show.id, storyId: "story-blowoff" };
    world.matchResults.push(blowoff);

    const ctx = ctxAt(11, "blowoff");
    advanceStories(world, ctx, [blowoff]);

    expect(world.stories[0]?.phase).toBe("resolved");
    expect(ctx.events.some((event) => event.type === "story_resolved" && event.data["blowoff"] === true)).toBe(true);
  });

  it("scales appearance pay by card position", () => {
    const mainWorld = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "position" });
    const openerWorld = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "position" });
    const main: Show = { id: "main", tick: 0, kind: "tv", card: [{ id: "slot", participantWrestlerIds: ["wrestler-0", "wrestler-1"], position: "main_event", intents: {} }] };
    const opener: Show = { id: "opener", tick: 0, kind: "tv", card: [{ id: "slot", participantWrestlerIds: ["wrestler-0", "wrestler-1"], position: "opener", intents: {} }] };
    mainWorld.shows.push(main); openerWorld.shows.push(opener);
    const mainBefore = mainWorld.wrestlers[0]!.money;
    const openerBefore = openerWorld.wrestlers[0]!.money;
    resolveShow(mainWorld, main, ctxAt(0, "position"));
    resolveShow(openerWorld, opener, ctxAt(0, "position"));
    expect(mainWorld.wrestlers[0]!.money - mainBefore).toBeGreaterThan(openerWorld.wrestlers[0]!.money - openerBefore);
  });

  it("removes an injured wrestler for a show and records their eventual return", () => {
    const world = createTestWorld({ wrestlerCount: 12, humanCount: 0, seed: "absence" });
    world.wrestlers[5]!.condition = 30;
    const first = bookShow(world, ctxAt(2, "absence"), 2);
    expect(first.card.flatMap((slot) => slot.participantWrestlerIds)).not.toContain("wrestler-5");
    expect(world.events.some((event) => event.wrestlerIds.includes("wrestler-5") && event.data["absence"] === "missed_show")).toBe(true);

    world.wrestlers[5]!.condition = 80;
    const second = bookShow(world, ctxAt(5, "return"), 5);
    expect(second.card.flatMap((slot) => slot.participantWrestlerIds)).toContain("wrestler-5");
    expect(world.events.some((event) => event.wrestlerIds.includes("wrestler-5") && event.data["absence"] === "return")).toBe(true);
  });

  it("turns sustained overexposure and a three-match losing streak into a net fall", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "fall" });
    const popularity = findPopularity(world, "wrestler-1");
    popularity.generalPopularity = 100;
    popularity.currentReaction = 100;
    popularity.fatigue = 70;
    const losses = [result("one", "wrestler-0", "wrestler-1"), result("two", "wrestler-0", "wrestler-1"), result("three", "wrestler-0", "wrestler-1")];
    world.matchResults.push(...losses);
    updatePopularity(world, ctxAt(3, "fall"), [losses[2]!]);
    expect(popularity.generalPopularity).toBeLessThan(100);
    expect(popularity.momentum).toBeLessThan(0);
  });

  it("runs a 26-week synthetic season with six PLEs, twenty TVs, and both belts defended", () => {
    let world = createTestWorld({ wrestlerCount: 30, humanCount: 0, seed: "slice-shape" });
    for (let tick = 0; tick < 26 * 3; tick++) world = runTick(world, [], "slice-shape").world;
    expect(world.shows.filter((show) => show.kind === "ple")).toHaveLength(6);
    expect(world.shows.filter((show) => show.kind === "tv")).toHaveLength(20);
    for (const title of world.titles) {
      expect(world.events.some((event) => event.type === "title_change" && event.data["titleId"] === title.id)).toBe(true);
    }
  }, 15_000);
});
