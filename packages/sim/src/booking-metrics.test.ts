import {
  worldStateSchema,
  type MatchResult,
  type MatchSlot,
  type PlannedBeat,
  type ProgramPlan,
  type SegmentResult,
  type SegmentSlot,
  type Show,
  type Story,
  type WorldState,
} from "@wrestling/contracts";
import { describe, expect, it } from "vitest";
import { analyzeBooking } from "./booking-metrics.js";
import { worldFromScenario } from "./scenario.js";
import { analyzeSlice, runHeadlessSlice } from "./slice.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { runTick } from "./tick.js";

// A week is 3 ticks by default, so show ticks are 2, 5, 8, 11 and week 4 is
// the PLE. The fixture below scripts two programs against that calendar.
const WEEK_ONE = 2;
const WEEK_TWO = 5;
const WEEK_THREE = 8;
const WEEK_FOUR_PLE = 11;
const WEEK_EIGHT_PLE = 23;

function story(id: string, participants: string[]): Story {
  return {
    id,
    participantWrestlerIds: participants,
    tension: "grudge",
    tensionDescription: `${id} premise`,
    stakes: `${id} stakes`,
    audienceInterest: 60,
    momentum: 5,
    coherence: 70,
    phase: "building",
    unresolvedDevelopments: [],
  };
}

function plan(overrides: Partial<ProgramPlan> & Pick<ProgramPlan, "id" | "storyId" | "participants">): ProgramPlan {
  return {
    premise: `${overrides.id} premise`,
    creativeObjective: "settle_grudge",
    priority: 3,
    startTick: 0,
    targetPayoffTick: WEEK_FOUR_PLE,
    intendedPayoff: "Settle it at the PLE.",
    protectedWrestlerIds: [],
    escalation: 0,
    status: "active",
    plannedBeatIds: [],
    completedBeatIds: [],
    directMatchCooldownTicks: 3,
    directMatchRepetitionBudget: 1,
    revisions: [{ id: `${overrides.id}-rev-0`, tick: 0, reason: "initial_plan", newIntent: {
      creativeObjective: overrides.creativeObjective ?? "settle_grudge",
      targetPayoffTick: overrides.targetPayoffTick ?? WEEK_FOUR_PLE,
      intendedPayoff: "Settle it at the PLE.",
      protectedWrestlerIds: [],
    } }],
    ...overrides,
  };
}

function beat(overrides: Partial<PlannedBeat> & Pick<PlannedBeat, "id" | "programId" | "type" | "requiredParticipantWrestlerIds" | "escalationLevel" | "status">): PlannedBeat {
  const payoff = overrides.type === "ple_payoff";
  return {
    optionalParticipantWrestlerIds: [],
    earliestTick: 0,
    latestTick: WEEK_FOUR_PLE,
    preconditions: { requiredResolvedBeatIds: [], requirePle: payoff },
    intendedStoryEffect: `${overrides.id} effect`,
    spendsDirectMatchup: payoff,
    compatibleSlotKind: payoff ? "match" : "segment",
    resultIds: [],
    ...overrides,
  };
}

function segmentSlot(overrides: Partial<SegmentSlot> & Pick<SegmentSlot, "id" | "participantWrestlerIds">): SegmentSlot {
  return { kind: "segment", position: "mid", intents: {}, ...overrides };
}

function matchSlot(overrides: Partial<MatchSlot> & Pick<MatchSlot, "id" | "participantWrestlerIds">): MatchSlot {
  return { kind: "match", position: "mid", intents: {}, ...overrides };
}

function segmentResult(overrides: Partial<SegmentResult> & Pick<SegmentResult, "id" | "segmentSlotId" | "showId" | "participantWrestlerIds" | "dominantWrestlerId">): SegmentResult {
  return {
    quality: 60,
    crowdResponse: 55,
    storyAdvancement: 10,
    intents: {},
    performances: overrides.participantWrestlerIds.map((wrestlerId) => ({
      wrestlerId, performanceScore: 60, positiveHeatDelta: 2, negativeHeatDelta: 0, storyAdvancement: 5,
    })),
    ...overrides,
  };
}

function matchResult(overrides: Partial<MatchResult> & Pick<MatchResult, "id" | "matchSlotId" | "showId" | "participantWrestlerIds" | "winnerWrestlerId">): MatchResult {
  return {
    quality: 65,
    crowdResponse: 60,
    chemistry: 55,
    storyAdvancement: 10,
    performances: overrides.participantWrestlerIds.map((wrestlerId) => ({
      wrestlerId, performanceScore: 60, characterCredibilityDelta: 0, physicalCost: 10, gmReactionDelta: 0, backstageReactionDelta: 0,
    })),
    ...overrides,
  };
}

