import type {
  ExecutionDeviationCause,
  ProgramCreativeObjective,
  ProgramIntentSnapshot,
  ProgramParticipant,
  ProgramPlan,
  ProgramPlanCandidate,
  ProgramRevisionReason,
  ProgramRevisionResponse,
  PlannedBeat,
  PlannedBeatType,
  ReactiveDecisionType,
  ReactiveResponseToken,
  Story,
  WorldState,
} from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isShowTick, showKindForTick } from "./booking.js";
import { isAvailableId } from "./injury.js";

const MAX_ACTIVE_PROGRAMS = 5;

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
  return participantIds.flatMap((id) => (isAvailableId(world, id) ? [] : [`participant_unavailable:${id}`]));
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

/**
 * A beat is booked to favour one side *relative to the payoff*, never by name:
 * a skeleton in which the eventual winner stands tall every week is a squash,
 * not a feud. The wrestler each token resolves to is read off the plan when the
 * beat is written, and again by `finishForPlannedBeat` when it is booked.
 */
type BeatDominance = "payoff_winner" | "payoff_loser";

type BeatHeat = NonNullable<PlannedBeat["plannedSegmentOutcome"]>["intendedHeatDirection"];

interface BeatSpec {
  type: PlannedBeatType;
  earliestTick: number;
  latestTick: number;
  effect: string;
  escalationLevel: number;
  requiredResolvedBeatIds?: string[];
  dominant?: BeatDominance;
  heat?: BeatHeat;
  /** Defaults to the whole program. A showcase deliberately books only one side of it. */
  required?: string[];
  /** Bodies from outside the program the composer may add if they are free. */
  optional?: string[];
}

/**
 * Who the program means to send home with the win. Every beat's dominance is
 * expressed against this, and `finishForPlannedBeat` decides the payoff itself
 * the same way — one answer to "whose program is this", read in both places.
 */
export function plannedPayoffWinnerId(world: WorldState, plan: ProgramPlan): string {
  const participantIds = plan.participants.map((participant) => participant.wrestlerId);
  const titleHolder = plan.stakesTitleId === undefined
    ? undefined
    : world.titles.find((title) => title.id === plan.stakesTitleId)?.holderId;
  const protagonist = plan.participants.find((participant) => participant.role === "protagonist")?.wrestlerId ?? participantIds[0]!;
  const wantsChange = plan.creativeObjective === "change_championship"
    || plan.creativeObjective === "establish_challenger"
    || plan.creativeObjective === "elevate_act";
  return titleHolder !== undefined && !wantsChange && participantIds.includes(titleHolder) ? titleHolder : protagonist;
}

/** The other side of the program — whoever the payoff is booked against. */
function payoffLoserId(world: WorldState, plan: ProgramPlan): string {
  const winner = plannedPayoffWinnerId(world, plan);
  return plan.participants.find((participant) => participant.wrestlerId !== winner)?.wrestlerId ?? winner;
}

function beat(world: WorldState, ctx: TickContext, plan: ProgramPlan, spec: BeatSpec): PlannedBeat {
  const required = spec.required ?? plan.participants.map((participant) => participant.wrestlerId);
  const payoff = spec.type === "ple_payoff";
  const direct = spec.type === "direct_rivalry_match" || payoff;
  const isMatch = direct || spec.type === "showcase_contender_match";
  const favoured = spec.dominant === "payoff_loser" ? payoffLoserId(world, plan) : plannedPayoffWinnerId(world, plan);
  const intendedDominantWrestlerId = required.includes(favoured) ? favoured : required[0]!;
  return {
    id: ctx.ids.next("planned-beat"), programId: plan.id, type: spec.type,
    requiredParticipantWrestlerIds: required,
    optionalParticipantWrestlerIds: (spec.optional ?? []).filter((id) => !required.includes(id)),
    earliestTick: spec.earliestTick, latestTick: spec.latestTick,
    preconditions: { requiredResolvedBeatIds: spec.requiredResolvedBeatIds ?? [], requirePle: payoff },
    intendedStoryEffect: spec.effect, escalationLevel: spec.escalationLevel,
    // A match's creative outcome is a planned *finish*, composed against the
    // actual participants when the card is built; only segments carry theirs
    // on the beat itself.
    ...(isMatch ? {} : {
      plannedSegmentOutcome: {
        intendedDominantWrestlerId,
        intendedHeatDirection: spec.heat ?? "positive",
        intendedStoryEffect: spec.effect,
        protectedWrestlerIds: plan.protectedWrestlerIds.filter((id) => required.includes(id)),
        adherenceStrength: spec.type === "go_home_angle" ? "strict" as const : "standard" as const,
      },
    }),
    spendsDirectMatchup: direct,
    compatibleSlotKind: isMatch ? "match" : "segment",
    status: "provisional", resultIds: [],
  };
}

