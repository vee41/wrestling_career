import { describe, expect, it } from "vitest";
import type { Alignment, PopularityImpact, SegmentIntent, Show, WorldState } from "@wrestling/contracts";
import { resolveSegments } from "./segment.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";
import { updatePopularity } from "./popularity.js";
import { advanceStories } from "./stories.js";
import { bookShow } from "./gm.js";
import { findPopularity } from "./lookups.js";
import { runTick } from "./tick.js";
import { worldFromScenario } from "./scenario.js";
import { analyzeSlice, runHeadlessSlice } from "./slice.js";

function ctx(): TickContext {
  return { tick: 0, rng: createRng("segment-test"), ids: createIdFactory(0), events: [] };
}

/** A one-participant promo: dominance and intent conflict are fixed, so only the heat mapping is under test. */
function soloHeat(alignment: Alignment, intent: SegmentIntent): { positive: number; negative: number } {
  const world = createTestWorld({ wrestlerCount: 1, humanCount: 0 });
  world.wrestlers[0]!.alignment = alignment;
  const show: Show = { id: "show-solo", tick: 0, kind: "tv", card: [{
    kind: "segment", id: "solo-promo", participantWrestlerIds: ["wrestler-0"], position: "mid", intents: { "wrestler-0": intent },
  }] };
  world.shows.push(show);
  const performance = resolveSegments(world, show, ctx())[0]!.performances[0]!;
  return { positive: performance.positiveHeatDelta, negative: performance.negativeHeatDelta };
}

describe("segments", () => {
  // One row per cell of the heat table documented in segment.ts: a stated
  // direction lands as played, and `mixed` is resolved by the character.
  const heatRows: Array<[SegmentIntent, Alignment, number, number]> = [
    ["build_sympathy", "face", 10, 0],
    ["build_sympathy", "heel", 10, 0],
    ["build_sympathy", "tweener", 10, 0],
    ["generate_hostility", "face", 0, 10],
    ["generate_hostility", "heel", 0, 10],
    ["generate_hostility", "tweener", 0, 10],
    ["escalate_rivalry", "face", 2, 0],
    ["escalate_rivalry", "heel", 0, 2],
    ["escalate_rivalry", "tweener", 1, 1],
    ["stay_controlled", "face", 0, 0],
    ["stay_controlled", "heel", 0, 0],
    ["stay_controlled", "tweener", 0, 0],
  ];
  it.each(heatRows)("gives a %s promo by a %s +%i / -%i heat", (intent, alignment, positive, negative) => {
    expect(soloHeat(alignment, intent)).toEqual({ positive, negative });
  });

  it("lets an adhered beat's planned heat direction speak for the wrestler it books as dominant", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    world.wrestlers[0]!.alignment = "face";
    world.wrestlers[1]!.alignment = "heel";
    const show: Show = { id: "show-beat", tick: 0, kind: "tv", card: [{
      kind: "segment", id: "ambush", participantWrestlerIds: ["wrestler-0", "wrestler-1"], position: "main_event",
      intents: { "wrestler-0": "escalate_rivalry", "wrestler-1": "build_sympathy" },
      plannedOutcome: {
        intendedDominantWrestlerId: "wrestler-1", intendedHeatDirection: "negative",
        intendedStoryEffect: "Escalate the conflict and make the payoff unavoidable.",
        protectedWrestlerIds: [], adherenceStrength: "strict",
      },
    }] };
    world.shows.push(show);
    const [result] = resolveSegments(world, show, ctx());
    expect(result?.adherence).toBe("adhered");
    expect(result?.actualOutcome?.heatDirection).toBe("negative");
    // The booked angle is hostile, so the heel who ran it draws boos even
    // though their own intent played for sympathy.
    const heel = result?.performances.find((performance) => performance.wrestlerId === "wrestler-1");
    expect(heel).toMatchObject({ positiveHeatDelta: 0, negativeHeatDelta: 10 });
    // The face was not the booked dominant, so they read through their own
    // mixed intent and their alignment: cheered for standing up to it.
    const face = result?.performances.find((performance) => performance.wrestlerId === "wrestler-0");
    expect(face?.positiveHeatDelta).toBeGreaterThan(0);
    expect(face?.negativeHeatDelta).toBe(0);
    expect(world.wrestlers.every((wrestler) => wrestler.condition >= 70)).toBe(true);
  });

  it("counts a segment as an appearance for popularity and story advancement", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    world.stories.push({ id: "story", participantWrestlerIds: ["wrestler-0", "wrestler-1"], tension: "grudge", tensionDescription: "A simmering grudge", stakes: "pride", audienceInterest: 45, momentum: 0, coherence: 60, phase: "building", unresolvedDevelopments: [] });
    const show: Show = { id: "show-story-segment", tick: 0, kind: "tv", card: [{
      kind: "segment", id: "angle", participantWrestlerIds: ["wrestler-0", "wrestler-1"], storyId: "story", position: "mid",
      intents: { "wrestler-0": "escalate_rivalry", "wrestler-1": "promote_opponent" },
    }] };
    world.shows.push(show);
    const context = ctx();
    const [result] = resolveSegments(world, show, context);
    world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.fatigue = 50;
    const before = world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.currentReaction;
    updatePopularity(world, context, [], [result!]);
    advanceStories(world, context, [], [result!]);
    expect(world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.currentReaction).not.toBe(before);
    expect(world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.fatigue).toBe(50);
    expect(world.stories[0]!.audienceInterest).toBeGreaterThan(45);
  });

  it("uses a segment for an eligible TV building story when scenario tuning selects it", () => {
    const world = createTestWorld({ wrestlerCount: 8, humanCount: 0 });
    world.config.booking.segmentChance = 1;
    world.stories.push({ id: "story-booking", participantWrestlerIds: ["wrestler-0", "wrestler-2"], tension: "grudge", tensionDescription: "An on-air dispute", stakes: "pride", audienceInterest: 50, momentum: 0, coherence: 60, phase: "building", unresolvedDevelopments: [] });
    const show = bookShow(world, ctx(), 2);
    expect(show.card.some((slot) => slot.kind === "segment" && slot.storyId === "story-booking")).toBe(true);
  });
});