/**
 * Two scripted programs against a known calendar: one that ran its whole
 * skeleton into a PLE title payoff, and one that stalled out — plus a repeat
 * pairing on back-to-back shows and one out-of-order escalation, so every
 * metric has a hand-checkable expected value.
 */
function scriptedWorld(): { initialWorld: WorldState; finalWorld: WorldState } {
  const initialWorld = createTestWorld({ wrestlerCount: 6, humanCount: 0, seed: "booking-metrics" });
  // wrestler-1 is skipped: `createTestWorld` gives them the midcard belt, and
  // this fixture only scripts the world title.
  const [champion, , challenger, rivalA, rivalB, filler] =
    initialWorld.wrestlers.map((wrestler) => wrestler.id) as [string, string, string, string, string, string];

  const built = plan({
    id: "program-built", storyId: "story-built", creativeObjective: "retain_championship", stakesTitleId: "world-title",
    participants: [{ wrestlerId: champion, role: "antagonist" }, { wrestlerId: challenger, role: "protagonist" }],
    status: "resolved", escalation: 3, priority: 5,
  });
  const stalled = plan({
    id: "program-stalled", storyId: "story-stalled", startTick: WEEK_ONE, targetPayoffTick: WEEK_EIGHT_PLE,
    participants: [{ wrestlerId: rivalA, role: "protagonist" }, { wrestlerId: rivalB, role: "antagonist" }],
    revisions: [
      { id: "program-stalled-rev-0", tick: WEEK_ONE, reason: "initial_plan", newIntent: {
        creativeObjective: "settle_grudge", targetPayoffTick: WEEK_FOUR_PLE, intendedPayoff: "Settle it at the PLE.", protectedWrestlerIds: [],
      } },
      // An audit-only revision: same intent in and out (the Phase 3.12.4 defect).
      { id: "program-stalled-rev-1", tick: WEEK_TWO, reason: "crowd_response", response: "cool_down",
        previousIntent: { creativeObjective: "settle_grudge", targetPayoffTick: WEEK_FOUR_PLE, intendedPayoff: "Settle it at the PLE.", protectedWrestlerIds: [] },
        newIntent: { creativeObjective: "settle_grudge", targetPayoffTick: WEEK_FOUR_PLE, intendedPayoff: "Settle it at the PLE.", protectedWrestlerIds: [] } },
      // A revision that genuinely moves the payoff to the following PLE.
      { id: "program-stalled-rev-2", tick: WEEK_THREE, reason: "title_change", response: "extend",
        previousIntent: { creativeObjective: "settle_grudge", targetPayoffTick: WEEK_FOUR_PLE, intendedPayoff: "Settle it at the PLE.", protectedWrestlerIds: [] },
        newIntent: { creativeObjective: "settle_grudge", targetPayoffTick: WEEK_EIGHT_PLE, intendedPayoff: "Settle it one PLE later.", protectedWrestlerIds: [] } },
    ],
  });

  const beats: PlannedBeat[] = [
    beat({ id: "beat-b1", programId: built.id, type: "promo_interview", requiredParticipantWrestlerIds: [champion, challenger], escalationLevel: 0, status: "resolved", scheduledShowId: "show-w1", resultIds: ["segment-b1"], plannedSegmentOutcome: { intendedDominantWrestlerId: champion, intendedHeatDirection: "negative", intendedStoryEffect: "Set the stakes.", protectedWrestlerIds: [], adherenceStrength: "standard" } }),
    beat({ id: "beat-b2", programId: built.id, type: "confrontation", requiredParticipantWrestlerIds: [champion, challenger], escalationLevel: 1, status: "resolved", scheduledShowId: "show-w2", resultIds: ["segment-b2"], preconditions: { requiredResolvedBeatIds: ["beat-b1"], requirePle: false } }),
    beat({ id: "beat-b3", programId: built.id, type: "go_home_angle", requiredParticipantWrestlerIds: [champion, challenger], escalationLevel: 2, status: "resolved", scheduledShowId: "show-w3", resultIds: ["segment-b3"], preconditions: { requiredResolvedBeatIds: ["beat-b2"], requirePle: false } }),
    beat({ id: "beat-b4", programId: built.id, type: "ple_payoff", requiredParticipantWrestlerIds: [champion, challenger], escalationLevel: 3, status: "resolved", scheduledShowId: "show-w4", resultIds: ["match-b4"], preconditions: { requiredResolvedBeatIds: ["beat-b3"], requirePle: true } }),
    // The stalled program resolved its escalation-1 interference beat a week
    // *before* its escalation-0 promo: one escalation-order violation.
    beat({ id: "beat-s1", programId: stalled.id, type: "attack_save_interference", requiredParticipantWrestlerIds: [rivalA, rivalB], escalationLevel: 1, status: "resolved", scheduledShowId: "show-w1", resultIds: ["segment-s1"] }),
    beat({ id: "beat-s2", programId: stalled.id, type: "promo_interview", requiredParticipantWrestlerIds: [rivalA, rivalB], escalationLevel: 0, status: "resolved", scheduledShowId: "show-w2", resultIds: ["segment-s2"] }),
    beat({ id: "beat-s3", programId: stalled.id, type: "go_home_angle", requiredParticipantWrestlerIds: [rivalA, rivalB], escalationLevel: 2, status: "skipped", earliestTick: WEEK_THREE, latestTick: WEEK_THREE }),
    beat({ id: "beat-s4", programId: stalled.id, type: "ple_payoff", requiredParticipantWrestlerIds: [rivalA, rivalB], escalationLevel: 3, status: "provisional", earliestTick: WEEK_EIGHT_PLE, latestTick: WEEK_EIGHT_PLE, preconditions: { requiredResolvedBeatIds: ["beat-s3"], requirePle: true } }),
  ];
  built.plannedBeatIds = ["beat-b1", "beat-b2", "beat-b3", "beat-b4"];
  built.completedBeatIds = ["beat-b1", "beat-b2", "beat-b3", "beat-b4"];
  stalled.plannedBeatIds = ["beat-s1", "beat-s2", "beat-s3", "beat-s4"];
  stalled.completedBeatIds = ["beat-s1", "beat-s2"];

  const shows: Show[] = [
    { id: "show-w1", tick: WEEK_ONE, kind: "tv", card: [
      segmentSlot({ id: "slot-w1-a", participantWrestlerIds: [champion, challenger], position: "main_event", storyId: built.storyId, programId: built.id, plannedBeatId: "beat-b1", plannedOutcome: { intendedDominantWrestlerId: champion, intendedHeatDirection: "negative", intendedStoryEffect: "Set the stakes.", protectedWrestlerIds: [], adherenceStrength: "standard" } }),
      segmentSlot({ id: "slot-w1-b", participantWrestlerIds: [rivalA, rivalB], position: "opener", storyId: stalled.storyId, programId: stalled.id, plannedBeatId: "beat-s1", plannedOutcome: { intendedDominantWrestlerId: rivalA, intendedHeatDirection: "positive", intendedStoryEffect: "Run the ambush.", protectedWrestlerIds: [], adherenceStrength: "standard" } }),
    ] },
    { id: "show-w2", tick: WEEK_TWO, kind: "tv", card: [
      segmentSlot({ id: "slot-w2-a", participantWrestlerIds: [champion, challenger], position: "main_event", storyId: built.storyId, programId: built.id, plannedBeatId: "beat-b2" }),
      segmentSlot({ id: "slot-w2-b", participantWrestlerIds: [rivalA, rivalB], position: "upper", storyId: stalled.storyId, programId: stalled.id, plannedBeatId: "beat-s2" }),
      matchSlot({ id: "slot-w2-c", participantWrestlerIds: [rivalB, filler], position: "mid" }),
    ] },
    { id: "show-w3", tick: WEEK_THREE, kind: "tv", card: [
      segmentSlot({ id: "slot-w3-a", participantWrestlerIds: [champion, challenger], position: "main_event", storyId: built.storyId, programId: built.id, plannedBeatId: "beat-b3" }),
      // The same pair on back-to-back shows: one direct rematch, one consecutive pairing.
      matchSlot({ id: "slot-w3-b", participantWrestlerIds: [rivalB, filler], position: "opener" }),
    ] },
    { id: "show-w4", tick: WEEK_FOUR_PLE, kind: "ple", card: [
      matchSlot({ id: "slot-w4-a", participantWrestlerIds: [champion, challenger], position: "main_event", storyId: built.storyId, programId: built.id, plannedBeatId: "beat-b4", titleId: "world-title", plannedFinish: { intendedWinnerWrestlerId: champion, finishFamily: "dirty", protectedWrestlerIds: [challenger], intendedTitleConsequence: "retain", intendedStoryEffect: "Keep the belt, keep the heat.", adherenceStrength: "strict" } }),
      matchSlot({ id: "slot-w4-b", participantWrestlerIds: [rivalA, filler], position: "mid" }),
    ] },
  ];

  const finalWorld: WorldState = {
    ...structuredClone(initialWorld),
    tick: WEEK_FOUR_PLE + 1,
    stories: [story("story-built", [champion, challenger]), story("story-stalled", [rivalA, rivalB])],
    programPlans: [built, stalled],
    plannedBeats: beats,
    shows,
    segmentResults: [
      segmentResult({ id: "segment-b1", segmentSlotId: "slot-w1-a", showId: "show-w1", participantWrestlerIds: [champion, challenger], dominantWrestlerId: champion, storyId: "story-built", programId: built.id, plannedBeatId: "beat-b1",
        plannedOutcome: { intendedDominantWrestlerId: champion, intendedHeatDirection: "negative", intendedStoryEffect: "Set the stakes.", protectedWrestlerIds: [], adherenceStrength: "standard" },
        actualOutcome: { dominantWrestlerId: champion, heatDirection: "negative", storyEffect: "Set the stakes." }, adherence: "adhered" }),
      // A deviated segment: the planned focal participant refused.
      segmentResult({ id: "segment-s1", segmentSlotId: "slot-w1-b", showId: "show-w1", participantWrestlerIds: [rivalA, rivalB], dominantWrestlerId: rivalB, storyId: "story-stalled", programId: stalled.id, plannedBeatId: "beat-s1",
        plannedOutcome: { intendedDominantWrestlerId: rivalA, intendedHeatDirection: "positive", intendedStoryEffect: "Run the ambush.", protectedWrestlerIds: [], adherenceStrength: "standard" },
        actualOutcome: { dominantWrestlerId: rivalB, heatDirection: "neutral", storyEffect: "Execution disruption requires the program to replan." }, adherence: "deviated", deviationCause: "refusal" }),
      segmentResult({ id: "segment-b2", segmentSlotId: "slot-w2-a", showId: "show-w2", participantWrestlerIds: [champion, challenger], dominantWrestlerId: champion, storyId: "story-built", programId: built.id, plannedBeatId: "beat-b2" }),
      segmentResult({ id: "segment-s2", segmentSlotId: "slot-w2-b", showId: "show-w2", participantWrestlerIds: [rivalA, rivalB], dominantWrestlerId: rivalA, storyId: "story-stalled", programId: stalled.id, plannedBeatId: "beat-s2" }),
      segmentResult({ id: "segment-b3", segmentSlotId: "slot-w3-a", showId: "show-w3", participantWrestlerIds: [champion, challenger], dominantWrestlerId: champion, storyId: "story-built", programId: built.id, plannedBeatId: "beat-b3" }),
    ],
    matchResults: [
      matchResult({ id: "match-w2-c", matchSlotId: "slot-w2-c", showId: "show-w2", participantWrestlerIds: [rivalB, filler], winnerWrestlerId: rivalB, storyAdvancement: 0 }),
      matchResult({ id: "match-w3-b", matchSlotId: "slot-w3-b", showId: "show-w3", participantWrestlerIds: [rivalB, filler], winnerWrestlerId: filler, storyAdvancement: 0 }),
      matchResult({ id: "match-b4", matchSlotId: "slot-w4-a", showId: "show-w4", participantWrestlerIds: [champion, challenger], winnerWrestlerId: champion, storyId: "story-built", programId: built.id, plannedBeatId: "beat-b4",
        plannedFinish: { intendedWinnerWrestlerId: champion, finishFamily: "dirty", protectedWrestlerIds: [challenger], intendedTitleConsequence: "retain", intendedStoryEffect: "Keep the belt, keep the heat.", adherenceStrength: "strict" },
        actualOutcome: { winnerWrestlerId: champion, finishFamily: "dirty", titleConsequence: "retain", storyEffect: "Keep the belt, keep the heat." }, adherence: "adhered", storyAdvancement: 20 }),
      matchResult({ id: "match-w4-b", matchSlotId: "slot-w4-b", showId: "show-w4", participantWrestlerIds: [rivalA, filler], winnerWrestlerId: rivalA, storyAdvancement: 0 }),
    ],
    events: [
      { id: "event-defense", tick: WEEK_FOUR_PLE, type: "title_change", summary: "The champion retained.", wrestlerIds: [champion], data: { titleId: "world-title", defended: true } },
    ],
  };

  return { initialWorld, finalWorld: worldStateSchema.parse(finalWorld) };
}

