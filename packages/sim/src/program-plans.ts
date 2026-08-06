import type {
  ProgramCreativeObjective,
  ProgramIntentSnapshot,
  ProgramParticipant,
  ProgramPlan,
  ProgramPlanCandidate,
  ProgramRevisionReason,
  ProgramRevisionResponse,
  PlannedBeat,
  PlannedBeatType,
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

/**
 * The television ticks a program can actually build on. A card is composed one
 * tick ahead of airing, so the show on `afterTick` itself is already booked and
 * is not a build opportunity for a plan created now.
 */
function buildShowTicks(world: WorldState, afterTick: number, payoffTick: number): number[] {
  const ticks: number[] = [];
  for (let tick = afterTick + 1; tick < payoffTick; tick++) {
    if (isShowTick(tick, world.config) && showKindForTick(tick, world.config) === "tv") ticks.push(tick);
  }
  return ticks;
}

/**
 * A plan seeded a show or two before an event has no runway to build one, and
 * its beats would be born into windows that have already closed. Aim past that
 * PLE at the first one the program can actually reach.
 */
function targetPayoffTick(world: WorldState, startTick: number): number {
  let candidate = nextPleTick(world, startTick);
  const cycle = world.config.pleIntervalWeeks * (world.config.decisionTicksPerWeek + 1);
  while (buildShowTicks(world, startTick, candidate).length < world.config.booking.minimumProgramBuildShows) {
    candidate = nextPleTick(world, candidate + 1);
    if (candidate > startTick + cycle * 2) break;
  }
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
  const payoffTick = targetPayoffTick(world, ctx.tick);
  const participants = participantsFor(world, story, stakesTitleId);
  const protectedWrestlerIds = protectedParticipants(world, story.participantWrestlerIds, stakesTitleId);
  const intendedPayoff = stakesTitleId === undefined
    ? `Settle ${story.stakes}.`
    : `Resolve the championship stakes at the target PLE.`;
  const intent = {
    creativeObjective: selected.creativeObjective,
    ...(stakesTitleId === undefined ? {} : { stakesTitleId }),
    targetPayoffTick: payoffTick,
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
    targetPayoffTick: payoffTick,
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

function beat(world: WorldState, ctx: TickContext, plan: ProgramPlan, type: PlannedBeatType, earliestTick: number, latestTick: number, effect: string, escalationLevel: number, requiredResolvedBeatIds: string[] = []): PlannedBeat {
  const participants = plan.participants.map((participant) => participant.wrestlerId);
  const payoff = type === "ple_payoff";
  const direct = type === "direct_rivalry_match" || payoff;
  const focal = plan.participants.find((participant) => participant.role === "protagonist")?.wrestlerId ?? participants[0]!;
  const antagonist = plan.participants.find((participant) => participant.role === "antagonist")?.wrestlerId;
  const intendedDominantWrestlerId = (type === "attack_save_interference" || type === "go_home_angle") && antagonist !== undefined ? antagonist : focal;
  const intendedHeatDirection = type === "confrontation" ? "mixed" as const
    : (type === "attack_save_interference" || type === "go_home_angle") ? "negative" as const
      : "positive" as const;
  return {
    id: ctx.ids.next("planned-beat"), programId: plan.id, type,
    requiredParticipantWrestlerIds: participants,
    optionalParticipantWrestlerIds: [],
    earliestTick, latestTick,
    preconditions: { requiredResolvedBeatIds, requirePle: payoff },
    intendedStoryEffect: effect, escalationLevel,
    ...(direct ? {} : {
      plannedSegmentOutcome: {
        intendedDominantWrestlerId,
        intendedHeatDirection,
        intendedStoryEffect: effect,
        protectedWrestlerIds: [...plan.protectedWrestlerIds],
        adherenceStrength: type === "go_home_angle" ? "strict" as const : "standard" as const,
      },
    }),
    spendsDirectMatchup: direct,
    compatibleSlotKind: direct || type === "showcase_contender_match" ? "match" : "segment",
    status: "provisional", resultIds: [],
  };
}

/** The escalating build, in order. The payoff is appended to whatever fits. */
const BUILD_BEATS: readonly { type: PlannedBeatType; effect: string; escalationLevel: number }[] = [
  { type: "promo_interview", effect: "Establish the conflict and stakes.", escalationLevel: 0 },
  { type: "confrontation", effect: "Complicate the conflict without spending the rivalry match.", escalationLevel: 1 },
  { type: "go_home_angle", effect: "Escalate the conflict and make the payoff unavoidable.", escalationLevel: 2 },
];

/**
 * A premise → complication → escalation → payoff cadence laid over the shows
 * that exist. Each build beat opens on its own television show and stays open
 * until the last one before the payoff: the prerequisite chain enforces the
 * order, so the slack only decides how late a beat may still catch up. The
 * previous fixed `payoff − 6 / − 3 / − 1` arithmetic collapsed every window to
 * a single already-booked tick whenever a plan started close to its PLE, which
 * is what stranded late programs with every beat skipped.
 */
export function createBeatSkeleton(world: WorldState, ctx: TickContext, plan: ProgramPlan): PlannedBeat[] {
  const buildTicks = buildShowTicks(world, plan.startTick, plan.targetPayoffTick);
  const lastBuildTick = buildTicks.at(-1) ?? plan.startTick;
  const build: PlannedBeat[] = [];
  for (const [index, template] of BUILD_BEATS.slice(0, buildTicks.length).entries()) {
    const previous = build.at(-1);
    build.push(beat(
      world, ctx, plan, template.type, buildTicks[index]!, lastBuildTick,
      template.effect, template.escalationLevel, previous === undefined ? [] : [previous.id],
    ));
  }
  const last = build.at(-1);
  const payoff = beat(
    world, ctx, plan, "ple_payoff", plan.targetPayoffTick, plan.targetPayoffTick,
    plan.intendedPayoff, 3, last === undefined ? [] : [last.id],
  );
  return [...build, payoff];
}

function snapshot(plan: ProgramPlan): ProgramIntentSnapshot {
  return {
    creativeObjective: plan.creativeObjective,
    ...(plan.stakesTitleId === undefined ? {} : { stakesTitleId: plan.stakesTitleId }),
    targetPayoffTick: plan.targetPayoffTick,
    intendedPayoff: plan.intendedPayoff,
    protectedWrestlerIds: [...plan.protectedWrestlerIds],
  };
}

function invalidateAndSubstitute(world: WorldState, ctx: TickContext, plan: ProgramPlan, invalid: PlannedBeat, targetTick: number): void {
  invalid.status = "invalidated";
  const available = invalid.requiredParticipantWrestlerIds.filter((id) => (world.wrestlers.find((wrestler) => wrestler.id === id)?.condition ?? 0) >= MINIMUM_AVAILABLE_CONDITION);
  const substitute = available.length > 0 && targetTick <= invalid.latestTick
    ? scopeToParticipants({
      ...beat(world, ctx, plan, "promo_interview", targetTick, invalid.latestTick, `Keep the program visible while replacing ${invalid.type.replace(/_/g, " ")}.`, invalid.escalationLevel),
      requiredParticipantWrestlerIds: available,
      preconditions: { requiredResolvedBeatIds: [...invalid.preconditions.requiredResolvedBeatIds], requirePle: false },
    }, available)
    : undefined;
  if (substitute !== undefined) {
    world.plannedBeats.push(substitute);
    plan.plannedBeatIds.push(substitute.id);
  }
  // The rest of the chain required the beat that just died. Point it at the
  // stand-in instead, or past it when there is none, so the program keeps
  // escalating rather than waiting forever on a beat that will never resolve.
  const unblocked = retireFromChain(world, plan, invalid, substitute === undefined ? [] : [substitute.id]);
  addEvent(world, ctx, {
    type: "planned_beat_invalidated", summary: `A planned ${invalid.type.replace(/_/g, " ")} could not proceed because a participant was unavailable.`,
    wrestlerIds: invalid.requiredParticipantWrestlerIds, storyId: plan.storyId,
    data: { programPlanId: plan.id, plannedBeatId: invalid.id, response: "substitute_beat", ...(substitute === undefined ? {} : { substituteBeatId: substitute.id }), unblockedBeatIds: unblocked },
  });
  reviseProgramPlan(world, ctx, plan.id, "participant_unavailable", snapshot(plan), "substitute_beat");
}

/**
 * A beat booked for a subset of the program cannot keep the whole program's
 * planned outcome: naming an absent wrestler as the intended dominant makes the
 * segment resolve as a refusal deviation against someone who was never in it.
 */
function scopeToParticipants(candidate: PlannedBeat, participants: readonly string[]): PlannedBeat {
  const planned = candidate.plannedSegmentOutcome;
  if (planned === undefined) return candidate;
  return {
    ...candidate,
    plannedSegmentOutcome: {
      ...planned,
      intendedDominantWrestlerId: participants.includes(planned.intendedDominantWrestlerId) ? planned.intendedDominantWrestlerId : participants[0]!,
      protectedWrestlerIds: planned.protectedWrestlerIds.filter((id) => participants.includes(id)),
    },
  };
}

/**
 * Re-points every beat that required `retired` at its replacements, or at
 * whatever `retired` itself was waiting on when there is no replacement. A
 * retired beat that stays in its successors' preconditions is a chain that can
 * never unblock — the program then silently thins to nothing.
 */
function retireFromChain(world: WorldState, plan: ProgramPlan, retired: PlannedBeat, replacementIds: readonly string[]): string[] {
  const inherited = replacementIds.length > 0 ? replacementIds : retired.preconditions.requiredResolvedBeatIds;
  const unblocked: string[] = [];
  for (const successor of world.plannedBeats) {
    if (successor.programId !== plan.id) continue;
    const required = successor.preconditions.requiredResolvedBeatIds;
    if (!required.includes(retired.id)) continue;
    successor.preconditions.requiredResolvedBeatIds = [...new Set([...required.filter((id) => id !== retired.id), ...inherited])];
    unblocked.push(successor.id);
  }
  return unblocked;
}

/**
 * A beat whose window closed is spliced out of the chain rather than left to
 * block it. Its successors inherit its prerequisites, so the program skips the
 * complication and keeps escalating instead of thinning to nothing behind a
 * requirement that can never be satisfied.
 */
function skipBeat(world: WorldState, ctx: TickContext, plan: ProgramPlan, skipped: PlannedBeat): void {
  skipped.status = "skipped";
  const healed = retireFromChain(world, plan, skipped, []);
  addEvent(world, ctx, {
    type: "planned_beat_skipped",
    summary: `A planned ${skipped.type.replace(/_/g, " ")} beat ran out of shows to air on.`,
    wrestlerIds: skipped.requiredParticipantWrestlerIds, storyId: plan.storyId,
    data: { programPlanId: plan.id, plannedBeatId: skipped.id, type: skipped.type, unblockedBeatIds: healed },
  });
}

/**
 * Selects only plan-owned beats. The legacy filler in gm.ts still supplies
 * the rest of the card until Phase 3.12, but cannot choose a planned beat's
 * execution primitive.
 */
export function selectPlannedBeatsForShow(world: WorldState, ctx: TickContext, targetTick: number, capacity: number): PlannedBeat[] {
  const isPle = showKindForTick(targetTick, world.config) === "ple";
  const selected: PlannedBeat[] = [];
  const activePlans = world.programPlans.filter(isActive).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const plan of activePlans) {
    if (selected.length >= capacity) break;
    const beats = world.plannedBeats.filter((candidate) => candidate.programId === plan.id && candidate.status === "provisional")
      .sort((a, b) => a.escalationLevel - b.escalationLevel || a.id.localeCompare(b.id));
    for (const candidate of beats) {
      if (targetTick > candidate.latestTick) { skipBeat(world, ctx, plan, candidate); continue; }
      if (targetTick < candidate.earliestTick || candidate.preconditions.requirePle !== isPle) continue;
      const prerequisites = candidate.preconditions.requiredResolvedBeatIds;
      if (!prerequisites.every((id) => world.plannedBeats.find((beat) => beat.id === id)?.status === "resolved")) continue;
      if (candidate.requiredParticipantWrestlerIds.some((id) => (world.wrestlers.find((wrestler) => wrestler.id === id)?.condition ?? 0) < MINIMUM_AVAILABLE_CONDITION)) {
        invalidateAndSubstitute(world, ctx, plan, candidate, targetTick);
        continue;
      }
      const lastDirect = world.plannedBeats
        .filter((beat) => beat.programId === plan.id && beat.spendsDirectMatchup && beat.status === "resolved")
        .map((beat) => world.shows.find((show) => show.id === beat.scheduledShowId)?.tick ?? -Infinity)
        .reduce((latest, tick) => Math.max(latest, tick), -Infinity);
      if (candidate.spendsDirectMatchup && targetTick - lastDirect < plan.directMatchCooldownTicks) continue;
      candidate.status = "scheduled";
      selected.push(candidate);
      break; // Phase 3.10: one beat per program per show.
    }
  }
  return selected;
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
    const skeleton = createBeatSkeleton(world, ctx, plan);
    world.plannedBeats.push(...skeleton);
    plan.plannedBeatIds.push(...skeleton.map((beat) => beat.id));
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
  response?: ProgramRevisionResponse,
): ProgramPlan {
  const plan = world.programPlans.find((candidate) => candidate.id === programPlanId);
  if (plan === undefined) throw new Error(`Unknown program plan "${programPlanId}"`);
  const previousIntent = snapshot(plan);
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
    ...(response === undefined ? {} : { response }),
  });
  addEvent(world, ctx, {
    type: "program_plan_revised",
    summary: `The GM revised the program plan for ${plan.storyId}.`,
    wrestlerIds: plan.participants.map((participant) => participant.wrestlerId),
    storyId: plan.storyId,
    data: { programPlanId: plan.id, reason, previousIntent, newIntent, ...(response === undefined ? {} : { response }) },
  });
  return plan;
}