/**
 * Isolated fixtures passed for three phases while the composed loop scored
 * every promo participant as a match loser (PLAN 3.12 series rules), so the
 * appearance model is also asserted against real multi-week `runTick` runs.
 */
describe("segments over a live tick loop", () => {
  function segmentImpacts(world: WorldState, wrestlerIds?: readonly string[]): PopularityImpact[] {
    return world.segmentResults
      .flatMap((result) => result.performances)
      .filter((performance) => wrestlerIds === undefined || wrestlerIds.includes(performance.wrestlerId))
      .flatMap((performance) => performance.popularityImpact ? [performance.popularityImpact] : []);
  }

  it("runs a three-week promo program between two top stars without burying either", () => {
    const seed = "promo-program";
    let world = createTestWorld({ wrestlerCount: 8, humanCount: 0, seed });
    world.config.booking.segmentChance = 1;
    const stars = ["wrestler-0", "wrestler-2"] as const;
    world.wrestlers.find((wrestler) => wrestler.id === stars[0])!.alignment = "face";
    world.wrestlers.find((wrestler) => wrestler.id === stars[1])!.alignment = "heel";
    // Both stars play the rivalry itself (`escalate_rivalry`, the `mixed` row):
    // the intent a top act's AI reaches for week after week, and the one that
    // used to hand every face nothing but boos.
    for (const id of stars) world.stances.find((stance) => stance.wrestlerId === id)!.stance = "pursue_championships";
    for (const wrestler of world.wrestlers) {
      const popularity = findPopularity(world, wrestler.id);
      const top = (stars as readonly string[]).includes(wrestler.id);
      popularity.generalPopularity = popularity.starPower = popularity.currentReaction = top ? 85 : 45;
      popularity.momentum = 0;
    }
    world.stories.push({
      id: "story-program", participantWrestlerIds: [...stars], tension: "grudge", tensionDescription: "A simmering grudge",
      stakes: "pride", audienceInterest: 60, momentum: 0, coherence: 60, phase: "building", unresolvedDevelopments: [],
    });
    const startingPopularity = new Map(stars.map((id) => [id, findPopularity(world, id).generalPopularity]));
    for (let tick = 0; tick < 3 * (world.config.decisionTicksPerWeek + 1); tick += 1) world = runTick(world, [], seed).world;

    const impacts = segmentImpacts(world, stars);
    expect(world.segmentResults.filter((result) => result.storyId === "story-program").length).toBeGreaterThanOrEqual(2);
    expect(impacts.length).toBeGreaterThanOrEqual(2);
    // The program's own promos never cost the pair popularity on balance, and
    // no single appearance reads as a competitive defeat.
    for (const impact of impacts) {
      expect(impact.edge).toBeGreaterThanOrEqual(0);
      expect(impact.reason).not.toBe("burial");
    }
    expect(impacts.reduce((total, impact) => total + impact.delta, 0)).toBeGreaterThanOrEqual(0);
    for (const id of stars) {
      expect(findPopularity(world, id).generalPopularity).toBeGreaterThanOrEqual(startingPopularity.get(id)! - 2);
    }
    // Undercard matches can still bury a lesser act; neither star of the
    // program does, because the program itself is all they ran.
    const buried = world.events.filter((event) => event.type === "popularity_changed" && event.data.reason === "burial");
    expect(buried.some((event) => event.wrestlerIds.some((id) => (stars as readonly string[]).includes(id)))).toBe(false);
    // Alignment decides the pool for the rivalry itself, so the face's cheers
    // outgrow the boos a hostile booked angle can still put on them — before
    // this phase every one of these appearances was negative heat only.
    const faceHeat = world.segmentResults
      .flatMap((result) => result.performances)
      .filter((performance) => performance.wrestlerId === stars[0]);
    const cheers = faceHeat.reduce((total, performance) => total + performance.positiveHeatDelta, 0);
    const boos = faceHeat.reduce((total, performance) => total + performance.negativeHeatDelta, 0);
    expect(cheers).toBeGreaterThan(boos);
  });

  it("keeps eight weeks of weekly programming on the shipped scenario from bleeding the roster", () => {
    const scenario = loadDefaultScenario();
    const seed = "slice-wwe-2026-1";
    const run = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 8);
    const analysis = analyzeSlice(run);
    const world = run.finalWorld;

    const promos = segmentImpacts(world);
    expect(promos.length).toBeGreaterThan(0);
    expect(promos.every((impact) => impact.edge >= 0)).toBe(true);
    expect(promos.some((impact) => impact.reason === "burial")).toBe(false);
    // Matches still carry the competitive edge, so real burials keep firing.
    const matches = world.matchResults.flatMap((result) => result.performances)
      .flatMap((performance) => performance.popularityImpact ? [performance.popularityImpact] : []);
    expect(matches.some((impact) => impact.reason === "burial")).toBe(true);

    // Programs now pay their participants instead of taxing them: the net
    // roster movement is positive and at least one act visibly climbs.
    expect(analysis.popularityTotals.net).toBeGreaterThan(0);
    expect(analysis.trajectories.some((trajectory) => trajectory.end - trajectory.start >= 10)).toBe(true);
    const worstProgramCost = Math.min(...world.wrestlers.map((wrestler) =>
      segmentImpacts(world, [wrestler.id]).reduce((total, impact) => total + impact.delta, 0)));
    expect(worstProgramCost).toBeGreaterThanOrEqual(-5);
  });
});
