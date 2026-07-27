import { describe, expect, it } from "vitest";
import type { MatchResult } from "@wrestling/contracts";
import { updatePopularity } from "./popularity.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import type { TickContext } from "./context.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";
import { updateChampionships } from "./title.js";

function ctxAt(tick: number): TickContext {
  return { tick, rng: createRng(`popularity-test:${tick}`), ids: createIdFactory(tick), events: [] };
}

describe("updatePopularity", () => {
  it("keeps a routine performance at its earned-status baseline essentially flat", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    for (const id of ["wrestler-0", "wrestler-1"]) {
      const popularity = findPopularity(world, id);
      popularity.generalPopularity = 50;
      popularity.starPower = 50;
      popularity.currentReaction = 50;
      popularity.momentum = 0;
    }
    const routine: MatchResult = {
      id: "routine", matchSlotId: "slot", showId: "show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-0",
      quality: 50, crowdResponse: 50, chemistry: 50, storyAdvancement: 0,
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
        { wrestlerId: "wrestler-1", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
      ],
    };
    updatePopularity(world, ctxAt(1), [routine]);
    // A level win remains flat; the level loser only takes the bounded,
    // credibility edge rather than a workrate-derived climb or collapse.
    expect(findPopularity(world, "wrestler-0").generalPopularity).toBe(50);
    expect(findPopularity(world, "wrestler-1").generalPopularity).toBe(47);
  });

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

    // A breakout is relative to established expectations, not an unearned
    // first-ever appearance. This prior modest outing gives the strong loss
    // the surprise context GDD §10 requires.
    world.matchResults.push({
      ...result,
      id: "m0",
      crowdResponse: 35,
      performances: result.performances.map((performance) => ({
        ...performance,
        performanceScore: performance.wrestlerId === "wrestler-1" ? 35 : 50,
      })),
    });

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

  it("caps breakout and upset movement, while a sustained losing result has a floor", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const underdog = findPopularity(world, "wrestler-1");
    const favourite = findPopularity(world, "wrestler-0");
    underdog.generalPopularity = underdog.starPower = 20;
    favourite.generalPopularity = favourite.starPower = 90;
    const upset: MatchResult = {
      id: "upset", matchSlotId: "slot", showId: "show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-1",
      quality: 90, crowdResponse: 90, chemistry: 90, storyAdvancement: 40,
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 60, characterCredibilityDelta: 0, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
        { wrestlerId: "wrestler-1", performanceScore: 95, characterCredibilityDelta: 0, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
      ],
    };
    updatePopularity(world, ctxAt(2), [upset]);
    expect(underdog.generalPopularity).toBeGreaterThan(20);
    expect(underdog.generalPopularity).toBeLessThanOrEqual(23);
    expect(world.events.some((event) => event.type === "popularity_changed" && event.data.reason === "upset")).toBe(true);

    underdog.generalPopularity = 5;
    underdog.starPower = 5;
    underdog.momentum = -80;
    updatePopularity(world, ctxAt(3), [{ ...upset, id: "loss", winnerWrestlerId: "wrestler-0" }]);
    expect(underdog.generalPopularity).toBeGreaterThanOrEqual(2);
  });

  it("settles idle popularity gently back toward star power", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    const popularity = findPopularity(world, "wrestler-0");
    popularity.generalPopularity = 30;
    popularity.starPower = 80;
    popularity.currentReaction = 30;
    updatePopularity(world, ctxAt(1), []);
    expect(popularity.generalPopularity).toBe(31);
    popularity.generalPopularity = 90;
    popularity.starPower = 30;
    popularity.currentReaction = 90;
    updatePopularity(world, ctxAt(2), []);
    expect(popularity.generalPopularity).toBe(89);
  });

  it("decays currentReaction toward generalPopularity on idle ticks instead of dragging generalPopularity down", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    const popularity = findPopularity(world, "wrestler-0");
    popularity.generalPopularity = 89;
    popularity.starPower = 89;
    popularity.currentReaction = 74;
    updatePopularity(world, ctxAt(1), []);
    expect(popularity.currentReaction).toBe(79);
    expect(popularity.generalPopularity).toBe(89);
  });

  it("raises star power on a title win and records status facts", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const title = world.titles.find((candidate) => candidate.id === "world-title")!;
    const result: MatchResult = {
      id: "title-match", matchSlotId: "title-slot", showId: "show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-1",
      quality: 80, crowdResponse: 80, chemistry: 80, storyAdvancement: 20,
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 70, characterCredibilityDelta: 0, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
        { wrestlerId: "wrestler-1", performanceScore: 80, characterCredibilityDelta: 0, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0 },
      ],
    };
    world.shows.push({ id: "show", tick: 0, kind: "ple", card: [{ id: "title-slot", participantWrestlerIds: result.participantWrestlerIds, position: "main_event", titleId: title.id, intents: {} }] });
    const before = findPopularity(world, "wrestler-1").starPower;
    updateChampionships(world, ctxAt(1), [result]);
    expect(findPopularity(world, "wrestler-1").starPower).toBe(before + 12);
    expect(world.events.some((event) => event.type === "popularity_changed" && event.data.reason === "status_rise")).toBe(true);
  });

  it("turns a three-week momentum hold into a durable status milestone", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const popularity = findPopularity(world, "wrestler-0");
    popularity.momentum = 100;
    const priorMomentumEvents = [2, 5].map((tick) => ({
      id: `momentum-${tick}`, tick, type: "popularity_changed" as const, summary: "Momentum remained high.",
      wrestlerIds: ["wrestler-0"], data: { reason: "breakout", direction: "rise", momentum: 30 },
    }));
    world.events.push(...priorMomentumEvents);
    const result: MatchResult = {
      id: "hold-match", matchSlotId: "slot", showId: "show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-0",
      quality: 50, crowdResponse: 50, chemistry: 50, storyAdvancement: 0,
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
        { wrestlerId: "wrestler-1", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
      ],
    };
    const before = popularity.starPower;
    updatePopularity(world, ctxAt(8), [result]);
    expect(popularity.starPower).toBe(before + 1);
    expect(world.events.some((event) => event.data.milestone === "status" && event.data.reason === "status_rise")).toBe(true);
  });

  it("surfaces a seeded crowd ignition but keeps quiet drift out of the event log", () => {
    const quiet = createTestWorld({ wrestlerCount: 1 });
    const popularity = findPopularity(quiet, "wrestler-0");
    popularity.generalPopularity = popularity.starPower = 50;
    updatePopularity(quiet, ctxAt(1), []);
    expect(quiet.events.filter((event) => event.type === "popularity_changed")).toHaveLength(0);

    const result: MatchResult = {
      id: "moment", matchSlotId: "slot", showId: "show", participantWrestlerIds: ["wrestler-0"], winnerWrestlerId: "wrestler-0",
      quality: 100, crowdResponse: 100, chemistry: 100, storyAdvancement: 50,
      performances: [{ wrestlerId: "wrestler-0", performanceScore: 100, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 }],
    };
    let ignitionSeen = false;
    for (let seed = 0; seed < 100 && !ignitionSeen; seed++) {
      const world = createTestWorld({ wrestlerCount: 1, seed: `ignition:${seed}` });
      const ignitionCtx: TickContext = { tick: seed, rng: createRng(`ignition:${seed}`), ids: createIdFactory(seed), events: [] };
      updatePopularity(world, ignitionCtx, [result]);
      ignitionSeen = world.events.some((event) => event.type === "popularity_changed" && event.data.reason === "crowd_ignition");
    }
    expect(ignitionSeen).toBe(true);
  });

  it("gives the same breakout a larger popularity move in the main event than the opener", () => {
    const mainWorld = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "position-popularity" });
    const openerWorld = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "position-popularity" });
    for (const world of [mainWorld, openerWorld]) {
      world.config.popularity.crowdIgnitionChance = 0;
      world.config.popularity.momentumPushFactor = 0.2;
      for (const wrestlerId of ["wrestler-0", "wrestler-1"]) {
        const popularity = findPopularity(world, wrestlerId);
        popularity.generalPopularity = popularity.starPower = popularity.currentReaction = 50;
        popularity.momentum = 0;
      }
      findPopularity(world, "wrestler-1").generalPopularity = findPopularity(world, "wrestler-1").starPower = findPopularity(world, "wrestler-1").currentReaction = 80;
      world.shows.push({
        id: "prior-show", tick: 0, kind: "tv",
        card: [{ id: "prior-slot", participantWrestlerIds: ["wrestler-0", "wrestler-1"], position: "mid", intents: {} }],
      });
      world.matchResults.push({
        id: "prior-match", matchSlotId: "prior-slot", showId: "prior-show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-0",
        quality: 50, crowdResponse: 50, chemistry: 50, storyAdvancement: 0,
        performances: [
          { wrestlerId: "wrestler-0", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
          { wrestlerId: "wrestler-1", performanceScore: 50, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
        ],
      });
    }
    const breakout: MatchResult = {
      id: "breakout", matchSlotId: "current-slot", showId: "current-show", participantWrestlerIds: ["wrestler-0", "wrestler-1"], winnerWrestlerId: "wrestler-0",
      quality: 52, crowdResponse: 52, chemistry: 52, storyAdvancement: 0,
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 52, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
        { wrestlerId: "wrestler-1", performanceScore: 52, characterCredibilityDelta: 0, physicalCost: 0, gmReactionDelta: 0, backstageReactionDelta: 0 },
      ],
    };
    mainWorld.shows.push({ id: "current-show", tick: 1, kind: "tv", card: [{ id: "current-slot", participantWrestlerIds: breakout.participantWrestlerIds, position: "main_event", intents: {} }] });
    openerWorld.shows.push({ id: "current-show", tick: 1, kind: "tv", card: [{ id: "current-slot", participantWrestlerIds: breakout.participantWrestlerIds, position: "opener", intents: {} }] });

    updatePopularity(mainWorld, ctxAt(1), [breakout]);
    updatePopularity(openerWorld, ctxAt(1), [breakout]);

    const mainDelta = findPopularity(mainWorld, "wrestler-0").generalPopularity - 50;
    const openerDelta = findPopularity(openerWorld, "wrestler-0").generalPopularity - 50;
    expect(Math.abs(mainDelta)).toBeGreaterThan(Math.abs(openerDelta));
  });
});