describe("booking metrics", () => {
  const { initialWorld, finalWorld } = scriptedWorld();
  const { metrics, timelines } = analyzeBooking(initialWorld, finalWorld);

  it("counts program lifecycle and duration against a known program history", () => {
    expect(metrics.programsCreated).toBe(2);
    expect(metrics.programsResolved).toBe(1);
    expect(metrics.programsAbandoned).toBe(0);
    expect(metrics.programsOpen).toBe(1);
    expect(metrics.completionRate).toBeCloseTo(0.5);
    // The built program ran weeks 1-4; the stalled one never ended.
    expect(metrics.medianProgramDurationWeeks).toBe(4);
    expect(metrics.medianBeatsBeforePayoff).toBe(3);
  });

  it("reports every beat type, including the ones the planner never generates", () => {
    expect(metrics.beatsGeneratedByType).toEqual({
      promo_interview: 2, confrontation: 1, attack_save_interference: 1,
      showcase_contender_match: 0, direct_rivalry_match: 0, go_home_angle: 2, ple_payoff: 2,
    });
    expect(metrics.beatsResolvedByType.ple_payoff).toBe(1);
    expect(metrics.beatsResolvedByType.direct_rivalry_match).toBe(0);
    expect(metrics.beatsByStatus).toEqual({ provisional: 1, scheduled: 0, resolved: 6, skipped: 1, invalidated: 0 });
  });

  it("measures PLE build, repeat pairings, and escalation order", () => {
    // Only the title payoff is a PLE story/title match, and it had 3 prior beats.
    expect(metrics.pleBuildCoverage).toEqual({ built: 1, total: 1, share: 1 });
    expect(metrics.directRematches).toBe(1);
    expect(metrics.consecutivePairings).toBe(1);
    expect(metrics.escalationOrderViolations).toBe(1);
  });

  it("separates revisions that changed the plan from audit-only entries", () => {
    expect(metrics.revisionsByCause.crowd_response).toBe(1);
    expect(metrics.revisionsByCause.title_change).toBe(1);
    expect(metrics.revisionsByCause.execution_deviation).toBe(0);
    expect(metrics.revisionsByResponse).toMatchObject({ cool_down: 1, extend: 1, pivot: 0 });
    expect(metrics.noOpRevisions).toBe(1);
    const stalled = timelines.find((timeline) => timeline.programId === "program-stalled")!;
    expect(stalled.revisions.map((revision) => revision.changedFields)).toEqual([[], [], ["targetPayoffTick", "intendedPayoff"]]);
  });

  it("tracks planned-finish adherence with its deviation causes", () => {
    expect(metrics.finishAdherence.planned).toBe(3);
    expect(metrics.finishAdherence.adhered).toBe(2);
    expect(metrics.finishAdherence.deviated).toBe(1);
    expect(metrics.finishAdherence.deviationCauses.refusal).toBe(1);
    expect(metrics.finishAdherence.deviationCauses.injury).toBe(0);
  });

  it("measures segment story share, main-event and challenger diversity", () => {
    // Story advancement: 50 from five segments, 20 from the payoff match.
    expect(metrics.segmentStoryAdvancementShare).toBeCloseTo(50 / 70);
    expect(metrics.distinctMainEventers).toBe(2);
    // The champion held the belt going in, so only the challenger counts.
    expect(metrics.distinctTitleChallengers).toBe(1);
  });

  it("explains, per program, what ran and why an open program has not paid off", () => {
    const built = timelines.find((timeline) => timeline.programId === "program-built")!;
    expect(built.beats.map((beat) => beat.type)).toEqual(["promo_interview", "confrontation", "go_home_angle", "ple_payoff"]);
    expect(built.beats.map((beat) => beat.scheduledWeek)).toEqual([1, 2, 3, 4]);
    expect(built.endWeek).toBe(4);
    expect(built.openReason).toBeUndefined();
    expect(built.beats.at(-1)!.execution).toMatchObject({
      planned: { wrestlerId: built.participants[0]!.wrestlerId, finishFamily: "dirty", titleConsequence: "retain" },
      actual: { wrestlerId: built.participants[0]!.wrestlerId, finishFamily: "dirty", titleConsequence: "retain" },
      adherence: "adhered",
    });

    const stalled = timelines.find((timeline) => timeline.programId === "program-stalled")!;
    // The plan extended to week 8 rather than sitting on a window that closed:
    // what is left to explain is the prerequisite its payoff still waits on.
    expect(stalled.openReason).toBe("ple_payoff waits on unresolved go_home_angle (skipped)");
    expect(stalled.beats.find((beat) => beat.type === "ple_payoff")!.blockedByBeatTypes).toEqual(["go_home_angle"]);
    expect(stalled.beats.find((beat) => beat.type === "attack_save_interference")!.execution).toMatchObject({
      adherence: "deviated", deviationCause: "refusal",
    });
  });
});

