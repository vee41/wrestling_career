import type { MatchResult, PlannedBeat, ProgramPlan, SegmentResult, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { replanForExecutionDeviation } from "./program-plans.js";
import { resolveStoryPayoff } from "./stories.js";

type PlannedResult = MatchResult | SegmentResult;

/** Records explicit execution; beat lifecycle never follows a story meter. */
export function recordResolvedBeat(world: WorldState, ctx: TickContext, result: PlannedResult): void {
  if (result.plannedBeatId === undefined) return;
  const beat = world.plannedBeats.find((candidate) => candidate.id === result.plannedBeatId);
  if (beat === undefined || beat.status !== "scheduled") return;
  beat.status = "resolved";
  beat.resultIds.push(result.id);
  const plan = world.programPlans.find((candidate) => candidate.id === beat.programId);
  if (plan && !plan.completedBeatIds.includes(beat.id)) {
    plan.completedBeatIds.push(beat.id);
    plan.escalation = Math.max(plan.escalation, beat.escalationLevel);
    if (beat.type === "ple_payoff") resolvePayoff(world, ctx, plan, result);
    else if (payoffUnblocked(world, plan)) plan.status = "payoff_ready";
  }
  addEvent(world, ctx, {
    type: "planned_beat_resolved",
    summary: `The ${beat.type.replace(/_/g, " ")} beat was completed.`,
    wrestlerIds: result.participantWrestlerIds,
    ...(result.storyId === undefined ? {} : { storyId: result.storyId }),
    matchId: result.id, showId: result.showId,
    data: { programPlanId: beat.programId, plannedBeatId: beat.id, resultId: result.id, type: beat.type },
  });
  if (result.adherence === "deviated") replanForExecutionDeviation(world, ctx, beat.programId);
}

/** Whether every beat between here and the payoff has had its say. */
function payoffUnblocked(world: WorldState, plan: ProgramPlan): boolean {
  const beats = world.plannedBeats.filter((candidate) => candidate.programId === plan.id);
  const payoff = beats.find((candidate) => candidate.type === "ple_payoff" && candidate.status === "provisional");
  if (payoff === undefined) return false;
  return payoff.preconditions.requiredResolvedBeatIds
    .every((id) => beats.find((candidate) => candidate.id === id)?.status === "resolved");
}

/**
 * The payoff beat is the single payoff authority: resolving it settles the beat,
 * the plan, *and* the public story. The legacy peaking-blowoff pass in
 * `advanceStories` now only reaches stories no plan is building, so a program's
 * climax produces exactly one set of resolved facts whichever path booked it.
 */
function resolvePayoff(world: WorldState, ctx: TickContext, plan: ProgramPlan, result: PlannedResult): void {
  plan.status = "resolved";
  const story = world.stories.find((candidate) => candidate.id === plan.storyId);
  // Only a match decides a program: a payoff beat is always a match slot
  // (`plannedBeatSchema` enforces it), so this is a narrowing, not a branch.
  if (story === undefined || story.phase === "resolved" || !("winnerWrestlerId" in result)) return;
  resolveStoryPayoff(world, ctx, story, result);
}

/** Beats that never reached the committed card must not stay claimed by it. */
export function releaseUncommittedBeats(world: WorldState, beats: readonly PlannedBeat[]): void {
  for (const beat of beats) {
    if (beat.status === "scheduled" && beat.scheduledShowId === undefined) beat.status = "provisional";
  }
}