interface BeatTemplate {
  type: PlannedBeatType;
  effect: string;
  dominant: BeatDominance;
  heat?: BeatHeat;
}

/**
 * What a program is *for* decides what it is built out of. Every archetype
 * still runs premise → complication → escalation → payoff, but a challenger is
 * made credible by beating somebody, a grudge escalates through an ambush and
 * an unsettled television fall, and a championship story is argued in promos.
 * Each also trades momentum: the side losing the blowoff stands tall on the way
 * in, so the payoff is a comeback rather than a formality.
 */
const CHALLENGER_BUILD: readonly BeatTemplate[] = [
  { type: "promo_interview", effect: "State the claim on the champion in public.", dominant: "payoff_winner", heat: "positive" },
  { type: "showcase_contender_match", effect: "Beat a credible opponent so the challenge means something.", dominant: "payoff_winner" },
  { type: "go_home_angle", effect: "Let the champion stand tall so the payoff is in doubt.", dominant: "payoff_loser", heat: "negative" },
];

const GRUDGE_BUILD: readonly BeatTemplate[] = [
  { type: "promo_interview", effect: "Put the reason for the fight on television.", dominant: "payoff_winner", heat: "positive" },
  { type: "attack_save_interference", effect: "Ambush the rival and drag somebody else into it.", dominant: "payoff_loser", heat: "negative" },
  { type: "direct_rivalry_match", effect: "Trade the first fall on television and leave the score unsettled.", dominant: "payoff_loser" },
];

const ELEVATION_BUILD: readonly BeatTemplate[] = [
  { type: "promo_interview", effect: "Make the case that they belong in the conversation.", dominant: "payoff_winner", heat: "positive" },
  { type: "confrontation", effect: "Let the established name talk down to them in person.", dominant: "payoff_loser", heat: "mixed" },
  { type: "showcase_contender_match", effect: "Answer it by beating somebody who matters.", dominant: "payoff_winner" },
];

const ARGUMENT_BUILD: readonly BeatTemplate[] = [
  { type: "promo_interview", effect: "Establish the conflict and stakes.", dominant: "payoff_winner", heat: "positive" },
  { type: "confrontation", effect: "Complicate the conflict without spending the rivalry match.", dominant: "payoff_loser", heat: "mixed" },
  { type: "go_home_angle", effect: "Escalate the conflict and make the payoff unavoidable.", dominant: "payoff_loser", heat: "negative" },
];

const ARCHETYPES: Record<ProgramCreativeObjective, readonly BeatTemplate[]> = {
  establish_challenger: CHALLENGER_BUILD,
  settle_grudge: GRUDGE_BUILD,
  elevate_act: ELEVATION_BUILD,
  retain_championship: ARGUMENT_BUILD,
  change_championship: ARGUMENT_BUILD,
  // booking_ai §16 designs these for Phase 3.14; they stay dormant rather than
  // unbuildable, so a scenario that reaches one still gets a coherent build.
  turn_character: ARGUMENT_BUILD,
  redeem_act: ARGUMENT_BUILD,
};

/**
 * Bodies from outside the program. A showcase needs an opponent the audience
 * will believe the challenger had to beat, and an ambush needs somebody to run
 * in — neither may be one of the core pair, a wrestler another program is
 * already spending, a champion, or one of the rare acts the rotation protects.
 * Several are named because the beat is written weeks before it is booked, and
 * who is free by then has changed.
 */
function outsideCandidates(world: WorldState, plan: ProgramPlan, relativeTo: string): string[] {
  const committed = new Set(world.programPlans.filter(isActive).flatMap((candidate) => candidate.participants.map((participant) => participant.wrestlerId)));
  for (const participant of plan.participants) committed.add(participant.wrestlerId);
  const reference = findPopularity(world, relativeTo).generalPopularity;
  return world.wrestlers
    .filter((wrestler) => !committed.has(wrestler.id) && isAvailableId(world, wrestler.id))
    .filter((wrestler) => !world.config.roles[wrestler.role].storyGated)
    .filter((wrestler) => !world.titles.some((title) => title.holderId === wrestler.id))
    .map((wrestler) => ({ id: wrestler.id, gap: reference - findPopularity(world, wrestler.id).generalPopularity }))
    // Credible but beatable: the closest act below the wrestler the beat is
    // for, before any above them. Squashing the bottom of the card proves
    // nothing, and losing to somebody bigger is not a showcase at all.
    .sort((a, b) => (a.gap < 0 ? 1 : 0) - (b.gap < 0 ? 1 : 0) || Math.abs(a.gap) - Math.abs(b.gap) || a.id.localeCompare(b.id))
    .slice(0, world.config.booking.beatOutsideCandidateCount)
    .map((entry) => entry.id);
}

