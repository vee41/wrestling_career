import type { MatchResult, SegmentResult, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { replanForExecutionDeviation } from "./program-plans.js";

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
    if (beat.type === "ple_payoff") plan.status = "resolved";
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
