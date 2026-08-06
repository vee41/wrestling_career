import { describe, expect, it } from "vitest";
import type { PlannedBeatType, ProgramCreativeObjective, Story, WorldState } from "@wrestling/contracts";
import { analyzeBooking } from "./booking-metrics.js";
import { createIdFactory } from "./ids.js";
import { createBeatSkeleton, planPrograms, plannedPayoffWinnerId } from "./program-plans.js";
import { createRng } from "./rng.js";
import { runHeadlessSlice } from "./slice.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { worldFromScenario } from "./scenario.js";
import type { TickContext } from "./context.js";

function context(tick: number): TickContext {
  return { tick, rng: createRng(`beat-catalog:${tick}`), ids: createIdFactory(tick), events: [] };
}

/**
 * A world with one story between wrestler-0 and wrestler-1 and enough spare
 * bodies for a showcase opponent or a run-in.
 */
function worldWithStory(tension: Story["tension"]): WorldState {
  const world = createTestWorld({ wrestlerCount: 10, humanCount: 0, seed: `beat-catalog-${tension}` });
  world.stories = [{
    id: "story-1", participantWrestlerIds: ["wrestler-0", "wrestler-1"],
    tension, tensionDescription: "A test premise", stakes: "pride",
    audienceInterest: 90, momentum: 15, coherence: 80, phase: "building", unresolvedDevelopments: [],
  }];
  return world;
}

/** A plan with a chosen objective, skeleton included, without going through the planner's scoring. */
function skeletonFor(objective: ProgramCreativeObjective, tension: Story["tension"] = "title_pursuit") {
  const world = worldWithStory(tension);
  planPrograms(world, context(0));
  const plan = world.programPlans[0]!;
  // Re-issue the skeleton under the objective under test: `objectiveFor` picks
  // from world facts, and this asserts the archetype table itself.
  for (const beat of world.plannedBeats) beat.status = "invalidated";
  plan.creativeObjective = objective;
  const beats = createBeatSkeleton(world, context(0), plan);
  world.plannedBeats.push(...beats);
  return { world, plan, beats, types: beats.map((beat) => beat.type) };
}