/**
 * Turns a template into the shape the beat is actually written in: who it
 * books, and which outsiders the composer may add weeks later. A showcase that
 * can find nobody to face becomes the complication it stands in for — a
 * promotion with no spare bodies still gets a coherent build rather than a beat
 * that can never be booked.
 */
function resolveTemplate(world: WorldState, plan: ProgramPlan, template: BeatTemplate): BeatTemplate & Pick<BeatSpec, "required" | "optional"> {
  const favoured = template.dominant === "payoff_loser" ? payoffLoserId(world, plan) : plannedPayoffWinnerId(world, plan);
  const outsiders = template.type === "showcase_contender_match" || template.type === "attack_save_interference"
    ? outsideCandidates(world, plan, favoured)
    : [];
  if (template.type === "showcase_contender_match") {
    // The rival is not in this match: the whole point is that somebody else
    // takes the fall, in front of them.
    return outsiders.length === 0
      ? { ...ARGUMENT_BUILD[1]!, dominant: template.dominant }
      : { ...template, required: [favoured], optional: outsiders };
  }
  // An ambush works with the two of them; a run-in only makes it better.
  return { ...template, optional: outsiders };
}

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
  for (const [index, planned] of ARCHETYPES[plan.creativeObjective].slice(0, buildTicks.length).entries()) {
    const previous = build.at(-1);
    const template = resolveTemplate(world, plan, planned);
    build.push(beat(world, ctx, plan, {
      type: template.type,
      earliestTick: buildTicks[index]!, latestTick: lastBuildTick,
      effect: template.effect, escalationLevel: index,
      requiredResolvedBeatIds: previous === undefined ? [] : [previous.id],
      dominant: template.dominant,
      ...(template.heat === undefined ? {} : { heat: template.heat }),
      ...(template.required === undefined ? {} : { required: template.required }),
      ...(template.optional === undefined ? {} : { optional: template.optional }),
    }));
  }
  const last = build.at(-1);
  const payoff = beat(world, ctx, plan, {
    type: "ple_payoff",
    earliestTick: plan.targetPayoffTick, latestTick: plan.targetPayoffTick,
    effect: plan.intendedPayoff, escalationLevel: 3,
    requiredResolvedBeatIds: last === undefined ? [] : [last.id],
  });
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

/**
 * Every response restates what the program now intends, after the separator so
 * the original statement survives repeated revisions. booking_ai §9 calls the
 * previous and new intent permanent audit facts; a revision whose two snapshots
 * are identical records a decision nobody made.
 */
const RESTATEMENT = " — ";

function restate(plan: ProgramPlan, note: string): string {
  return `${plan.intendedPayoff.split(RESTATEMENT)[0]!}${RESTATEMENT}${note}`;
}

function nameOf(world: WorldState, wrestlerId: string): string {
  return world.wrestlers.find((wrestler) => wrestler.id === wrestlerId)?.name ?? wrestlerId;
}

type IntentChange = Partial<ProgramIntentSnapshot> & { clearStakesTitleId?: boolean };

/**
 * The single guard behind "no revision-recording path passes an unchanged
 * snapshot": a response that would leave the intent exactly as it was records
 * nothing and reports that it did nothing, so its caller can try the next one.
 */
function revise(
  world: WorldState,
  ctx: TickContext,
  plan: ProgramPlan,
  reason: ProgramRevisionReason,
  response: ProgramRevisionResponse,
  change: IntentChange,
): boolean {
  const previous = snapshot(plan);
  const { clearStakesTitleId, ...fields } = change;
  const next: ProgramIntentSnapshot = { ...previous, ...fields };
  if (clearStakesTitleId === true) delete next.stakesTitleId;
  if (JSON.stringify(next) === JSON.stringify(previous)) return false;
  reviseProgramPlan(world, ctx, plan.id, reason, next, response);
  return true;
}

function beatsOf(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return world.plannedBeats.filter((candidate) => candidate.programId === plan.id);
}

