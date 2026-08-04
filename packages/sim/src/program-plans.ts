import type {
  ProgramCreativeObjective,
  ProgramIntentSnapshot,
  ProgramParticipant,
  ProgramPlan,
  ProgramPlanCandidate,
  ProgramRevisionReason,
  Story,
  WorldState,
} from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isShowTick, showKindForTick } from "./booking.js";

const MAX_ACTIVE_PROGRAMS = 5;
const MINIMUM_AVAILABLE_CONDITION = 40;

function isActive(plan: ProgramPlan): boolean {
  return plan.status === "active" || plan.status === "payoff_ready";
}

function titleForStory(world: WorldState, story: Story): string | undefined {
  return world.titles.find((title) =>
    title.holderId !== undefined && story.participantWrestlerIds.includes(title.holderId),
  )?.id;
}

function objectiveFor(world: WorldState, story: Story, titleId: string | undefined): ProgramCreativeObjective {
  if (story.tension === "title_pursuit") {
    return world.gmObjective === "rebuild_championship" ? "retain_championship" : "establish_challenger";
  }
  if (story.tension === "grudge" || story.tension === "betrayal") return "settle_grudge";
  if (titleId !== undefined) return "retain_championship";
  if (world.gmObjective === "capitalise_on_rising_star" || world.gmObjective === "new_main_eventer") return "elevate_act";
  return "elevate_act";
}

function fallbackObjective(primary: ProgramCreativeObjective, titleId: string | undefined): ProgramCreativeObjective {
  if (primary !== "settle_grudge") return "settle_grudge";
  return titleId === undefined ? "elevate_act" : "establish_challenger";
}

function nextPleTick(world: WorldState, currentTick: number): number {
  let candidate = currentTick;
  // A program is always aimed at the next PLE, which is the bounded
  // four-week horizon in the default scenario. This also keeps the target a
  // real show tick for future commitment in Phase 3.10.
  while (!isShowTick(candidate, world.config) || showKindForTick(candidate, world.config) !== "ple") candidate++;
  return candidate;
}

function participantsFor(world: WorldState, story: Story, titleId: string | undefined): ProgramParticipant[] {
  const titleHolder = titleId === undefined ? undefined : world.titles.find((title) => title.id === titleId)?.holderId;
  return story.participantWrestlerIds.map((wrestlerId, index) => {
    const wrestler = world.wrestlers.find((candidate) => candidate.id === wrestlerId)!;
    if (titleHolder === wrestlerId) return { wrestlerId, role: "antagonist" };
    if (wrestler.alignment === "face") return { wrestlerId, role: "protagonist" };
    if (wrestler.alignment === "heel") return { wrestlerId, role: "antagonist" };
    return { wrestlerId, role: index === 0 ? "protagonist" : "supporting" };
  });
}

function protectedParticipants(world: WorldState, participantIds: readonly string[], titleId: string | undefined): string[] {
  const titleHolder = titleId === undefined ? undefined : world.titles.find((title) => title.id === titleId)?.holderId;
  const challenger = participantIds
    .filter((id) => id !== titleHolder)
    .slice()
    .sort((a, b) => findPopularity(world, a).generalPopularity - findPopularity(world, b).generalPopularity)[0];
  return challenger === undefined ? [] : [challenger];
}

function scoreComponents(world: WorldState, story: Story, objective: ProgramCreativeObjective, primary: boolean): Record<string, number> {
  const objectiveFit = objective === objectiveFor(world, story, titleForStory(world, story)) ? 30 : 5;
  const participantPopularity = story.participantWrestlerIds
    .reduce((total, id) => total + findPopularity(world, id).generalPopularity, 0) / story.participantWrestlerIds.length;
  return {
    audienceInterest: story.audienceInterest,
    momentum: story.momentum * 2,
    coherence: story.coherence * 0.2,
    participantPopularity: participantPopularity * 0.2,
    objectiveFit,
    primaryIntent: primary ? 5 : 0,
  };
}

function total(components: Record<string, number>): number {
  return Object.values(components).reduce((sum, value) => sum + value, 0);
}

