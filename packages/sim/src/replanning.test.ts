import { describe, expect, it } from "vitest";
import {
  programRevisionReasonSchema,
  programRevisionResponseSchema,
  type PlannedBeat,
  type ProgramPlan,
  type ProgramPlanRevision,
  type ProgramRevisionReason,
  type ProgramRevisionResponse,
  type SegmentResult,
  type Story,
  type WorldState,
} from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import {
  abandonProgramPlan,
  accelerateProgramPlan,
  coolDownProgramPlan,
  extendProgramPlan,
  pivotProgramPlan,
  planPrograms,
  replanBeforeBooking,
  replanForExecutionDeviation,
  replanForPlayerPitch,
  replanForPlayerResponse,
  replanForTitleChange,
  selectPlannedBeatsForShow,
} from "./program-plans.js";
import { createIdFactory } from "./ids.js";
import { isShowTick } from "./booking.js";
import { createRng } from "./rng.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { resolveInteractions } from "./interactions.js";
import { resolveReactiveResponses } from "./responses.js";
import { runTick } from "./tick.js";
import { worldFromScenario } from "./scenario.js";

function ctxAt(tick: number, seed = "replan"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function beatsOf(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return world.plannedBeats.filter((beat) => beat.programId === plan.id);
}

function story(id: string, participants: string[], overrides: Partial<Story> = {}): Story {
  return {
    id, participantWrestlerIds: participants, tension: "grudge",
    tensionDescription: `${id} is a test rivalry.`, stakes: "test stakes",
    audienceInterest: 80, momentum: 12, coherence: 75, phase: "building",
    unresolvedDevelopments: [], ...overrides,
  };
}

/** One planned program per story on a synthetic world, ready to be replanned. */
function plannedWorld(seed = "replan-world", stories = 1): WorldState {
  const world = createTestWorld({ wrestlerCount: 4 + stories * 2, humanCount: 0, seed });
  world.stories = Array.from({ length: stories }, (_, index) =>
    story(`story-${index}`, [`wrestler-${index * 2}`, `wrestler-${index * 2 + 1}`]));
  planPrograms(world, ctxAt(0, seed));
  expect(world.programPlans).toHaveLength(stories);
  return world;
}

/** Beats whose booked heat has a direction the crowd can contradict. */
function directedBeats(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return beatsOf(world, plan).filter((beat) =>
    beat.plannedSegmentOutcome?.intendedHeatDirection === "positive"
    || beat.plannedSegmentOutcome?.intendedHeatDirection === "negative");
}

function lastRevision(plan: ProgramPlan): ProgramPlanRevision {
  return plan.revisions.at(-1)!;
}

/** A revision that records a change must contain one. */
function changed(revision: ProgramPlanRevision): boolean {
  return JSON.stringify(revision.previousIntent) !== JSON.stringify(revision.newIntent);
}

function resolveBeat(world: WorldState, beat: PlannedBeat): void {
  beat.status = "resolved";
  const plan = world.programPlans.find((candidate) => candidate.id === beat.programId)!;
  plan.completedBeatIds.push(beat.id);
  plan.escalation = Math.max(plan.escalation, beat.escalationLevel);
}

/** A resolved segment whose heat landed the opposite way to the booked direction. */
function contradictingSegment(world: WorldState, beat: PlannedBeat, dominantWrestlerId: string): SegmentResult {
  const planned = beat.plannedSegmentOutcome!;
  const result: SegmentResult = {
    id: `segment-${beat.id}`, segmentSlotId: `slot-${beat.id}`, showId: "show-x",
    participantWrestlerIds: [...beat.requiredParticipantWrestlerIds], dominantWrestlerId,
    quality: 60, crowdResponse: 60, storyAdvancement: 5,
    plannedOutcome: planned,
    actualOutcome: {
      dominantWrestlerId,
      heatDirection: planned.intendedHeatDirection === "positive" ? "negative" : "positive",
      storyEffect: "It landed the other way.",
    },
    adherence: "deviated", deviationCause: "dominant_conflicting_intent",
    intents: Object.fromEntries(beat.requiredParticipantWrestlerIds.map((id) => [id, "escalate_rivalry" as const])),
    performances: beat.requiredParticipantWrestlerIds.map((id) => ({
      wrestlerId: id, performanceScore: 60, positiveHeatDelta: 0, negativeHeatDelta: 2, storyAdvancement: 2,
    })),
  };
  world.segmentResults.push(result);
  beat.resultIds.push(result.id);
  resolveBeat(world, beat);
  return result;
}

/**
 * Phase 3.12.4's acceptance tests. Before this phase every replanning path
 * handed the *unchanged* plan snapshot back, so a revision recorded a decision
 * nobody had made — `substitute_beat` and `pivot` were the only two of the six
 * responses that existed, and the `crowd_response`, `repetition`,
 * `payoff_capacity`, `player_pitch` and `player_response` triggers were dead
 * tokens. Each test below therefore asserts on the *effect*, not on the fact
 * that a revision was written.
 */
describe("response primitives mutate the plan", () => {
  it("accelerates by pulling the payoff in and opening the remaining beats now", () => {
    const world = plannedWorld("accelerate");
    const plan = world.programPlans[0]!;
    const target = plan.targetPayoffTick;
    resolveBeat(world, beatsOf(world, plan)[0]!);

    expect(accelerateProgramPlan(world, ctxAt(target - 4), plan, "manual", "the crowd is ready.")).toBe(true);
    expect(lastRevision(plan)).toMatchObject({ reason: "manual", response: "accelerate" });
    expect(changed(lastRevision(plan))).toBe(true);
    const open = beatsOf(world, plan).filter((beat) => beat.status === "provisional" && beat.type !== "ple_payoff");
    expect(open.every((beat) => beat.earliestTick <= target - 3)).toBe(true);
  });

  it("declines to accelerate a program that has no build to cash in", () => {
    const world = plannedWorld("accelerate-empty");
    const plan = world.programPlans[0]!;
    expect(accelerateProgramPlan(world, ctxAt(1), plan, "manual", "nothing has aired.")).toBe(false);
    expect(plan.revisions).toHaveLength(1);
  });

  it("extends to a later event and adds one keep-warm beat when the build is spent", () => {
    const world = plannedWorld("extend");
    const plan = world.programPlans[0]!;
    const target = plan.targetPayoffTick;
    for (const beat of beatsOf(world, plan).filter((candidate) => candidate.type !== "ple_payoff")) resolveBeat(world, beat);

    expect(extendProgramPlan(world, ctxAt(target - 1), plan, "manual", "the payoff needs another cycle.")).toBe(true);
    expect(plan.targetPayoffTick).toBeGreaterThan(target);
    expect(lastRevision(plan)).toMatchObject({ reason: "manual", response: "extend" });
    expect(changed(lastRevision(plan))).toBe(true);

    const warm = beatsOf(world, plan).filter((beat) => beat.status === "provisional" && beat.type !== "ple_payoff");
    expect(warm).toHaveLength(1);
    // Keep-warm work must not gate the blowoff, or extending a payoff-ready
    // program would quietly un-ready it.
    const payoff = beatsOf(world, plan).find((beat) => beat.type === "ple_payoff")!;
    expect(payoff.preconditions.requiredResolvedBeatIds).not.toContain(warm[0]!.id);
    expect(payoff.earliestTick).toBe(plan.targetPayoffTick);
  });

  it("cools a program down by taking it off television until the freeze lifts", () => {
    const world = plannedWorld("cool");
    const plan = world.programPlans[0]!;
    const first = beatsOf(world, plan).find((beat) => beat.type !== "ple_payoff")!;
    const airsAt = first.earliestTick;

    expect(coolDownProgramPlan(world, ctxAt(airsAt - 1), plan, "manual", "the crowd needs a rest from it.")).toBe(true);
    expect(lastRevision(plan)).toMatchObject({ reason: "manual", response: "cool_down" });
    expect(plan.beatsFrozenUntilTick).toBe(airsAt - 1 + world.config.booking.coolDownTicks);
    expect(selectPlannedBeatsForShow(world, ctxAt(airsAt), airsAt, 4)).toEqual([]);
    // Frozen, not cancelled: the beats are still there when the freeze lifts.
    expect(beatsOf(world, plan).some((beat) => beat.status === "provisional" && beat.type !== "ple_payoff")).toBe(true);

    let thawed = plan.beatsFrozenUntilTick!;
    while (!isShowTick(thawed, world.config)) thawed++;
    expect(selectPlannedBeatsForShow(world, ctxAt(thawed), thawed, 4).length).toBeGreaterThan(0);
  });

  it("pivots behind a participant and makes the beats still to come speak for them", () => {
    const world = plannedWorld("pivot");
    const plan = world.programPlans[0]!;
    const favoured = plan.participants[1]!.wrestlerId;

    expect(pivotProgramPlan(world, ctxAt(1), plan, "manual", "the crowd picked them", favoured)).toBe(true);
    expect(plan.protectedWrestlerIds).toEqual([favoured]);
    for (const beat of beatsOf(world, plan).filter((candidate) => candidate.plannedSegmentOutcome !== undefined && candidate.status === "provisional")) {
      expect(beat.plannedSegmentOutcome?.intendedDominantWrestlerId).toBe(favoured);
    }
    // Pivoting to where the plan already stands changes nothing, so it records
    // nothing rather than writing an audit entry that lies.
    expect(pivotProgramPlan(world, ctxAt(2), plan, "manual", "the crowd picked them", favoured)).toBe(false);
    expect(pivotProgramPlan(world, ctxAt(2), plan, "manual", "not in this program", "wrestler-99")).toBe(false);
  });

  it("abandons a program by invalidating its remaining beats and cooling the story", () => {
    const world = plannedWorld("abandon");
    const plan = world.programPlans[0]!;
    abandonProgramPlan(world, ctxAt(3), plan, "manual", "there is nowhere left to take it.");
    expect(plan.status).toBe("abandoned");
    expect(lastRevision(plan)).toMatchObject({ reason: "manual", response: "abandon" });
    expect(beatsOf(world, plan).every((beat) => beat.status === "invalidated")).toBe(true);
    expect(world.stories[0]?.phase).toBe("cooling");
  });
});

describe("state-driven replanning triggers", () => {
  it("pivots on crowd response when the heat keeps landing the other way", () => {
    const world = plannedWorld("crowd-heat");
    const plan = world.programPlans[0]!;
    const against = plan.participants[1]!.wrestlerId;
    for (const beat of directedBeats(world, plan).slice(0, world.config.booking.heatContradictionLimit)) {
      contradictingSegment(world, beat, against);
    }

    replanBeforeBooking(world, ctxAt(4, "crowd-heat"));
    const revision = lastRevision(plan);
    expect(revision).toMatchObject({ reason: "crowd_response", response: "pivot" });
    expect(plan.protectedWrestlerIds).toEqual([against]);
    expect(changed(revision)).toBe(true);
  });

  it("cools a program down when interest falls away from its peak with nothing to cash in", () => {
    const world = plannedWorld("crowd-cold");
    const plan = world.programPlans[0]!;
    const cold = world.stories[0]!;
    cold.peakAudienceInterest = 80;
    cold.audienceInterest = 80 - world.config.booking.crowdResponseInterestDrop;

    replanBeforeBooking(world, ctxAt(2, "crowd-cold"));
    expect(lastRevision(plan)).toMatchObject({ reason: "crowd_response", response: "cool_down" });
    // Responding re-bases the peak, so a cold story does not re-trigger forever.
    expect(cold.peakAudienceInterest).toBe(cold.audienceInterest);
    const before = plan.revisions.length;
    replanBeforeBooking(world, ctxAt(3, "crowd-cold"));
    expect(plan.revisions).toHaveLength(before);
  });

  it("accelerates a repetitive program once, then abandons it if it repeats again", () => {
    const world = plannedWorld("repetition");
    const plan = world.programPlans[0]!;
    const limit = world.config.booking.repeatedBeatTypeLimit;
    const template = beatsOf(world, plan).find((beat) => beat.type === "promo_interview")!;
    for (let index = 0; index < limit; index++) {
      const clone: PlannedBeat = { ...structuredClone(template), id: `${template.id}-copy-${index}`, status: "provisional", resultIds: [] };
      world.plannedBeats.push(clone);
      plan.plannedBeatIds.push(clone.id);
      resolveBeat(world, clone);
    }

    replanBeforeBooking(world, ctxAt(4, "repetition"));
    expect(lastRevision(plan)).toMatchObject({ reason: "repetition", response: "accelerate" });

    // The threshold rises with each response, so the same evidence cannot fire
    // again — only a program that goes on repeating itself is abandoned.
    replanBeforeBooking(world, ctxAt(5, "repetition"));
    expect(lastRevision(plan).reason).toBe("repetition");
    expect(lastRevision(plan).response).toBe("accelerate");

    const extra: PlannedBeat = { ...structuredClone(template), id: `${template.id}-copy-extra`, status: "provisional", resultIds: [] };
    world.plannedBeats.push(extra);
    plan.plannedBeatIds.push(extra.id);
    resolveBeat(world, extra);
    replanBeforeBooking(world, ctxAt(6, "repetition"));
    expect(lastRevision(plan)).toMatchObject({ reason: "repetition", response: "abandon" });
    expect(plan.status).toBe("abandoned");
  });

  it("holds the coldest programs over when an event cannot pay them all off", () => {
    const capacity = 2;
    const world = plannedWorld("capacity", 3);
    world.config.booking.maxPayoffsPerEvent = capacity;
    const pleTick = world.programPlans[0]!.targetPayoffTick;
    world.stories.forEach((entry, index) => { entry.audienceInterest = 40 + index * 10; });
    for (const plan of world.programPlans) expect(plan.targetPayoffTick).toBe(pleTick);

    replanBeforeBooking(world, ctxAt(pleTick - 1, "capacity"));
    const held = world.programPlans.filter((plan) => plan.targetPayoffTick > pleTick);
    expect(held).toHaveLength(world.programPlans.length - capacity);
    for (const plan of held) {
      expect(lastRevision(plan)).toMatchObject({ reason: "payoff_capacity", response: "extend" });
      expect(changed(lastRevision(plan))).toBe(true);
    }
    // The hottest stories keep the date.
    const kept = world.programPlans.filter((plan) => plan.targetPayoffTick === pleTick)
      .map((plan) => world.stories.find((entry) => entry.id === plan.storyId)!.audienceInterest);
    expect(Math.min(...kept)).toBeGreaterThan(Math.max(...held.map((plan) =>
      world.stories.find((entry) => entry.id === plan.storyId)!.audienceInterest)));
  });
});

describe("event-driven replanning triggers", () => {
  it("answers each execution deviation cause with the response its cause implies", () => {
    const cases: { cause: "injury" | "refusal" | "failed_interference"; response: ProgramRevisionResponse }[] = [
      // An injury holds the program over — but only where a later event exists
      // to hold it to, which is why this one is judged from the go-home week.
      { cause: "injury", response: "extend" },
      { cause: "refusal", response: "pivot" },
      { cause: "failed_interference", response: "accelerate" },
    ];
    for (const { cause, response } of cases) {
      const world = plannedWorld(`deviation-${cause}`);
      const plan = world.programPlans[0]!;
      resolveBeat(world, beatsOf(world, plan)[0]!);
      const favoured = plan.participants[1]!.wrestlerId;
      const at = cause === "injury" ? plan.targetPayoffTick - 1 : 3;
      replanForExecutionDeviation(world, ctxAt(at, cause), plan.id, cause, favoured);
      expect(lastRevision(plan), cause).toMatchObject({ reason: "execution_deviation", response });
      expect(changed(lastRevision(plan)), cause).toBe(true);
    }
  });

  it("pivots a title program to the new champion, or drops the stakes when the belt leaves", () => {
    const world = plannedWorld("title");
    const plan = world.programPlans[0]!;
    const title = world.titles[0]!;
    plan.stakesTitleId = title.id;

    title.holderId = plan.participants[1]!.wrestlerId;
    replanForTitleChange(world, ctxAt(4, "title"), title.id);
    expect(lastRevision(plan)).toMatchObject({ reason: "title_change", response: "pivot" });
    expect(plan.protectedWrestlerIds).toEqual([title.holderId]);
    expect(plan.stakesTitleId).toBe(title.id);

    title.holderId = "wrestler-3";
    replanForTitleChange(world, ctxAt(5, "title"), title.id);
    expect(plan.stakesTitleId).toBeUndefined();
    expect(plan.creativeObjective).toBe("settle_grudge");
    expect(lastRevision(plan).previousIntent?.stakesTitleId).toBe(title.id);
  });

  it("turns an accepted pitch about a wrestler in a program into a revision", () => {
    const world = plannedWorld("pitch");
    const plan = world.programPlans[0]!;
    const pitcher = plan.participants[0]!.wrestlerId;
    const priority = plan.priority;

    replanForPlayerPitch(world, ctxAt(2, "pitch"), pitcher, plan.participants[1]!.wrestlerId);
    expect(lastRevision(plan)).toMatchObject({ reason: "player_pitch", response: "pivot" });
    expect(plan.priority).toBe(Math.min(5, priority + 1));

    // A wrestler cannot re-pitch their way to the top of the card every week.
    replanForPlayerPitch(world, ctxAt(5, "pitch"), pitcher, plan.participants[1]!.wrestlerId);
    expect(plan.revisions.filter((revision) => revision.reason === "player_pitch")).toHaveLength(1);
  });

  it("carries an accepted GM pitch through the interaction slot into the plan", () => {
    const world = plannedWorld("pitch-live");
    const plan = world.programPlans[0]!;
    const [pitcher, subject] = plan.participants.map((participant) => participant.wrestlerId) as [string, string];
    // A popular, professional wrestler asking is very likely to be told yes.
    const popularity = world.popularity.find((entry) => entry.wrestlerId === pitcher)!;
    popularity.generalPopularity = 100;
    world.wrestlers.find((wrestler) => wrestler.id === pitcher)!.skills.professionalism = 100;

    const ctx = ctxAt(2, "pitch-live");
    resolveInteractions(world, new Map([[pitcher, {
      wrestlerId: pitcher, matchIntents: {}, segmentIntents: {}, proposalResponses: [], reactiveResponses: [],
      interaction: { id: "interaction-pitch", wrestlerId: pitcher, target: { kind: "gm" as const }, intent: "pitch_feud" as const, subjectWrestlerId: subject },
    }]]), ctx);

    expect(ctx.events.some((event) => event.type === "interaction_resolved" && event.data["outcome"] === "accepted")).toBe(true);
    expect(ctx.events.some((event) => event.type === "program_plan_revised" && event.data["reason"] === "player_pitch")).toBe(true);
  });

  it("lets a refused booking pivot the program the wrestler is in", () => {
    const world = plannedWorld("response");
    const plan = world.programPlans[0]!;
    const refuser = plan.participants[1]!.wrestlerId;
    world.pendingReactiveDecisions = [{
      id: "reactive-1", type: "booking_request", targetWrestlerId: refuser,
      offeredResponses: ["accept", "refuse"], deadlineTick: 4, status: "pending",
    }];

    resolveReactiveResponses(world, new Map([[refuser, {
      wrestlerId: refuser, matchIntents: {}, segmentIntents: {}, proposalResponses: [],
      reactiveResponses: [{ reactiveDecisionId: "reactive-1", response: "refuse" as const }],
    }]]), ctxAt(2, "response"));

    expect(lastRevision(plan)).toMatchObject({ reason: "player_response", response: "pivot" });
    expect(plan.protectedWrestlerIds).toEqual([refuser]);
  });

  it("reaches every revision reason and every response token", () => {
    const world = plannedWorld("coverage", 3);
    const [crowd, titled, ending] = world.programPlans as [ProgramPlan, ProgramPlan, ProgramPlan];
    for (const plan of world.programPlans) resolveBeat(world, beatsOf(world, plan)[0]!);

    // payoff_capacity → extend: every program is aimed at the same event.
    world.config.booking.maxPayoffsPerEvent = 1;
    replanBeforeBooking(world, ctxAt(crowd.targetPayoffTick - 1, "coverage"));

    // crowd_response → pivot, on heat that keeps landing the other way.
    for (const beat of directedBeats(world, crowd).slice(0, world.config.booking.heatContradictionLimit)) {
      contradictingSegment(world, beat, crowd.participants[1]!.wrestlerId);
    }
    replanBeforeBooking(world, ctxAt(6, "coverage"));

    // repetition → accelerate, on a program that keeps running the same beat.
    const template = beatsOf(world, titled).find((beat) => beat.type === "promo_interview")!;
    for (let index = 0; index < world.config.booking.repeatedBeatTypeLimit; index++) {
      const clone: PlannedBeat = { ...structuredClone(template), id: `${template.id}-again-${index}`, status: "provisional", resultIds: [] };
      world.plannedBeats.push(clone);
      titled.plannedBeatIds.push(clone.id);
      resolveBeat(world, clone);
    }
    replanBeforeBooking(world, ctxAt(6, "coverage"));

    replanForExecutionDeviation(world, ctxAt(7, "coverage"), crowd.id, "failed_interference", crowd.participants[0]!.wrestlerId);
    replanForPlayerPitch(world, ctxAt(7, "coverage"), titled.participants[0]!.wrestlerId, "wrestler-99");
    replanForPlayerResponse(world, ctxAt(7, "coverage"), ending.participants[0]!.wrestlerId, "booking_request", "refuse");

    titled.stakesTitleId = world.titles[0]!.id;
    world.titles[0]!.holderId = titled.participants[1]!.wrestlerId;
    replanForTitleChange(world, ctxAt(8, "coverage"), world.titles[0]!.id);

    // participant_unavailable → substitute_beat, from the selection pass itself.
    for (const id of ending.participants.map((participant) => participant.wrestlerId)) {
      world.wrestlers.find((wrestler) => wrestler.id === id)!.condition = 5;
    }
    const due = beatsOf(world, ending).find((beat) => beat.status === "provisional" && beat.type !== "ple_payoff")!;
    selectPlannedBeatsForShow(world, ctxAt(due.earliestTick, "coverage"), due.earliestTick, 4);

    // The last three reasons have no fixture state that reaches them: the
    // lifecycle sweep owns `payoff_missed` (driven end to end in
    // `program-lifecycle.test.ts`), and `director_catalyst`/`manual` are the
    // planner's and the tuner's own hooks into the same primitives.
    coolDownProgramPlan(world, ctxAt(9, "coverage"), crowd, "payoff_missed", "the event moved out of reach.");
    pivotProgramPlan(world, ctxAt(9, "coverage"), titled, "manual", "a tuner said so", titled.participants[0]!.wrestlerId);
    abandonProgramPlan(world, ctxAt(9, "coverage"), ending, "director_catalyst", "the planner moved on.");

    const revisions = world.programPlans.flatMap((plan) => plan.revisions.map((revision) => ({ plan, revision })));
    const reasons = new Set<ProgramRevisionReason>(revisions.map(({ revision }) => revision.reason));
    const responses = new Set<ProgramRevisionResponse>(
      revisions.flatMap(({ revision }) => revision.response === undefined ? [] : [revision.response]),
    );
    expect([...programRevisionReasonSchema.options].filter((reason) => !reasons.has(reason))).toEqual([]);
    expect([...programRevisionResponseSchema.options].filter((response) => !responses.has(response))).toEqual([]);
    for (const { plan, revision } of revisions) {
      if (revision.reason === "initial_plan") continue;
      expect(changed(revision), `${plan.id} ${revision.reason}`).toBe(true);
    }
  });
});

describe("replanning over a live tick loop", () => {
  function liveWorld(weeks: number, seed: string): WorldState {
    let world = worldFromScenario(loadDefaultScenario(), seed);
    const ticks = weeks * (world.config.decisionTicksPerWeek + 1);
    for (let tick = 0; tick < ticks; tick++) world = runTick(world, [], world.seed).world;
    return world;
  }

  it("fires replanning triggers and never records a revision that changed nothing", () => {
    const world = liveWorld(8, "replan-live");
    const revisions = world.programPlans.flatMap((plan) => plan.revisions.map((revision) => ({ plan: plan.id, revision })));
    const responded = revisions.filter(({ revision }) => revision.reason !== "initial_plan");
    expect(responded.length).toBeGreaterThan(0);

    for (const { plan, revision } of responded) {
      expect(revision.previousIntent, `${plan} ${revision.reason}`).toBeDefined();
      expect(changed(revision), `${plan} ${revision.reason} left the intent untouched`).toBe(true);
      expect(revision.response, `${plan} ${revision.reason} recorded no response`).toBeDefined();
    }
  });

  it("reproduces identical revisions on a same-seed replay", () => {
    const trace = (world: WorldState): string => JSON.stringify(world.programPlans.map((plan) => ({
      id: plan.id, priority: plan.priority, target: plan.targetPayoffTick, status: plan.status,
      revisions: plan.revisions.map((revision) => [revision.tick, revision.reason, revision.response, revision.newIntent]),
    })));
    expect(trace(liveWorld(6, "replay"))).toEqual(trace(liveWorld(6, "replay")));
  });
});