/** Build beats still waiting for a show, in the order the program means to run them. */
function openBuildBeats(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return beatsOf(world, plan)
    .filter((candidate) => candidate.status === "provisional" && candidate.type !== "ple_payoff")
    .sort((a, b) => a.escalationLevel - b.escalationLevel || a.id.localeCompare(b.id));
}

function openPayoffBeats(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return beatsOf(world, plan).filter((candidate) => candidate.type === "ple_payoff" && candidate.status === "provisional");
}

function revisionCount(plan: ProgramPlan, reason: ProgramRevisionReason): number {
  return plan.revisions.filter((revision) => revision.reason === reason).length;
}

/** Lays open build beats over the shows that remain, one opening per show. */
function applyBuildWindows(beats: readonly PlannedBeat[], buildTicks: readonly number[], fallbackTick: number): void {
  const last = buildTicks.at(-1) ?? fallbackTick;
  beats.forEach((candidate, index) => {
    candidate.earliestTick = buildTicks[index] ?? last;
    candidate.latestTick = last;
  });
}

/**
 * Makes a participant the one the program is *for*. The role — not the
 * protected list — is what `finishForPlannedBeat` reads to decide who wins the
 * payoff, so a pivot that leaves the roles alone would change the audit trail
 * and nothing the audience ever sees.
 */
function makeProtagonist(plan: ProgramPlan, wrestlerId: string): void {
  for (const participant of plan.participants) {
    if (participant.wrestlerId === wrestlerId) participant.role = "protagonist";
    else if (participant.role === "protagonist") participant.role = "antagonist";
  }
}

/** Re-points the beats still to come at the wrestler the program now favours. */
function pointBeatsAt(world: WorldState, plan: ProgramPlan, wrestlerId: string): void {
  const core = new Set(plan.participants.map((participant) => participant.wrestlerId));
  for (const candidate of openBuildBeats(world, plan)) {
    // A showcase books one side of the program against an outsider, so pivoting
    // means the *other* side is the one getting the win now. Leaving it alone
    // would build the wrestler the program has just stopped being about.
    if (candidate.type === "showcase_contender_match") {
      candidate.requiredParticipantWrestlerIds = [wrestlerId, ...candidate.requiredParticipantWrestlerIds.filter((id) => !core.has(id))];
      continue;
    }
    const planned = candidate.plannedSegmentOutcome;
    if (planned === undefined || !candidate.requiredParticipantWrestlerIds.includes(wrestlerId)) continue;
    planned.intendedDominantWrestlerId = wrestlerId;
    planned.protectedWrestlerIds = [wrestlerId];
  }
}

/**
 * Get to the payoff sooner: aim at the earliest event the program can still
 * reach, spend the complications there is no longer room for, and open every
 * remaining beat's window now. A program with nothing resolved has no build to
 * cash in, so it declines and lets its caller choose another response.
 */
export function accelerateProgramPlan(
  world: WorldState, ctx: TickContext, plan: ProgramPlan, reason: ProgramRevisionReason, why: string,
): boolean {
  if (plan.completedBeatIds.length === 0) return false;
  const payoffTick = Math.min(nextPleTick(world, ctx.tick + 1), plan.targetPayoffTick);
  const buildTicks = buildShowTicks(world, ctx.tick, payoffTick);
  const open = openBuildBeats(world, plan);
  // Lowest escalation goes first: the go-home angle survives an acceleration,
  // the complication it was still waiting to run does not.
  for (const spent of open.slice(0, Math.max(0, open.length - buildTicks.length))) skipBeat(world, ctx, plan, spent);
  applyBuildWindows(openBuildBeats(world, plan), buildTicks, ctx.tick);
  for (const payoff of openPayoffBeats(world, plan)) {
    payoff.earliestTick = payoffTick;
    payoff.latestTick = payoffTick;
  }
  return revise(world, ctx, plan, reason, "accelerate", {
    targetPayoffTick: payoffTick,
    intendedPayoff: restate(plan, `brought forward: ${why}`),
  });
}

/**
 * Hold the program over to the next event it can reach, moving the remaining
 * build with it. An extended program that has run out of beats gets one
 * keep-warm promo so the extra cycle is not dead air; it is deliberately not a
 * prerequisite of the payoff, so a `payoff_ready` plan stays payoff-ready.
 */