/**
 * Retires a plan for good: the beats it will never run are invalidated and the
 * public story is left cooling, which releases its participants and gives the
 * story engine's cooling exit something to close.
 */
export function abandonProgramPlan(world: WorldState, ctx: TickContext, plan: ProgramPlan, reason: ProgramRevisionReason, why: string): void {
  reviseProgramPlan(world, ctx, plan.id, reason, { ...snapshot(plan), intendedPayoff: `Abandon the program: ${why}` }, "abandon");
  plan.status = "abandoned";
  for (const beat of world.plannedBeats) {
    if (beat.programId !== plan.id) continue;
    if (beat.status === "provisional" || beat.status === "scheduled") beat.status = "invalidated";
  }
  const story = world.stories.find((candidate) => candidate.id === plan.storyId);
  if (story !== undefined && story.phase !== "resolved") {
    story.phase = "cooling";
    story.coolingSinceTick = ctx.tick;
  }
}

/**
 * Every plan terminates. A payoff window that passes unresolved buys the
 * program one extension to the next PLE it can actually reach — beats and all —
 * and then the plan is abandoned rather than left `active` forever pointing at
 * a show that already happened.
 */
export function advanceProgramPlanLifecycle(world: WorldState, ctx: TickContext): void {
  for (const plan of world.programPlans) {
    if (!isActive(plan) || plan.targetPayoffTick > ctx.tick) continue;
    const extensions = plan.revisions.filter((revision) => revision.reason === "payoff_missed" && revision.response === "extend").length;
    if (extensions >= world.config.booking.maxPayoffExtensions) {
      abandonProgramPlan(world, ctx, plan, "payoff_missed", "the payoff window closed again with the build unfinished.");
      continue;
    }
    const extended = targetPayoffTick(world, ctx.tick);
    const buildTicks = buildShowTicks(world, ctx.tick, extended);
    const lastBuildTick = buildTicks.at(-1) ?? ctx.tick;
    for (const beat of world.plannedBeats) {
      if (beat.programId !== plan.id || beat.status !== "provisional") continue;
      const payoff = beat.type === "ple_payoff";
      beat.earliestTick = payoff ? extended : Math.min(Math.max(beat.earliestTick, buildTicks[0] ?? ctx.tick), lastBuildTick);
      beat.latestTick = payoff ? extended : lastBuildTick;
    }
    // The status is deliberately untouched: a plan that had already reached
    // `payoff_ready` is still payoff-ready, only later.
    reviseProgramPlan(world, ctx, plan.id, "payoff_missed", { ...snapshot(plan), targetPayoffTick: extended }, "extend");
  }
}

/** Execution facts are a replanning input, never a silent change to a program's premise. */
export function replanForExecutionDeviation(world: WorldState, ctx: TickContext, programPlanId: string): void {
  const plan = world.programPlans.find((candidate) => candidate.id === programPlanId);
  if (plan === undefined || !isActive(plan)) return;
  reviseProgramPlan(world, ctx, plan.id, "execution_deviation", snapshot(plan), "pivot");
}

/** A title holder is itself planned state; a surprise change makes linked plans auditablely reconsider it. */
export function replanForTitleChange(world: WorldState, ctx: TickContext, titleId: string): void {
  for (const plan of world.programPlans) {
    if (plan.stakesTitleId === titleId && isActive(plan)) reviseProgramPlan(world, ctx, plan.id, "title_change", snapshot(plan), "pivot");
  }
}