describe("beat catalog archetypes", () => {
  it("builds a challenger by having them beat somebody, not by talking about it", () => {
    const { types } = skeletonFor("establish_challenger");
    expect(types).toEqual<PlannedBeatType[]>([
      "promo_interview", "showcase_contender_match", "go_home_angle", "ple_payoff",
    ]);
  });

  it("builds a grudge out of an ambush and an unsettled television fall", () => {
    const { types } = skeletonFor("settle_grudge", "grudge");
    expect(types).toEqual<PlannedBeatType[]>([
      "promo_interview", "attack_save_interference", "direct_rivalry_match", "ple_payoff",
    ]);
  });

  it("argues a championship program in promos", () => {
    const { types } = skeletonFor("retain_championship");
    expect(types).toEqual<PlannedBeatType[]>([
      "promo_interview", "confrontation", "go_home_angle", "ple_payoff",
    ]);
  });

  it("elevates an act by letting them be talked down to and then answering it", () => {
    const { types } = skeletonFor("elevate_act");
    expect(types).toEqual<PlannedBeatType[]>([
      "promo_interview", "confrontation", "showcase_contender_match", "ple_payoff",
    ]);
  });

  it("generates every beat type in the catalog across the archetypes", () => {
    const objectives: ProgramCreativeObjective[] = ["establish_challenger", "settle_grudge", "retain_championship", "elevate_act"];
    const generated = new Set(objectives.flatMap((objective) =>
      skeletonFor(objective, objective === "settle_grudge" ? "grudge" : "title_pursuit").types));
    expect([...generated].sort()).toEqual<PlannedBeatType[]>([
      "attack_save_interference", "confrontation", "direct_rivalry_match",
      "go_home_angle", "ple_payoff", "promo_interview", "showcase_contender_match",
    ]);
  });

  it("trades momentum rather than booking one wrestler to stand tall all month", () => {
    for (const objective of ["establish_challenger", "settle_grudge", "retain_championship", "elevate_act"] as const) {
      const { world, plan, beats } = skeletonFor(objective, objective === "settle_grudge" ? "grudge" : "title_pursuit");
      const winner = plannedPayoffWinnerId(world, plan);
      // Every beat that states a dominant states one of the two, and the pair
      // is not the same wrestler four times over.
      const favoured = beats.flatMap((beat) => beat.plannedSegmentOutcome === undefined ? [] : [beat.plannedSegmentOutcome.intendedDominantWrestlerId]);
      expect(new Set(favoured).size, `${objective} segment dominance`).toBeGreaterThan(1);
      // The last beat before the payoff hands the last word to whoever is
      // about to lose it, so the blowoff is a comeback. The archetypes that
      // close their build with a match state that through the planned finish
      // the composer writes instead — asserted in the live loop below.
      const standsTall = beats.at(-2)!.plannedSegmentOutcome?.intendedDominantWrestlerId;
      if (standsTall !== undefined) expect(standsTall, `${objective} go-home`).not.toBe(winner);
    }
  });

  it("books a showcase against an outsider, never against the rival", () => {
    const { world, plan, beats } = skeletonFor("establish_challenger");
    const showcase = beats.find((beat) => beat.type === "showcase_contender_match")!;
    const core = plan.participants.map((participant) => participant.wrestlerId);
    expect(showcase.requiredParticipantWrestlerIds).toEqual([plannedPayoffWinnerId(world, plan)]);
    expect(showcase.optionalParticipantWrestlerIds.length).toBeGreaterThan(0);
    expect(showcase.optionalParticipantWrestlerIds.some((id) => core.includes(id))).toBe(false);
    expect(showcase.compatibleSlotKind).toBe("match");
    // The showcase is not the rivalry match, so it must not spend that budget.
    expect(showcase.spendsDirectMatchup).toBe(false);
  });

  it("falls back to the complication it stands in for when nobody is free to face the challenger", () => {
    // Two wrestlers, both already inside the program: there is no third body.
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "beat-catalog-empty" });
    world.stories = [{
      id: "story-1", participantWrestlerIds: ["wrestler-0", "wrestler-1"],
      tension: "title_pursuit", tensionDescription: "A test premise", stakes: "pride",
      audienceInterest: 90, momentum: 15, coherence: 80, phase: "building", unresolvedDevelopments: [],
    }];
    planPrograms(world, context(0));
    const plan = world.programPlans[0]!;
    plan.creativeObjective = "establish_challenger";
    const types = createBeatSkeleton(world, context(0), plan).map((beat) => beat.type);
    expect(types).toEqual<PlannedBeatType[]>(["promo_interview", "confrontation", "go_home_angle", "ple_payoff"]);
  });
});