export function extendProgramPlan(
  world: WorldState, ctx: TickContext, plan: ProgramPlan, reason: ProgramRevisionReason, why: string,
): boolean {
  const extended = targetPayoffTick(world, ctx.tick);
  if (extended <= plan.targetPayoffTick) return false;
  const buildTicks = buildShowTicks(world, ctx.tick, extended);
  const open = openBuildBeats(world, plan);
  applyBuildWindows(open, buildTicks, ctx.tick);
  for (const payoff of openPayoffBeats(world, plan)) {
    payoff.earliestTick = extended;
    payoff.latestTick = extended;
  }
  if (open.length === 0 && buildTicks.length > 0) {
    const warm = beat(world, ctx, plan, {
      type: "promo_interview", earliestTick: buildTicks[0]!, latestTick: buildTicks.at(-1)!,
      effect: "Keep the program in front of the crowd until the payoff.",
      escalationLevel: Math.min(3, plan.escalation),
    });
    world.plannedBeats.push(warm);
    plan.plannedBeatIds.push(warm.id);
  }
  return revise(world, ctx, plan, reason, "extend", {
    targetPayoffTick: extended,
    intendedPayoff: restate(plan, `held over: ${why}`),
  });
}

/**
 * Take the program off television for a while and let the story decay on its
 * own. Beats that the freeze leaves no room for are spliced out rather than
 * silently expiring, so the chain behind them still terminates.
 */
export function coolDownProgramPlan(
  world: WorldState, ctx: TickContext, plan: ProgramPlan, reason: ProgramRevisionReason, why: string,
): boolean {
  const until = ctx.tick + world.config.booking.coolDownTicks;
  const lastBuild = buildShowTicks(world, ctx.tick, plan.targetPayoffTick).at(-1);
  for (const frozen of openBuildBeats(world, plan)) {
    if (lastBuild === undefined || until > lastBuild) { skipBeat(world, ctx, plan, frozen); continue; }
    frozen.earliestTick = Math.max(frozen.earliestTick, until);
    frozen.latestTick = Math.max(frozen.latestTick, frozen.earliestTick);
  }
  plan.beatsFrozenUntilTick = until;
  return revise(world, ctx, plan, reason, "cool_down", { intendedPayoff: restate(plan, `cooled off: ${why}`) });
}

/**
 * Change what the program is for rather than when it lands: the wrestler the
 * crowd — or the locker room — actually backs becomes the protected one, and
 * every beat still to come speaks for them.
 */
export function pivotProgramPlan(
  world: WorldState, ctx: TickContext, plan: ProgramPlan, reason: ProgramRevisionReason, why: string,
  favouredWrestlerId: string, extra: IntentChange = {},
): boolean {
  if (!plan.participants.some((participant) => participant.wrestlerId === favouredWrestlerId)) return false;
  makeProtagonist(plan, favouredWrestlerId);
  pointBeatsAt(world, plan, favouredWrestlerId);
  return revise(world, ctx, plan, reason, "pivot", {
    protectedWrestlerIds: [favouredWrestlerId],
    intendedPayoff: restate(plan, `pivoted to ${nameOf(world, favouredWrestlerId)}: ${why}`),
    ...extra,
  });
}