function candidate(
  world: WorldState,
  ctx: TickContext,
  story: Story,
  creativeObjective: ProgramCreativeObjective,
  primary: boolean,
): ProgramPlanCandidate {
  const components = scoreComponents(world, story, creativeObjective, primary);
  return {
    id: ctx.ids.next("program-candidate"),
    tick: ctx.tick,
    storyId: story.id,
    participantWrestlerIds: [...story.participantWrestlerIds],
    creativeObjective,
    scoreComponents: components,
    totalScore: total(components),
    disposition: "rejected",
    hardInvalidReasons: [],
  };
}

function unavailableReasons(world: WorldState, participantIds: readonly string[]): string[] {
  return participantIds.flatMap((id) => {
    const wrestler = world.wrestlers.find((candidate) => candidate.id === id);
    return wrestler === undefined || wrestler.condition < MINIMUM_AVAILABLE_CONDITION ? [`participant_unavailable:${id}`] : [];
  });
}

function makePlan(world: WorldState, ctx: TickContext, story: Story, selected: ProgramPlanCandidate): ProgramPlan {
  const stakesTitleId = titleForStory(world, story);
  const targetPayoffTick = nextPleTick(world, ctx.tick);
  const participants = participantsFor(world, story, stakesTitleId);
  const protectedWrestlerIds = protectedParticipants(world, story.participantWrestlerIds, stakesTitleId);
  const intendedPayoff = stakesTitleId === undefined
    ? `Settle ${story.stakes}.`
    : `Resolve the championship stakes at the target PLE.`;
  const intent = {
    creativeObjective: selected.creativeObjective,
    ...(stakesTitleId === undefined ? {} : { stakesTitleId }),
    targetPayoffTick,
    intendedPayoff,
    protectedWrestlerIds,
  };
  return {
    id: ctx.ids.next("program"),
    storyId: story.id,
    ...(stakesTitleId === undefined ? {} : { stakesTitleId }),
    participants,
    premise: story.tensionDescription,
    creativeObjective: selected.creativeObjective,
    priority: Math.max(1, Math.min(5, Math.ceil(story.audienceInterest / 20))),
    startTick: ctx.tick,
    targetPayoffTick,
    intendedPayoff,
    protectedWrestlerIds,
    escalation: 0,
    status: "active",
    plannedBeatIds: [],
    completedBeatIds: [],
    directMatchCooldownTicks: world.config.decisionTicksPerWeek + 1,
    directMatchRepetitionBudget: 1,
    revisions: [{
      id: ctx.ids.next("program-revision"),
      tick: ctx.tick,
      reason: "initial_plan",
      newIntent: intent,
    }],
  };
}

/**
 * Deterministically creates a bounded private portfolio from active public
 * stories. It deliberately does not compose cards: Phase 3.10 owns beats and
 * Phase 3.12 owns weekly card selection.
 */