describe("the beat catalog over a live tick loop", () => {
  const scenario = loadDefaultScenario();

  it("runs every beat type, a television match, and outside bodies over eight weeks", () => {
    const seed = "slice-wwe-2026-1";
    const run = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 8);
    const { metrics } = analyzeBooking(run.initialWorld, run.finalWorld);

    // Every one of the seven types is generated. Before this phase three of
    // them were never created at all, on any seed, at any length.
    for (const [type, count] of Object.entries(metrics.beatsGeneratedByType)) {
      expect(count, `${type} generated`).toBeGreaterThan(0);
    }
    // ...and the ones that only exist as matches actually air, so a program is
    // no longer told entirely in promos until the blowoff.
    expect(metrics.televisionMatchBeats).toBeGreaterThan(0);
    expect(metrics.outsideBeatParticipants).toBeGreaterThan(0);
    expect(metrics.programsWithSoleDominant).toBe(0);
    expect(metrics.escalationOrderViolations).toBe(0);
  });

  it("makes a challenger credible by beating a third party before the payoff", () => {
    const seed = "slice-wwe-2026-1";
    const run = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 8);
    const world = run.finalWorld;
    const showcases = world.plannedBeats.filter((beat) => beat.type === "showcase_contender_match" && beat.status === "resolved");
    expect(showcases.length).toBeGreaterThan(0);

    for (const showcase of showcases) {
      const plan = world.programPlans.find((candidate) => candidate.id === showcase.programId)!;
      const core = new Set(plan.participants.map((participant) => participant.wrestlerId));
      const result = world.matchResults.find((candidate) => candidate.plannedBeatId === showcase.id)!;
      expect(result, `${showcase.id} produced a match`).toBeDefined();
      // Exactly one side of the program is in it, and it is the side the
      // program is being built around — the other is somebody else entirely.
      const inside = result.participantWrestlerIds.filter((id) => core.has(id));
      expect(inside).toHaveLength(1);
      expect(result.participantWrestlerIds.length).toBeGreaterThan(1);
      expect(result.plannedFinish?.intendedWinnerWrestlerId, `${showcase.id} builds its own wrestler`).toBe(inside[0]);
      // The showcase aired on television; the payoff is what the PLE is for.
      expect(world.shows.find((show) => show.id === result.showId)?.kind).toBe("tv");
    }
  });

  it("rations the rivalry match to its budget and keeps the pair apart in between", () => {
    let televisionFalls = 0;
    for (const seed of ["slice-wwe-2026-1", "slice-wwe-2026-2"]) {
      const run = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 12);
      const world = run.finalWorld;
      const tickOf = (showId: string | undefined) => world.shows.find((show) => show.id === showId)?.tick;
      // Momentum trades: the television fall in a grudge goes to whoever is
      // booked to lose the blowoff, which is the match-beat half of the
      // dominance trade the golden skeletons cannot see.
      for (const beat of world.plannedBeats.filter((candidate) => candidate.type === "direct_rivalry_match" && candidate.status === "resolved")) {
        const plan = world.programPlans.find((candidate) => candidate.id === beat.programId)!;
        const result = world.matchResults.find((candidate) => candidate.plannedBeatId === beat.id)!;
        televisionFalls += 1;
        expect(result.plannedFinish?.intendedWinnerWrestlerId, `${seed} ${plan.id} television fall`)
          .not.toBe(plannedPayoffWinnerId(world, plan));
      }
      for (const plan of world.programPlans) {
        const spent = world.plannedBeats.filter((beat) =>
          beat.programId === plan.id && beat.spendsDirectMatchup && beat.type !== "ple_payoff" && beat.status === "resolved");
        expect(spent.length, `${seed} ${plan.id} direct matches`).toBeLessThanOrEqual(plan.directMatchRepetitionBudget);
        // The blowoff is exempt from the budget but not from the cooldown: the
        // crowd must not have seen the same match the week before.
        const ticks = world.plannedBeats
          .filter((beat) => beat.programId === plan.id && beat.spendsDirectMatchup && beat.status === "resolved")
          .flatMap((beat) => { const tick = tickOf(beat.scheduledShowId); return tick === undefined ? [] : [tick]; })
          .sort((a, b) => a - b);
        for (const [index, tick] of ticks.slice(1).entries()) {
          expect(tick - ticks[index]!, `${seed} ${plan.id} rivalry cooldown`).toBeGreaterThanOrEqual(plan.directMatchCooldownTicks);
        }
      }
    }
    expect(televisionFalls).toBeGreaterThan(0);
  });

  it("never books an outsider who is hurt or already working elsewhere on the card", () => {
    const seed = "slice-wwe-2026-3";
    const run = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 12);
    const world = run.finalWorld;
    for (const show of world.shows) {
      const appearances = show.card.flatMap((slot) => slot.participantWrestlerIds);
      expect(new Set(appearances).size, `week ${show.tick} double booking`).toBe(appearances.length);
    }
    // Optional participants pass through the same medical gate as anyone else.
    for (const beat of world.plannedBeats.filter((candidate) => candidate.status === "resolved")) {
      const result = [...world.matchResults, ...world.segmentResults].find((candidate) => candidate.plannedBeatId === beat.id);
      if (result === undefined) continue;
      const named = new Set([...beat.requiredParticipantWrestlerIds, ...beat.optionalParticipantWrestlerIds]);
      for (const id of result.participantWrestlerIds) expect(named.has(id), `${beat.id} booked ${id}`).toBe(true);
    }
  });

  it("reproduces an identical beat catalog on a same-seed replay", () => {
    const seed = "slice-wwe-2026-2";
    const signature = () => runHeadlessSlice(worldFromScenario(scenario, seed), seed, 6).finalWorld.plannedBeats
      .map((beat) => `${beat.type}:${beat.status}:${beat.requiredParticipantWrestlerIds.join("+")}:${beat.optionalParticipantWrestlerIds.join("+")}`);
    expect(signature()).toEqual(signature());
  });
});