function invalidateAndSubstitute(world: WorldState, ctx: TickContext, plan: ProgramPlan, invalid: PlannedBeat, targetTick: number): void {
  invalid.status = "invalidated";
  const available = invalid.requiredParticipantWrestlerIds.filter((id) => isAvailableId(world, id));
  // `beat` scopes its own creative outcome to whoever it books, so a stand-in
  // for a subset of the program never names an absent wrestler as its dominant
  // — which used to make the segment resolve as a refusal against someone who
  // was never in it.
  const substitute = available.length > 0 && targetTick <= invalid.latestTick
    ? beat(world, ctx, plan, {
      type: "promo_interview", earliestTick: targetTick, latestTick: invalid.latestTick,
      effect: `Keep the program visible while replacing ${invalid.type.replace(/_/g, " ")}.`,
      escalationLevel: invalid.escalationLevel,
      requiredResolvedBeatIds: [...invalid.preconditions.requiredResolvedBeatIds],
      required: available,
    })
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
  revise(world, ctx, plan, "participant_unavailable", "substitute_beat", {
    intendedPayoff: restate(plan, substitute === undefined
      ? `the ${invalid.type.replace(/_/g, " ")} was lost to an unavailable participant.`
      : `re-shaped around whoever is available for the ${invalid.type.replace(/_/g, " ")}.`),
  });
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
    // A cooled-down program is off television until its freeze lifts.
    if (plan.beatsFrozenUntilTick !== undefined && targetTick < plan.beatsFrozenUntilTick) continue;
    const beats = world.plannedBeats.filter((candidate) => candidate.programId === plan.id && candidate.status === "provisional")
      .sort((a, b) => a.escalationLevel - b.escalationLevel || a.id.localeCompare(b.id));
    for (const candidate of beats) {
      if (targetTick > candidate.latestTick) { skipBeat(world, ctx, plan, candidate); continue; }
      if (targetTick < candidate.earliestTick || candidate.preconditions.requirePle !== isPle) continue;
      const prerequisites = candidate.preconditions.requiredResolvedBeatIds;
      if (!prerequisites.every((id) => world.plannedBeats.find((beat) => beat.id === id)?.status === "resolved")) continue;
      if (candidate.requiredParticipantWrestlerIds.some((id) => !isAvailableId(world, id))) {
        invalidateAndSubstitute(world, ctx, plan, candidate, targetTick);
        continue;
      }
      // A beat that needs a body from outside the program — a showcase
      // opponent — cannot air without one, and a program that holds the week
      // open waiting for an opponent who never turns up misses its payoff and
      // is abandoned. Treat the missing outsider as exactly what it is: an
      // unavailable participant, stood in for and spliced out of the chain.
      if (candidate.compatibleSlotKind === "match" && candidate.requiredParticipantWrestlerIds.length < 2
        && !candidate.optionalParticipantWrestlerIds.some((id) => isAvailableId(world, id))) {
        invalidateAndSubstitute(world, ctx, plan, candidate, targetTick);
        continue;
      }
      const directResolved = world.plannedBeats
        .filter((beat) => beat.programId === plan.id && beat.spendsDirectMatchup && beat.status === "resolved");
      const lastDirect = directResolved
        .map((beat) => world.shows.find((show) => show.id === beat.scheduledShowId)?.tick ?? -Infinity)
        .reduce((latest, tick) => Math.max(latest, tick), -Infinity);
      if (candidate.spendsDirectMatchup && targetTick - lastDirect < plan.directMatchCooldownTicks) continue;
      // The rivalry match is rationed, and the blowoff is never what it is
      // rationed against: `directMatchRepetitionBudget` counts how often the
      // pair may meet *before* the payoff, so the crowd has not already seen it.
      if (candidate.spendsDirectMatchup && candidate.type !== "ple_payoff"
        && directResolved.filter((beat) => beat.type !== "ple_payoff").length >= plan.directMatchRepetitionBudget) continue;
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
  revise(world, ctx, plan, reason, "abandon", { intendedPayoff: restate(plan, `abandoned: ${why}`) });
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
    // The extension deliberately leaves the status alone: a plan that had
    // already reached `payoff_ready` is still payoff-ready, only later.
    const extended = extensions < world.config.booking.maxPayoffExtensions
      && extendProgramPlan(world, ctx, plan, "payoff_missed", "the payoff window closed with the build unfinished.");
    if (!extended) abandonProgramPlan(world, ctx, plan, "payoff_missed", "the payoff window closed again with the build unfinished.");
  }
}

/**
 * booking_ai §9's state-driven triggers, read once a tick immediately before
 * the next card is composed — the last moment a decision can still change what
 * airs. The event-driven triggers (a participant lost, a finish deviated, a
 * belt moved, a wrestler pitched) fire from their own paths instead.
 */
export function replanBeforeBooking(world: WorldState, ctx: TickContext): void {
  for (const plan of world.programPlans.filter(isActive).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isActive(plan)) continue;
    if (respondToRepetition(world, ctx, plan)) continue;
    respondToCrowd(world, ctx, plan);
  }
  enforcePayoffCapacity(world, ctx);
}

/**
 * A program that keeps running the same beat, or has already spent the rivalry
 * match it was rationing, is out of things to say. The first time it is told to
 * get to the point; if it repeats itself again after that, it is abandoned. The
 * threshold rises with each response so one stalled program cannot re-trigger
 * every tick on the same evidence.
 */