export function planPrograms(world: WorldState, ctx: TickContext): void {
  const alreadyPlanned = new Set(world.programPlans.filter(isActive).map((plan) => plan.storyId));
  const stories = world.stories
    .filter((story) => (story.phase === "building" || story.phase === "peaking") && !alreadyPlanned.has(story.id))
    .sort((a, b) => b.audienceInterest - a.audienceInterest || a.id.localeCompare(b.id));
  if (stories.length === 0) return;

  const candidatesByStory = new Map<string, ProgramPlanCandidate[]>();
  for (const story of stories) {
    const titleId = titleForStory(world, story);
    const primary = objectiveFor(world, story, titleId);
    const alternatives = [candidate(world, ctx, story, primary, true), candidate(world, ctx, story, fallbackObjective(primary, titleId), false)];
    const reasons = unavailableReasons(world, story.participantWrestlerIds);
    if (reasons.length > 0) {
      alternatives.forEach((entry) => {
        entry.disposition = "hard_invalid";
        entry.hardInvalidReasons = reasons;
      });
    }
    candidatesByStory.set(story.id, alternatives);
  }

  const selectedIds = new Set<string>();
  const activeParticipants = new Set(world.programPlans.filter(isActive).flatMap((plan) => plan.participants.map((participant) => participant.wrestlerId)));
  const primaryCandidates = stories
    .map((story) => candidatesByStory.get(story.id)![0]!)
    .filter((entry) => entry.disposition !== "hard_invalid")
    .sort((a, b) => b.totalScore - a.totalScore || a.storyId.localeCompare(b.storyId));

  for (const selected of primaryCandidates) {
    const alternatives = candidatesByStory.get(selected.storyId)!;
    const conflicts = selected.participantWrestlerIds.filter((id) => activeParticipants.has(id));
    if (conflicts.length > 0) {
      alternatives.forEach((entry) => {
        entry.disposition = "hard_invalid";
        entry.hardInvalidReasons = conflicts.map((id) => `participant_conflict:${id}`);
      });
      continue;
    }
    if (world.programPlans.filter(isActive).length + selectedIds.size >= MAX_ACTIVE_PROGRAMS) continue;
    const story = world.stories.find((entry) => entry.id === selected.storyId)!;
    const plan = makePlan(world, ctx, story, selected);
    selected.disposition = "selected";
    selected.selectedPlanId = plan.id;
    world.programPlans.push(plan);
    selected.participantWrestlerIds.forEach((id) => activeParticipants.add(id));
    selectedIds.add(selected.id);
    addEvent(world, ctx, {
      type: "program_plan_created",
      summary: `The GM set a four-week program plan for ${story.stakes}.`,
      wrestlerIds: selected.participantWrestlerIds,
      storyId: story.id,
      data: { programPlanId: plan.id, creativeObjective: plan.creativeObjective, targetPayoffTick: plan.targetPayoffTick },
    });
  }

  const candidates = [...candidatesByStory.values()].flat();
  world.programPlanCandidates.push(...candidates);
  for (const entry of candidates) {
    addEvent(world, ctx, {
      type: "program_candidate_evaluated",
      summary: `The GM ${entry.disposition.replace(/_/g, " ")} a program candidate for story ${entry.storyId}.`,
      wrestlerIds: entry.participantWrestlerIds,
      storyId: entry.storyId,
      data: {
        candidateId: entry.id,
        disposition: entry.disposition,
        scoreComponents: entry.scoreComponents,
        totalScore: entry.totalScore,
        hardInvalidReasons: entry.hardInvalidReasons,
      },
    });
  }
}

/**
 * The only mutation path for existing program intent. Future replanning
 * stages call this rather than silently replacing plan fields, preserving an
 * audit trail for the planner and debugging tools.
 */
export function reviseProgramPlan(
  world: WorldState,
  ctx: TickContext,
  programPlanId: string,
  reason: ProgramRevisionReason,
  newIntent: ProgramIntentSnapshot,
): ProgramPlan {
  const plan = world.programPlans.find((candidate) => candidate.id === programPlanId);
  if (plan === undefined) throw new Error(`Unknown program plan "${programPlanId}"`);
  const previousIntent: ProgramIntentSnapshot = {
    creativeObjective: plan.creativeObjective,
    ...(plan.stakesTitleId === undefined ? {} : { stakesTitleId: plan.stakesTitleId }),
    targetPayoffTick: plan.targetPayoffTick,
    intendedPayoff: plan.intendedPayoff,
    protectedWrestlerIds: [...plan.protectedWrestlerIds],
  };
  plan.creativeObjective = newIntent.creativeObjective;
  if (newIntent.stakesTitleId === undefined) delete plan.stakesTitleId;
  else plan.stakesTitleId = newIntent.stakesTitleId;
  plan.targetPayoffTick = newIntent.targetPayoffTick;
  plan.intendedPayoff = newIntent.intendedPayoff;
  plan.protectedWrestlerIds = [...newIntent.protectedWrestlerIds];
  plan.revisions.push({
    id: ctx.ids.next("program-revision"),
    tick: ctx.tick,
    reason,
    previousIntent,
    newIntent: structuredClone(newIntent),
  });
  addEvent(world, ctx, {
    type: "program_plan_revised",
    summary: `The GM revised the program plan for ${plan.storyId}.`,
    wrestlerIds: plan.participants.map((participant) => participant.wrestlerId),
    storyId: plan.storyId,
    data: { programPlanId: plan.id, reason, previousIntent, newIntent },
  });
  return plan;
}