/**
 * Isolated fixtures already passed while the composed system misbehaved
 * (PLAN 3.12 series rules), so the metrics are also measured against a real
 * multi-week `runTick` loop on the shipped scenario.
 */
describe("booking metrics over a live tick loop", () => {
  const weeks = 8;
  const scenario = loadDefaultScenario();
  const seed = "booking-metrics-live";
  let world = worldFromScenario(scenario, seed);
  const ticks = weeks * (world.config.decisionTicksPerWeek + 1);
  for (let index = 0; index < ticks; index += 1) world = runTick(world, [], seed).world;
  const { metrics, timelines } = analyzeBooking(worldFromScenario(scenario, seed), world);

  it("accounts for every plan and beat the live loop produced", () => {
    expect(metrics.programsCreated).toBe(world.programPlans.length);
    expect(metrics.programsResolved + metrics.programsAbandoned + metrics.programsOpen).toBe(metrics.programsCreated);
    expect(timelines).toHaveLength(world.programPlans.length);
    const statusTotal = Object.values(metrics.beatsByStatus).reduce((total, count) => total + count, 0);
    expect(statusTotal).toBe(world.plannedBeats.length);
    expect(Object.values(metrics.beatsGeneratedByType).reduce((total, count) => total + count, 0)).toBe(world.plannedBeats.length);
    expect(metrics.beatsResolvedByType.ple_payoff).toBeLessThanOrEqual(metrics.beatsByStatus.resolved);
  });

  it("explains every open program and every resolved beat's planned-versus-actual", () => {
    for (const timeline of timelines) {
      const open = timeline.status !== "resolved" && timeline.status !== "abandoned";
      if (open) expect(timeline.openReason).toBeTruthy();
      else expect(timeline.openReason).toBeUndefined();
      for (const beat of timeline.beats.filter((candidate) => candidate.status === "resolved")) {
        expect(beat.scheduledWeek).toBeGreaterThan(0);
        expect(beat.execution.planned ?? beat.execution.actual).toBeDefined();
        expect(beat.execution.adherence).toBeDefined();
      }
    }
  });

  it("windows the private planner candidate trace instead of growing it every tick", () => {
    const retention = world.config.booking.programCandidateRetentionTicks;
    expect(world.programPlanCandidates.length).toBeGreaterThan(0);
    expect(world.programPlanCandidates.every((candidate) => candidate.tick > world.tick - 1 - retention)).toBe(true);
    // Two candidates per planning pass, two passes per tick, worst case.
    expect(world.programPlanCandidates.length).toBeLessThanOrEqual(retention * 4);
  });

  it("labels the slice show cards with the beat each slot executed", () => {
    const analysis = analyzeSlice(runHeadlessSlice(worldFromScenario(scenario, seed), seed, weeks));
    const slots = analysis.showCards.flatMap((card) => card.slots);
    const planned = slots.filter((slot) => slot.beat !== undefined);
    expect(planned.length).toBeGreaterThan(0);
    for (const slot of planned) {
      const beat = world.plannedBeats.find((candidate) => candidate.id === slot.beat!.plannedBeatId);
      expect(slot.beat!.type).toBe(beat?.type);
      expect(slot.beat!.escalationLevel).toBe(beat?.escalationLevel);
      expect(slot.execution.planned).toBeDefined();
      expect(slot.execution.actual).toBeDefined();
    }
    expect(analysis.weeks).toBe(weeks);
    expect(analysis.criteriaAdvisory).toBe(true);
    expect(analysis.criteriaHorizonWeeks).toBe(scenario.config.sliceWeeks);
  });
});