function respondToRepetition(world: WorldState, ctx: TickContext, plan: ProgramPlan): boolean {
  const responses = revisionCount(plan, "repetition");
  const resolved = beatsOf(world, plan).filter((candidate) => candidate.status === "resolved");
  const byType = new Map<PlannedBeatType, number>();
  for (const candidate of resolved) byType.set(candidate.type, (byType.get(candidate.type) ?? 0) + 1);
  const repeated = [...byType.values()].some((count) => count >= world.config.booking.repeatedBeatTypeLimit + responses);
  const directSpent = resolved.filter((candidate) => candidate.spendsDirectMatchup && candidate.type !== "ple_payoff").length;
  if (!repeated && directSpent <= plan.directMatchRepetitionBudget + responses) return false;
  const why = repeated ? "the program keeps running the same beat." : "the rivalry match is already spent.";
  if (responses === 0) return accelerateProgramPlan(world, ctx, plan, "repetition", why);
  abandonProgramPlan(world, ctx, plan, "repetition", "it repeated itself again with no payoff in reach.");
  return true;
}

const OPPOSITE_HEAT: Record<string, string | undefined> = { positive: "negative", negative: "positive" };

/** Resolved beats of this program whose heat landed the opposite way to the plan. */
function heatContradictions(world: WorldState, plan: ProgramPlan): number {
  const resultIds = new Set(beatsOf(world, plan).flatMap((candidate) => candidate.resultIds));
  return world.segmentResults.filter((result) =>
    resultIds.has(result.id) && result.plannedOutcome !== undefined && result.actualOutcome !== undefined
    && OPPOSITE_HEAT[result.plannedOutcome.intendedHeatDirection] === result.actualOutcome.heatDirection,
  ).length;
}

/** Whoever the program's segments actually made the dominant act, plan or no plan. */
function crowdFavoured(world: WorldState, plan: ProgramPlan): string | undefined {
  const resultIds = new Set(beatsOf(world, plan).flatMap((candidate) => candidate.resultIds));
  const counts = new Map<string, number>();
  for (const result of world.segmentResults) {
    if (!resultIds.has(result.id) || result.actualOutcome === undefined) continue;
    const id = result.actualOutcome.dominantWrestlerId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/**
 * The crowd gets a vote. Heat that repeatedly lands against the booked
 * direction pivots the program behind whoever they are actually reacting to;
 * interest falling away from its own peak either cashes the build in early or,
 * when there is no build to cash, takes the program off television. Responding
 * re-bases the peak, so the trigger re-arms instead of firing forever.
 */
function respondToCrowd(world: WorldState, ctx: TickContext, plan: ProgramPlan): boolean {
  const story = world.stories.find((candidate) => candidate.id === plan.storyId);
  if (story === undefined || story.phase === "resolved") return false;
  const favoured = crowdFavoured(world, plan);
  if (favoured !== undefined && heatContradictions(world, plan) >= world.config.booking.heatContradictionLimit
    && pivotProgramPlan(world, ctx, plan, "crowd_response", "the heat keeps landing the other way", favoured)) {
    story.peakAudienceInterest = story.audienceInterest;
    return true;
  }
  const peak = story.peakAudienceInterest ?? story.audienceInterest;
  if (peak - story.audienceInterest < world.config.booking.crowdResponseInterestDrop) return false;
  story.peakAudienceInterest = story.audienceInterest;
  return accelerateProgramPlan(world, ctx, plan, "crowd_response", "interest is falling away from its peak.")
    || coolDownProgramPlan(world, ctx, plan, "crowd_response", "the crowd stopped caring before the build began.");
}

/**
 * An event of nothing but blowoffs makes none of them matter. When more
 * programs are due to pay off on the upcoming event than it can carry, the
 * coldest are held over — the hot ones keep the date.
 */
function enforcePayoffCapacity(world: WorldState, ctx: TickContext): void {
  const upcoming = ctx.tick + 1;
  if (!isShowTick(upcoming, world.config) || showKindForTick(upcoming, world.config) !== "ple") return;
  const due = world.programPlans.filter(isActive).filter((plan) => openPayoffBeats(world, plan)
    .some((payoff) => payoff.earliestTick <= upcoming && upcoming <= payoff.latestTick));
  const overflow = due.length - world.config.booking.maxPayoffsPerEvent;
  if (overflow <= 0) return;
  const coldest = due
    .map((plan) => ({ plan, interest: world.stories.find((story) => story.id === plan.storyId)?.audienceInterest ?? 0 }))
    .sort((a, b) => a.interest - b.interest || a.plan.id.localeCompare(b.plan.id))
    .slice(0, overflow);
  for (const { plan } of coldest) {
    extendProgramPlan(world, ctx, plan, "payoff_capacity", "the event could not pay off every program at once.");
  }
}

/**
 * Execution facts are a replanning input, never a silent change to a premise —
 * and the cause decides the answer. Someone got hurt, so the program is held
 * over; someone refused or simply took the segment somewhere else, so the plan
 * pivots behind whoever execution actually favoured; a run-in that failed has
 * nothing left to hide behind, so the payoff is brought forward.
 */
export function replanForExecutionDeviation(
  world: WorldState, ctx: TickContext, programPlanId: string,
  cause: ExecutionDeviationCause | undefined, favouredWrestlerId: string,
): void {
  const plan = world.programPlans.find((candidate) => candidate.id === programPlanId);
  if (plan === undefined || !isActive(plan)) return;
  const why = `the ${(cause ?? "execution").replace(/_/g, " ")} changed what happened`;
  const pivot = (): boolean => pivotProgramPlan(world, ctx, plan, "execution_deviation", why, favouredWrestlerId);
  const accelerate = (): boolean => accelerateProgramPlan(world, ctx, plan, "execution_deviation", `${why}.`);
  const extend = (): boolean => extendProgramPlan(world, ctx, plan, "execution_deviation", `${why}.`);
  if (cause === "injury") { if (extend() || pivot()) return; }
  else if (cause === "failed_interference") { if (accelerate() || pivot()) return; }
  else if (pivot() || accelerate()) return;
}

/**
 * A title holder is itself planned state. A belt that moves to someone inside
 * the program makes them what it is about; a belt that leaves the program
 * entirely takes the stakes with it, and what remains is the grudge.
 */
export function replanForTitleChange(world: WorldState, ctx: TickContext, titleId: string): void {
  const holderId = world.titles.find((title) => title.id === titleId)?.holderId;
  for (const plan of world.programPlans) {
    if (plan.stakesTitleId !== titleId || !isActive(plan)) continue;
    if (holderId !== undefined && pivotProgramPlan(world, ctx, plan, "title_change", "the championship changed hands mid-program", holderId)) continue;
    revise(world, ctx, plan, "title_change", "pivot", {
      creativeObjective: "settle_grudge",
      clearStakesTitleId: true,
      intendedPayoff: restate(plan, "the championship left the program; the grudge is what is left."),
    });
  }
}

/**
 * An accepted pitch about a wrestler already inside a program is creative
 * input, not just a story boost. A participant who pitched it bends the program
 * their way; a pitch aimed at someone in a program pushes that program towards
 * its payoff. Either way it moves up the planner's priority list, and it counts
 * once — a wrestler cannot re-pitch their way to the top every week.
 */
export function replanForPlayerPitch(world: WorldState, ctx: TickContext, pitcherId: string, subjectId: string): void {
  const plan = world.programPlans.filter(isActive)
    .filter((candidate) => candidate.participants.some((participant) => participant.wrestlerId === pitcherId || participant.wrestlerId === subjectId))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (plan === undefined || revisionCount(plan, "player_pitch") > 0) return;
  const pitching = plan.participants.some((participant) => participant.wrestlerId === pitcherId);
  const revised = pitching
    ? pivotProgramPlan(world, ctx, plan, "player_pitch", "they asked the GM for this program", pitcherId)
    : accelerateProgramPlan(world, ctx, plan, "player_pitch", `${nameOf(world, pitcherId)} is pushing to be part of it.`);
  if (revised) plan.priority = Math.min(5, plan.priority + 1);
}

/**
 * What a wrestler answers to a reactive decision lands on the program they are
 * in: refusing the booking they were handed pivots it behind them, taking a
 * risk or accepting a turn is momentum the program spends now.
 */
export function replanForPlayerResponse(
  world: WorldState, ctx: TickContext, wrestlerId: string,
  decisionType: ReactiveDecisionType, response: ReactiveResponseToken,
): void {
  const plan = world.programPlans.filter(isActive)
    .filter((candidate) => candidate.participants.some((participant) => participant.wrestlerId === wrestlerId))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (plan === undefined) return;
  const defiant = response === "refuse" || response === "escalate";
  const cooperative = response === "accept" || response === "cooperate_conditionally";
  if (defiant && (decisionType === "booking_request" || decisionType === "finish_changed")) {
    pivotProgramPlan(world, ctx, plan, "player_response", "they refused the booking they were handed", wrestlerId);
    return;
  }
  if (cooperative && decisionType === "turn_proposal") {
    pivotProgramPlan(world, ctx, plan, "player_response", "they agreed to turn", wrestlerId);
    return;
  }
  if (cooperative && decisionType === "risky_opportunity") {
    accelerateProgramPlan(world, ctx, plan, "player_response", `${nameOf(world, wrestlerId)} took the risk that was offered.`);
  }
}
