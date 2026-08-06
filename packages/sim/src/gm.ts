import type { BookingCandidateTrace, BookingSelectionMode, BookingTrace, CardPosition, CardSlot, GmObjective, MatchSlot, PlannedBeat, ProgramPlan, SegmentSlot, Show, ShowKind, Title, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isBookedForTick, isGoHomeShowTick, isShowTick, showKindForTick, weekForTick, weeksSinceLastAppearance } from "./booking.js";
import { recentPerformanceReaction } from "./patience.js";
import { releaseUncommittedBeats } from "./planned-beats.js";
import { plannedPayoffWinnerId, selectPlannedBeatsForShow } from "./program-plans.js";
import { isAvailable, isAvailableId, unavailableReason } from "./injury.js";

// The MVP has no tag division. Keep its legacy token in contracts for old
// snapshots, but never select an objective the scenario cannot execute.
export const SUPPORTED_GM_OBJECTIVES: GmObjective[] = [
  "new_main_eventer", "rebuild_championship", "capitalise_on_rising_star",
  "cool_down_overexposed_act", "prepare_major_event",
];

export function rotateGmObjectiveIfDue(world: WorldState, ctx: TickContext): void {
  // Program plans own medium-term creative direction. The promotion-level
  // objective is only reconsidered after a complete PLE cycle, never on the
  // old short random timer.
  const cycleTicks = world.config.pleIntervalWeeks * (world.config.decisionTicksPerWeek + 1);
  const unsupported = !SUPPORTED_GM_OBJECTIVES.includes(world.gmObjective);
  if (!unsupported && ctx.tick - world.gmObjectiveSince < cycleTicks) return;
  const rng = ctx.rng.fork("gm-objective-rotation");
  const eligible = SUPPORTED_GM_OBJECTIVES.filter((objective) => objective !== world.gmObjective);
  const next = rng.pick(eligible.length > 0 ? eligible : SUPPORTED_GM_OBJECTIVES);
  addEvent(world, ctx, {
    type: "gm_decision",
    summary: `The GM's creative focus shifted from ${world.gmObjective.replace(/_/g, " ")} to ${next.replace(/_/g, " ")}.`,
    wrestlerIds: [], data: { previousObjective: world.gmObjective, objective: next },
  });
  world.gmObjective = next;
  world.gmObjectiveSince = ctx.tick;
}

function isChampion(world: WorldState, wrestlerId: string): boolean {
  return world.titles.some((title) => title.holderId === wrestlerId);
}

/** What the promotion's one creative objective wants from a *wrestler*. */
function objectiveFit(world: WorldState, wrestler: Wrestler): number {
  const popularity = findPopularity(world, wrestler.id);
  switch (world.gmObjective) {
    case "new_main_eventer": return popularity.momentum > 0 && popularity.generalPopularity < 70 ? popularity.momentum * 0.5 : 0;
    // The champion themself, not "anybody reasonably popular": the old
    // `> 50` arm matched most of the roster, which is how this whole term
    // became a flat 20.0 on every candidate of a rebuild cycle.
    case "rebuild_championship": return isChampion(world, wrestler.id) ? 10 : 0;
    case "capitalise_on_rising_star": return popularity.momentum > 10 ? popularity.momentum : 0;
    // This is deliberately a real booking penalty, not merely a slower rise:
    // an overexposed act is pushed down the card and may be rested entirely.
    case "cool_down_overexposed_act": return popularity.fatigue > 60 ? -35 : 0;
    // Preparing an event is a statement about which *slots* matter, not about
    // who is popular. `objectiveSlotFit` carries it.
    case "prepare_major_event": return 0;
    case "strengthen_tag_division": default: return 0;
  }
}

/**
 * What the objective wants from the *slot*. Two of the six objectives are about
 * the shape of the card rather than the people on it, and expressing them
 * per-participant is what made this score component unable to discriminate:
 * a championship cycle wants belts defended, and an approaching event wants
 * program beats rather than rotation — most of all on the go-home show.
 */
function objectiveSlotFit(world: WorldState, slot: CardSlot, targetTick: number): number {
  const bonus = world.config.booking.objectiveSlotFitBonus;
  if (world.gmObjective === "rebuild_championship") {
    return slot.kind !== "segment" && slot.titleId !== undefined ? bonus : 0;
  }
  if (world.gmObjective === "prepare_major_event") {
    if (slot.plannedBeatId === undefined) return 0;
    return isGoHomeShowTick(targetTick, world.config) ? bonus * 2 : bonus;
  }
  return 0;
}

export function bookingScore(world: WorldState, wrestler: Wrestler, currentTick: number): number {
  const popularity = findPopularity(world, wrestler.id);
  const { gmReaction, backstageReaction } = recentPerformanceReaction(world, wrestler.id, currentTick);
  return popularity.generalPopularity + popularity.momentum * 0.5 + objectiveFit(world, wrestler) + (gmReaction + backstageReaction) * 0.15;
}

function bookableWrestlers(world: WorldState): Wrestler[] {
  // Availability is a hard card-composer constraint. A title program must be
  // revised around an unavailable holder, never waive medical clearance.
  return world.wrestlers.filter((wrestler) => isAvailable(world, wrestler));
}

/**
 * Whether a wrestler's last missed show is more recent than their last return —
 * i.e. the audience is still waiting for them. Comparing the two most recent
 * ticks rather than asking whether each has *ever* happened is what lets a
 * wrestler come back more than once over a run.
 */
function isAwayFromTelevision(world: WorldState, wrestlerId: string): boolean {
  let missed = -Infinity;
  let returned = -Infinity;
  for (const event of world.events) {
    if (event.type !== "injury" || !event.wrestlerIds.includes(wrestlerId)) continue;
    if (event.data["absence"] === "missed_show") missed = Math.max(missed, event.tick);
    else if (event.data["absence"] === "return") returned = Math.max(returned, event.tick);
  }
  return missed > returned;
}

function directMatchOnCooldown(world: WorldState, participantIds: readonly string[], targetTick: number, programId?: string): boolean {
  if (participantIds.length < 2) return false;
  const cooldown = programId === undefined
    ? world.config.decisionTicksPerWeek + 1
    : world.programPlans.find((plan) => plan.id === programId)?.directMatchCooldownTicks ?? world.config.decisionTicksPerWeek + 1;
  return world.matchResults.some((result) => {
    if (result.participantWrestlerIds.length !== participantIds.length || !participantIds.every((id) => result.participantWrestlerIds.includes(id))) return false;
    const priorTick = world.shows.find((show) => show.id === result.showId)?.tick;
    return priorTick !== undefined && targetTick - priorTick <= cooldown;
  });
}

/** Whether this exact pairing has already happened at any point in the run. */
function hasAlreadyMet(world: WorldState, participantIds: readonly string[]): boolean {
  return world.matchResults.some((result) =>
    result.participantWrestlerIds.length === participantIds.length
    && participantIds.every((id) => result.participantWrestlerIds.includes(id)),
  );
}

function storyForPair(world: WorldState, a: string, b: string): string | undefined {
  return world.stories.find((story) =>
    story.phase !== "resolved" && story.participantWrestlerIds.length === 2 &&
    story.participantWrestlerIds.includes(a) && story.participantWrestlerIds.includes(b),
  )?.id;
}

/** Whether this wrestler actually worked the most recently aired show. */
function titleEligible(world: WorldState, wrestler: Wrestler, tier: Title["tier"]): boolean {
  const eligibility = world.config.roles[wrestler.role].titleEligibility;
  return eligibility === "all" || (eligibility === "midcard" && tier === "midcard");
}

function participantsTitleEligible(world: WorldState, participantIds: readonly string[], tier: Title["tier"]): boolean {
  return participantIds.every((id) => titleEligible(world, world.wrestlers.find((wrestler) => wrestler.id === id) as Wrestler, tier));
}

/** A stale belt takes priority over a non-title story that cannot carry it. */
function blocksStaleTitleDefense(world: WorldState, participantIds: readonly string[], targetTick: number): boolean {
  return world.titles.some((title) =>
    title.holderId !== undefined && participantIds.includes(title.holderId) &&
    !participantsTitleEligible(world, participantIds, title.tier) &&
    weeksSinceLastTitleDefense(world, title, targetTick) >= world.config.booking.titleDefenseStalenessWeeks,
  );
}

function slot(ctx: TickContext, participants: string[], gmIntent: GmObjective, extras: Partial<MatchSlot> = {}): MatchSlot {
  return { kind: "match", id: ctx.ids.next("slot"), participantWrestlerIds: participants, position: "mid", gmIntent, intents: {}, ...extras };
}

function segmentSlot(ctx: TickContext, participants: string[], gmIntent: GmObjective, extras: Partial<SegmentSlot> = {}): SegmentSlot {
  return { kind: "segment", id: ctx.ids.next("segment-slot"), participantWrestlerIds: participants, position: "mid", gmIntent, intents: {}, ...extras };
}

/** Program planning, rather than match resolution, owns the normal creative finish. */
function finishForPlannedBeat(world: WorldState, plan: ProgramPlan, beat: PlannedBeat, participants: readonly string[], titleId: string | undefined): MatchSlot["plannedFinish"] {
  const titleHolder = titleId === undefined ? undefined : world.titles.find((title) => title.id === titleId)?.holderId;
  const planParticipantIds = new Set(plan.participants.map((participant) => participant.wrestlerId));
  const payoffWinner = plannedPayoffWinnerId(world, plan);
  const intendedWinnerWrestlerId = beat.type === "showcase_contender_match"
    // A showcase exists to make the program's own wrestler credible; the
    // outsider is in the match to take the fall for them.
    ? participants.find((id) => planParticipantIds.has(id)) ?? payoffWinner
    : beat.type === "direct_rivalry_match"
      // Momentum trades. The television fall goes to whoever is losing the
      // blowoff, so the payoff is a comeback rather than a formality.
      ? plan.participants.find((participant) => participant.wrestlerId !== payoffWinner)?.wrestlerId ?? payoffWinner
      : payoffWinner;
  const winner = participants.includes(intendedWinnerWrestlerId) ? intendedWinnerWrestlerId : participants[0]!;
  const winnerRole = plan.participants.find((participant) => participant.wrestlerId === winner)?.role;
  return {
    intendedWinnerWrestlerId: winner,
    finishFamily: titleHolder !== undefined && winnerRole === "antagonist" ? "dirty" : "clean",
    protectedWrestlerIds: plan.protectedWrestlerIds.filter((id) => participants.includes(id)),
    intendedTitleConsequence: titleHolder === undefined ? "none" : winner === titleHolder ? "retain" : "change",
    intendedStoryEffect: beat.intendedStoryEffect,
    adherenceStrength: beat.type === "ple_payoff" ? "strict" : "standard",
  };
}

/** Story and title matches always have a GM-owned outcome, even outside a private program beat. */
function finishForBookedStoryOrTitle(world: WorldState, booked: MatchSlot): NonNullable<MatchSlot["plannedFinish"]> {
  const holder = booked.titleId === undefined ? undefined : world.titles.find((title) => title.id === booked.titleId)?.holderId;
  const intendedWinnerWrestlerId = holder !== undefined && booked.participantWrestlerIds.includes(holder)
    ? holder
    : booked.participantWrestlerIds[0]!;
  return {
    intendedWinnerWrestlerId,
    finishFamily: "clean",
    protectedWrestlerIds: [],
    intendedTitleConsequence: holder === undefined ? "none" : holder === intendedWinnerWrestlerId ? "retain" : "change",
    intendedStoryEffect: booked.storyId === undefined ? "Complete the championship booking." : "Advance the booked story.",
    adherenceStrength: "standard",
  };
}

function highestScoringContender(world: WorldState, title: Title, used: Set<string>, currentTick: number): Wrestler | undefined {
  if (!title.holderId) return undefined;
  const holder = title.holderId;
  const storyParticipants = world.stories
    .filter((story) => story.phase !== "resolved" && story.participantWrestlerIds.includes(holder))
    .flatMap((story) => story.participantWrestlerIds.filter((id) => id !== holder));
  const formerMidcardChampions = new Set(world.events
    .filter((event) => event.type === "title_change" && event.data["titleId"] === world.titles.find((candidate) => candidate.tier === "midcard")?.id)
    .flatMap((event) => event.wrestlerIds));
  const priorWorldTitleAppearances = new Map<string, number>();
  if (title.tier === "world") {
    for (const result of world.matchResults) {
      const show = world.shows.find((candidate) => candidate.id === result.showId);
      const slot = show?.card.find((candidate) => candidate.id === result.matchSlotId);
      if (slot?.titleId !== title.id) continue;
      for (const wrestlerId of result.participantWrestlerIds) {
        priorWorldTitleAppearances.set(wrestlerId, (priorWorldTitleAppearances.get(wrestlerId) ?? 0) + 1);
      }
    }
  }
  return bookableWrestlers(world)
    // A champion should defend their own belt rather than be double-booked
    // into a different title scene on the same PLE. Once they lose it they
    // remain eligible for the next tier, preserving the ex-champion pathway.
    .filter((wrestler) => wrestler.id !== holder && !isChampion(world, wrestler.id) && !used.has(wrestler.id) && titleEligible(world, wrestler, title.tier))
    .map((wrestler) => ({
      wrestler,
      // A strong IC reign is a proving ground: keep former champions in the
      // world-title conversation without making a belt an automatic promotion.
      score: bookingScore(world, wrestler, currentTick) +
        (storyParticipants.includes(wrestler.id) ? 25 : 0) +
        (title.tier === "world" && formerMidcardChampions.has(wrestler.id) ? 45 : 0) -
        (title.tier === "world" ? (priorWorldTitleAppearances.get(wrestler.id) ?? 0) * 100 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.wrestler;
}

/**
 * The card is ordered around programs, not championships. A belt contributes
 * stakes heat, but a hotter personal story may still close the show.
 */
export function programHeat(world: WorldState, booked: CardSlot): number {
  const tuning = world.config.booking;
  const story = booked.storyId ? world.stories.find((candidate) => candidate.id === booked.storyId) : undefined;
  const participantHeat = booked.participantWrestlerIds.reduce((sum, wrestlerId) => {
    const popularity = findPopularity(world, wrestlerId);
    return sum + popularity.momentum * tuning.heatParticipantMomentumWeight +
      popularity.generalPopularity * tuning.heatParticipantPopularityWeight;
  }, 0);
  const title = booked.kind !== "segment" && booked.titleId ? world.titles.find((candidate) => candidate.id === booked.titleId) : undefined;
  const stakesHeat = title?.tier === "world"
    ? tuning.worldTitleStakesHeatBonus
    : title?.tier === "midcard" ? tuning.midcardTitleStakesHeatBonus : 0;
  const grudgeHeat = story && (story.tension === "grudge" || story.tension === "betrayal")
    ? tuning.grudgeHeatBonus
    : 0;
  return (story ? story.audienceInterest + story.momentum * tuning.heatStoryMomentumWeight : 0) +
    participantHeat + stakesHeat + grudgeHeat;
}

function titleForStory(world: WorldState, storyId: string): Title | undefined {
  const story = world.stories.find((candidate) => candidate.id === storyId);
  return story
    ? world.titles.find((title) => title.holderId !== undefined && story.participantWrestlerIds.includes(title.holderId) && participantsTitleEligible(world, story.participantWrestlerIds, title.tier))
    : undefined;
}

function isTopOfCardProgram(world: WorldState, booked: MatchSlot): boolean {
  const candidateHeat = programHeat(world, booked);
  const hottestActiveStory = Math.max(0, ...world.stories
    .filter((story) => story.phase !== "resolved" && story.participantWrestlerIds.length >= 2)
    .map((story) => programHeat(world, {
      id: `heat-${story.id}`,
      participantWrestlerIds: story.participantWrestlerIds,
      position: "mid",
      storyId: story.id,
      ...(titleForStory(world, story.id) ? { titleId: titleForStory(world, story.id)!.id } : {}),
      intents: {},
    })));
  return candidateHeat >= hottestActiveStory;
}

/** The positions a card makes a statement with. Everything else is `mid`. */
const DISTINGUISHED_POSITIONS: readonly CardPosition[] = ["main_event", "opener", "upper"];

/** The show that aired most recently before the one being composed. */
function previousShow(world: WorldState, targetTick: number): Show | undefined {
  return world.shows.filter((show) => show.tick < targetTick).sort((a, b) => a.tick - b.tick).at(-1);
}

/**
 * Card order is a creative statement, not a heat sort.
 *
 * Two rules beyond heat, both from observed runs. Television closes on a
 * *match* unless an angle is genuinely hotter than every match on the show —
 * every main event of the pre-3.12.7 run was a promo. And a program pays to
 * keep the position it held last week: the same feud opening three shows
 * running tells the audience nothing has changed, however hot it is.
 */
function assignPositions(world: WorldState, kind: ShowKind, targetTick: number, slots: CardSlot[]): CardSlot[] {
  const tuning = world.config.booking;
  const prior = previousShow(world, targetTick);
  const heldPosition = (slot: CardSlot): CardPosition | undefined => slot.programId === undefined
    ? undefined
    : prior?.card.find((candidate) => candidate.programId === slot.programId)?.position;
  const placementScore = (slot: CardSlot, position: CardPosition): number =>
    programHeat(world, slot)
    + (position === "main_event" && kind === "tv" && slot.kind !== "segment" ? tuning.tvMainEventMatchBias : 0)
    - (heldPosition(slot) === position ? tuning.repeatPlacementPenalty : 0);

  const remaining = slots.slice();
  const placed: CardSlot[] = [];
  for (const position of DISTINGUISHED_POSITIONS) {
    if (remaining.length === 0) break;
    const best = remaining.slice()
      .sort((a, b) => placementScore(b, position) - placementScore(a, position) || a.id.localeCompare(b.id))[0]!;
    remaining.splice(remaining.indexOf(best), 1);
    placed.push({ ...best, position });
  }
  return [
    ...placed,
    ...remaining
      .sort((a, b) => programHeat(world, b) - programHeat(world, a) || a.id.localeCompare(b.id))
      .map((booked) => ({ ...booked, position: "mid" as const })),
  ];
}

/**
 * booking_ai §10's soft score, for one candidate. Since Phase 3.12.7 this is
 * what actually *selects* the discretionary part of the card rather than being
 * recomputed afterwards for the trace, so every term here is a real booking
 * decision and a term that cannot discriminate is a defect.
 */
function scoreComponents(world: WorldState, slot: CardSlot, targetTick: number): Record<string, number> {
  const plan = slot.programId === undefined ? undefined : world.programPlans.find((candidate) => candidate.id === slot.programId);
  const beat = slot.plannedBeatId === undefined ? undefined : world.plannedBeats.find((candidate) => candidate.id === slot.plannedBeatId);
  const urgency = beat === undefined ? 0 : Math.max(0, beat.latestTick - targetTick === 0 ? 30 : 10 - (beat.latestTick - targetTick));
  const objective = slot.participantWrestlerIds.reduce((sum, id) => sum + objectiveFit(world, world.wrestlers.find((wrestler) => wrestler.id === id)!), 0);
  const conditionRisk = slot.participantWrestlerIds.reduce((sum, id) => sum + Math.max(0, 60 - (world.wrestlers.find((wrestler) => wrestler.id === id)?.condition ?? 0)), 0);
  const overexposure = slot.participantWrestlerIds.reduce((sum, id) => sum + (findPopularity(world, id).fatigue * 0.25), 0);
  return {
    programPriority: plan?.priority ?? 0,
    beatUrgency: urgency,
    heat: programHeat(world, slot),
    promotionObjectiveFit: objective + objectiveSlotFit(world, slot, targetTick),
    // An act nobody has booked yet is the *freshest* thing on the roster, not
    // the stalest. Reading the undefined appearance history as 1 was harmless
    // while this score was only decoration on the trace; once it selected, it
    // became a starvation loop — never booked, so never fresh, so never booked
    // — and three wrestlers went a full 26 weeks without a match.
    freshness: slot.participantWrestlerIds.reduce((sum, id) =>
      sum + (weeksSinceLastAppearance(world, id, targetTick) ?? weekForTick(targetTick, world.config)), 0),
    cardShapeContribution: slot.kind === "segment" ? 2 : 1,
    overexposure: -overexposure,
    repeatPairing: -repeatPairingPenalty(world, slot.participantWrestlerIds, targetTick),
    conditionRisk: -conditionRisk,
  };
}

/**
 * What a pairing costs for having been seen before — booking_ai §10's
 * `repeat-pairing penalty`, which the soft score has listed since Phase 3.12
 * and nothing implemented. A rematch is a creative decision a program makes on
 * purpose; open rotation stumbling into one is just a card repeating itself.
 */
function repeatPairingPenalty(world: WorldState, participantIds: readonly string[], targetTick: number): number {
  if (participantIds.length < 2) return 0;
  const tuning = world.config.booking;
  const priorTicks = world.matchResults
    .filter((result) => result.participantWrestlerIds.length === participantIds.length
      && participantIds.every((id) => result.participantWrestlerIds.includes(id)))
    .flatMap((result) => {
      const tick = world.shows.find((show) => show.id === result.showId)?.tick;
      return tick === undefined || tick >= targetTick ? [] : [tick];
    });
  if (priorTicks.length === 0) return 0;
  const previous = previousShow(world, targetTick);
  const consecutive = previous !== undefined && priorTicks.includes(previous.tick);
  return tuning.repeatPairingPenalty + (consecutive ? tuning.consecutivePairingPenalty : 0);
}

function placementReason(slot: CardSlot): string {
  if (slot.plannedBeatId !== undefined) return "reserved program beat";
  if (slot.titleId !== undefined) return "title obligation";
  if (slot.storyId !== undefined) return "supporting story progression";
  return "roster rotation showcase";
}

/** One discretionary candidate a score pass considered but could not fit. */
interface RejectedCandidate {
  slot: CardSlot;
  pool: BookingSelectionMode;
  reason: string;
}

/** Build the durable, private audit record after hard-valid candidates are committed. */
function compositionTrace(
  world: WorldState, composedAtTick: number, targetTick: number, card: readonly CardSlot[],
  selectionModes: ReadonlyMap<string, BookingSelectionMode>, rejected: readonly RejectedCandidate[],
): BookingTrace {
  const selectedBeatIds = new Set(card.flatMap((slot) => slot.plannedBeatId === undefined ? [] : [slot.plannedBeatId]));
  const candidates: BookingCandidateTrace[] = card.map((slot) => {
    const components = scoreComponents(world, slot, targetTick);
    return {
      id: `candidate:${slot.id}`, kind: slot.kind ?? "match", participantWrestlerIds: [...slot.participantWrestlerIds],
      ...(slot.programId === undefined ? {} : { programId: slot.programId }),
      ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }),
      ...(slot.kind === "match" && slot.titleId !== undefined ? { titleId: slot.titleId } : {}),
      disposition: "selected", selection: selectionModes.get(slot.id) ?? "reserved",
      hardInvalidReasons: [], scoreComponents: components,
      totalScore: Object.values(components).reduce((sum, value) => sum + value, 0), slotId: slot.id,
      placementReason: `${placementReason(slot)}; ${slot.position.replace(/_/g, " ")}`,
    };
  });
  // Everything the score pass weighed and left off, with the score it lost on.
  // "Why was this booked?" is only answerable next to what was not.
  for (const { slot, pool, reason } of rejected) {
    const components = scoreComponents(world, slot, targetTick);
    candidates.push({
      id: `candidate:${slot.id}`, kind: slot.kind ?? "match", participantWrestlerIds: [...slot.participantWrestlerIds],
      ...(slot.kind === "match" && slot.titleId !== undefined ? { titleId: slot.titleId } : {}),
      disposition: "rejected", selection: pool, hardInvalidReasons: [], scoreComponents: components,
      totalScore: Object.values(components).reduce((sum, value) => sum + value, 0),
      placementReason: reason,
    });
  }
  const isPle = showKindForTick(targetTick, world.config) === "ple";
  for (const beat of world.plannedBeats) {
    if ((beat.status !== "provisional" && beat.status !== "scheduled" && beat.status !== "invalidated") || selectedBeatIds.has(beat.id)) continue;
    const missingPrerequisite = beat.preconditions.requiredResolvedBeatIds.some((id) => world.plannedBeats.find((candidate) => candidate.id === id)?.status !== "resolved");
    const unavailable = beat.requiredParticipantWrestlerIds.some((id) => !isAvailableId(world, id));
    const alreadyBooked = beat.requiredParticipantWrestlerIds.some((id) => card.some((slot) => slot.participantWrestlerIds.includes(id)));
    const inSchedulingWindow = targetTick >= beat.earliestTick && targetTick <= beat.latestTick && beat.preconditions.requirePle === isPle;
    const directCooldown = beat.compatibleSlotKind === "match" && directMatchOnCooldown(world, beat.requiredParticipantWrestlerIds, targetTick, beat.programId);
    const storyId = world.programPlans.find((plan) => plan.id === beat.programId)?.storyId;
    const hardInvalidReasons = [
      ...(unavailable ? ["availability_or_condition"] : []),
      ...(inSchedulingWindow && alreadyBooked ? ["participant_double_booking"] : []),
      ...(inSchedulingWindow && directCooldown ? ["direct_match_cooldown"] : []),
      ...(missingPrerequisite ? ["beat_precondition_unmet"] : []),
    ];
    const virtualSlot: CardSlot = beat.compatibleSlotKind === "segment"
      ? { kind: "segment", id: `trace-${beat.id}`, participantWrestlerIds: beat.requiredParticipantWrestlerIds, position: "mid", gmIntent: world.gmObjective, programId: beat.programId, ...(storyId === undefined ? {} : { storyId }), intents: {} }
      : { kind: "match", id: `trace-${beat.id}`, participantWrestlerIds: beat.requiredParticipantWrestlerIds, position: "mid", gmIntent: world.gmObjective, programId: beat.programId, ...(storyId === undefined ? {} : { storyId }), intents: {} };
    const components = scoreComponents(world, virtualSlot, targetTick);
    candidates.push({
      id: `candidate:beat:${beat.id}`, kind: beat.compatibleSlotKind === "segment" ? "segment" : "match", participantWrestlerIds: [...beat.requiredParticipantWrestlerIds],
      programId: beat.programId, plannedBeatId: beat.id,
      disposition: hardInvalidReasons.length > 0 ? "hard_invalid" : "rejected", hardInvalidReasons,
      scoreComponents: components, totalScore: Object.values(components).reduce((sum, value) => sum + value, 0),
      placementReason: hardInvalidReasons.length > 0
        ? "failed hard constraint"
        : !inSchedulingWindow
          ? "outside this show's scheduling window"
          : "capacity reserved for higher-priority candidates",
    });
  }
  return { composedAtTick, targetTick, candidates };
}

function weeksSinceLastTitleDefense(world: WorldState, title: Title, targetTick: number): number {
  const lastDefenseTick = Math.max(
    title.since ?? 0,
    ...world.events
      .filter((event) => event.type === "title_change" && event.data["titleId"] === title.id)
      .map((event) => event.tick),
  );
  return Math.max(0, weekForTick(targetTick, world.config) - weekForTick(lastDefenseTick, world.config));
}

function hasReadyContender(world: WorldState, title: Title, used: Set<string>): boolean {
  if (!title.holderId) return false;
  const holderHasActiveStory = world.stories.some((story) =>
    story.phase !== "resolved" && story.participantWrestlerIds.includes(title.holderId!),
  );
  return holderHasActiveStory || bookableWrestlers(world).some((wrestler) =>
    wrestler.id !== title.holderId && !used.has(wrestler.id) && titleEligible(world, wrestler, title.tier) &&
    findPopularity(world, wrestler.id).momentum >= world.config.booking.contenderReadyMomentumThreshold,
  );
}

export function bookShow(world: WorldState, ctx: TickContext, targetTick: number): Show {
  const kind = showKindForTick(targetTick, world.config);
  const range = kind === "ple" ? world.config.pleCardSize : world.config.tvCardSize;
  const targetSlotCount = ctx.rng.fork(`booking:${targetTick}`).int(range.min, range.max);
  const eligible = new Set(bookableWrestlers(world).map((wrestler) => wrestler.id));
  for (const wrestler of world.wrestlers.filter((candidate) => !eligible.has(candidate.id))) {
    const reason = unavailableReason(world, wrestler);
    addEvent(world, ctx, {
      type: "injury",
      summary: reason === "not_cleared"
        ? `${wrestler.name} is still on the shelf and misses the upcoming show.`
        : `${wrestler.name} is not cleared to compete and will miss the upcoming show.`,
      wrestlerIds: [wrestler.id],
      data: {
        absence: "missed_show", condition: wrestler.condition, reason,
        ...(wrestler.unavailableUntilTick === undefined ? {} : { unavailableUntilTick: wrestler.unavailableUntilTick }),
      },
    });
  }
  const used = new Set<string>();
  const slots: CardSlot[] = [];
  // booking_ai §10's composition order: hard obligations are *reserved* in
  // order, and everything discretionary below competes on the soft score.
  const selectionModes = new Map<string, BookingSelectionMode>();
  const rejected: RejectedCandidate[] = [];
  // Planned beats claim their own match/segment primitive. The old random
  // segment chance remains only for unplanned filler below.
  const plannedBeats = selectPlannedBeatsForShow(world, ctx, targetTick, targetSlotCount);
  for (const plannedBeat of plannedBeats) {
    const plan = world.programPlans.find((candidate) => candidate.id === plannedBeat.programId)!;
    const required = plannedBeat.requiredParticipantWrestlerIds;
    if (required.some((id) => used.has(id))) {
      // `selectPlannedBeatsForShow` is intentionally program-local; the
      // composer is the final no-double-booking authority. The beat is released
      // back to the pool with every other uncommitted one below.
      continue;
    }
    // Optional participants are named weeks ahead as a shortlist, so the
    // composer picks from whoever is still free and cleared tonight rather than
    // losing the beat because the first name on it is busy. The pairing rules
    // are the composer's, not the planner's: an outsider on cooldown with this
    // beat's own wrestlers is barred outright, and one they have already met
    // this run goes to the back of the queue so a showcase does not quietly
    // become the same match twice.
    const extras = plannedBeat.optionalParticipantWrestlerIds
      .filter((id) => !required.includes(id) && !used.has(id) && eligible.has(id))
      .filter((id) => !directMatchOnCooldown(world, [...required, id], targetTick, plannedBeat.programId))
      .sort((a, b) => Number(hasAlreadyMet(world, [...required, a])) - Number(hasAlreadyMet(world, [...required, b])))
      .slice(0, world.config.booking.maxOptionalBeatParticipants);
    const participants = [...required, ...extras];
    // A showcase books one side of the program against an outsider, so it is
    // the one beat that can arrive without an opponent. Hold it for a show
    // where somebody is free rather than booking a match against nobody.
    if (plannedBeat.compatibleSlotKind === "match" && participants.length < 2) continue;
    participants.forEach((id) => used.add(id));
    const shared = { storyId: plan.storyId, programId: plan.id, plannedBeatId: plannedBeat.id };
    const titleId = plannedBeat.type === "ple_payoff" ? plan.stakesTitleId : undefined;
    slots.push(plannedBeat.compatibleSlotKind === "match"
      ? slot(ctx, participants, world.gmObjective, { ...shared, ...(titleId === undefined ? {} : { titleId }), plannedFinish: finishForPlannedBeat(world, plan, plannedBeat, participants, titleId) })
      : segmentSlot(ctx, participants, world.gmObjective, { ...shared, ...(plannedBeat.plannedSegmentOutcome === undefined ? {} : { plannedOutcome: plannedBeat.plannedSegmentOutcome }) }));
  }
  // A stale championship has a hard defence floor. Reserve one viable
  // challenger before the program pass so unrelated peaking stories cannot
  // consume the entire pool and accidentally strand that defence.
  const reservedStaleContenders = new Set<string>();
  if (kind === "ple") {
    for (const title of world.titles) {
      if (!title.holderId || !eligible.has(title.holderId)) continue;
      const holder = world.wrestlers.find((wrestler) => wrestler.id === title.holderId) as Wrestler;
      if (!titleEligible(world, holder, title.tier)) continue;
      const stale = weeksSinceLastTitleDefense(world, title, targetTick) >= world.config.booking.titleDefenseStalenessWeeks;
      if (!stale) continue;
      const contender = highestScoringContender(world, title, reservedStaleContenders, ctx.tick);
      if (contender) reservedStaleContenders.add(contender.id);
    }
  }

  // A PLE reserves a genuine blowoff for every peaking story no program is
  // building. A planned program's climax is its own `ple_payoff` beat, booked
  // by the pass above — this legacy fallback must not deliver it a second time,
  // which is how stories used to resolve while their plans stayed open.
  if (kind === "ple") {
    for (const story of world.stories.filter((candidate) => candidate.phase === "peaking" && candidate.participantWrestlerIds.length >= 2)) {
      const participants = story.participantWrestlerIds;
      if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
      const linkedPlan = world.programPlans.find((plan) => plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready"));
      if (linkedPlan !== undefined) continue;
      if (directMatchOnCooldown(world, participants, targetTick)) continue;
      if (blocksStaleTitleDefense(world, participants, targetTick)) continue;
      const title = world.titles.find((candidate) =>
        candidate.holderId !== undefined && participants.includes(candidate.holderId) && participantsTitleEligible(world, participants, candidate.tier),
      );
      if (participants.some((id) => reservedStaleContenders.has(id)) && !title) continue;
      // A title program can earn a trilogy when it is genuinely the hottest
      // program on the card; ordinary repeat title pairings still rotate out.
      const pairAlreadyMetForTitle = title !== undefined && world.matchResults.some((result) => {
        const priorShow = world.shows.find((show) => show.id === result.showId);
        const priorSlot = priorShow?.card.find((slot) => slot.id === result.matchSlotId);
        return priorSlot?.kind !== "segment" && priorSlot?.titleId === title.id && participants.every((id) => result.participantWrestlerIds.includes(id));
      });
      const potentialSlot = slot(ctx, participants, world.gmObjective, {
        storyId: story.id, ...(title ? { titleId: title.id } : {}),
      });
      if (pairAlreadyMetForTitle && !isTopOfCardProgram(world, potentialSlot)) continue;
      for (const wrestlerId of participants) used.add(wrestlerId);
      slots.push(potentialSlot);
    }
  }

  // Titles defend on a credible challenger or their configured staleness clock;
  // a championship is stakes for a program, not the PLE's skeleton.
  if (kind === "ple") {
    for (const title of world.titles) {
      if (!title.holderId || !eligible.has(title.holderId)) continue;
      const holderId = title.holderId;
      const holder = world.wrestlers.find((wrestler) => wrestler.id === holderId) as Wrestler;
      if (!titleEligible(world, holder, title.tier)) continue;
      // A peaking title story may already have claimed this belt's PLE
      // defense. Do not turn that one match into a second title defense.
      if (slots.some((candidate) => candidate.titleId === title.id)) continue;
      const existing = slots.find((candidate) => candidate.participantWrestlerIds.includes(holderId) && candidate.titleId === undefined);
      const stale = weeksSinceLastTitleDefense(world, title, targetTick) >= world.config.booking.titleDefenseStalenessWeeks;
      const ready = hasReadyContender(world, title, used);
      if (!stale && !ready) continue;
      if (existing && participantsTitleEligible(world, existing.participantWrestlerIds, title.tier)) { existing.titleId = title.id; continue; }
      if (used.has(holderId)) continue;
      const contender = highestScoringContender(world, title, used, ctx.tick);
      if (!contender) continue;
      used.add(holderId); used.add(contender.id);
      const storyId = storyForPair(world, holderId, contender.id);
      slots.push(slot(ctx, [holderId, contender.id], world.gmObjective, {
        titleId: title.id, ...(storyId ? { storyId } : {}),
      }));
    }
  }

  // Everything above is a reserved obligation, claimed in composition order.
  for (const booked of slots) selectionModes.set(booked.id, "reserved");

  /**
   * Commit discretionary candidates strictly in soft-score order. Before Phase
   * 3.12.7 each pass had its own ordering — stories by raw audience interest,
   * rotation by a private rotation score — and `scoreComponents` was computed
   * afterwards purely so the trace had numbers in it. The score the report
   * shows is now the score that decided.
   */
  const commitScored = (candidates: readonly CardSlot[], pool: BookingSelectionMode, limit: number): void => {
    const ranked = candidates
      .map((candidate) => ({ candidate, components: scoreComponents(world, candidate, targetTick) }))
      .map((entry) => ({ ...entry, score: Object.values(entry.components).reduce((sum, value) => sum + value, 0) }))
      .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
    for (const { candidate } of ranked) {
      if (slots.length >= limit) { rejected.push({ slot: candidate, pool, reason: "capacity reserved for higher-scoring candidates" }); continue; }
      if (candidate.participantWrestlerIds.some((id) => used.has(id))) { rejected.push({ slot: candidate, pool, reason: "a higher-scoring candidate booked one of its participants" }); continue; }
      candidate.participantWrestlerIds.forEach((id) => used.add(id));
      selectionModes.set(candidate.id, pool);
      slots.push(candidate);
    }
  };

  const storySlotBudget = kind === "tv" ? Math.min(2, targetSlotCount) : targetSlotCount;
  const storyCandidates: CardSlot[] = [];
  for (const story of world.stories.filter((candidate) => candidate.phase === "building" && candidate.participantWrestlerIds.length >= 2)) {
    const participants = story.participantWrestlerIds;
    if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
    const linkedPlan = world.programPlans.find((plan) => plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready"));
    if (directMatchOnCooldown(world, participants, targetTick, linkedPlan?.id)) continue;
    // TV title bouts are exceptional and only happen when the story itself justifies one.
    const title = kind === "tv" && ctx.rng.fork(`tv-title:${story.id}`).chance(0.08)
      ? world.titles.find((candidate) => candidate.tier === "midcard" && candidate.holderId !== undefined && participants.includes(candidate.holderId) && participantsTitleEligible(world, participants, candidate.tier)) : undefined;
    const useSegment = kind === "tv" && ctx.rng.fork(`story-segment:${targetTick}:${story.id}`).chance(world.config.booking.segmentChance);
    storyCandidates.push(useSegment
      ? segmentSlot(ctx, participants, world.gmObjective, { storyId: story.id })
      : slot(ctx, participants, world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
  }
  commitScored(storyCandidates, "scored_story", storySlotBudget);

  const previousAppearances = new Map<string, number>();
  for (const result of world.matchResults) {
    for (const wrestlerId of result.participantWrestlerIds) {
      previousAppearances.set(wrestlerId, (previousAppearances.get(wrestlerId) ?? 0) + 1);
    }
  }
  // Who is *due* is a cadence question the soft score does not answer: rest
  // pressure, appearance counts, and a return from injury are roster rules, so
  // they decide the order the rotation pool is drawn from. What the pool is
  // worth on this card is then the same soft score as everything else.
  const rotationPool = bookableWrestlers(world)
    .filter((wrestler) => !used.has(wrestler.id))
    // Legends and part-timers only appear through the meaningful story/title
    // passes above; ordinary rotation never spends a rare appearance.
    .filter((wrestler) => !world.config.roles[wrestler.role].storyGated)
    .filter((wrestler) => !(world.gmObjective === "cool_down_overexposed_act" && findPopularity(world, wrestler.id).fatigue > 75))
    .sort((a, b) => {
      const rotationScore = (wrestler: Wrestler) => {
        const appearances = previousAppearances.get(wrestler.id) ?? 0;
        // The first recovered booking is the visible return beat, so it gets
        // priority over ordinary rotation once the wrestler is cleared.
        const returnBonus = isAwayFromTelevision(world, wrestler.id) ? 500 : 0;
        // This applies only to open rotation. At a role's ideal cadence there
        // is no penalty; booking more frequently creates a role-scaled rest
        // pressure, steepest for rare acts.
        const role = world.config.roles[wrestler.role];
        const weeksOut = weeksSinceLastAppearance(world, wrestler.id, targetTick);
        const gapRatio = (weeksOut ?? role.idealGapWeeks) / role.idealGapWeeks;
        const restPenalty = gapRatio < 1
          ? world.config.booking.restPenalty * (1 - gapRatio) * role.overexposureSensitivity
          : 0;
        return bookingScore(world, wrestler, ctx.tick) - appearances * 7 + Math.max(0, 3 - appearances) * 100 + returnBonus - restPenalty;
      };
      return rotationScore(b) - rotationScore(a) || a.id.localeCompare(b.id);
    })
    .map((wrestler) => wrestler.id);

  const rotationCandidates: CardSlot[] = [];
  // One TV undercard match may become a triple threat or fatal four-way. It
  // draws strictly from the rotation pool, never consuming a story or title slot.
  if (kind === "tv" && slots.length < targetSlotCount && rotationPool.length >= 3
    && ctx.rng.fork(`multi-way:${targetTick}`).chance(world.config.booking.multiWayChance)) {
    rotationCandidates.push(slot(ctx, rotationPool.splice(0, Math.min(world.config.booking.maxMultiWayParticipants, rotationPool.length)), world.gmObjective));
  }
  // Pair the pool greedily rather than by adjacency in the due order. Adjacency
  // is what quietly handed the same two acts each other week after week: the
  // rest and appearance rules put them next to each other every time. The most
  // due wrestler goes on first, against whoever is next due among the partners
  // the repeat-pairing penalty does not object to.
  while (rotationPool.length >= 2) {
    const first = rotationPool.shift()!;
    const partner = rotationPool
      .map((id, index) => ({ id, index }))
      .filter((entry) => !directMatchOnCooldown(world, [first, entry.id], targetTick))
      .sort((a, b) => repeatPairingPenalty(world, [first, a.id], targetTick) - repeatPairingPenalty(world, [first, b.id], targetTick) || a.index - b.index)[0];
    if (partner === undefined) continue;
    rotationPool.splice(partner.index, 1);
    rotationCandidates.push(slot(ctx, [first, partner.id], world.gmObjective));
  }
  commitScored(rotationCandidates, "scored_rotation", targetSlotCount);

  const committedSlots = slots.map((booked) => {
    if (booked.kind === "segment" || booked.plannedFinish !== undefined || (booked.storyId === undefined && booked.titleId === undefined)) return booked;
    return { ...booked, plannedFinish: finishForBookedStoryOrTitle(world, booked) };
  });
  const positionedCard = assignPositions(world, kind, targetTick, committedSlots);
  const show: Show = {
    id: ctx.ids.next("show"), tick: targetTick, kind, card: positionedCard,
    bookingTrace: compositionTrace(world, ctx.tick, targetTick, positionedCard, selectionModes, rejected),
  };
  for (const plannedBeat of plannedBeats) {
    if (!positionedCard.some((slot) => slot.plannedBeatId === plannedBeat.id)) continue;
    plannedBeat.scheduledShowId = show.id;
    const storyId = world.programPlans.find((plan) => plan.id === plannedBeat.programId)?.storyId;
    addEvent(world, ctx, {
      type: "planned_beat_scheduled",
      summary: `The GM scheduled a ${plannedBeat.type.replace(/_/g, " ")} beat.`,
      wrestlerIds: plannedBeat.requiredParticipantWrestlerIds,
      ...(storyId === undefined ? {} : { storyId }),
      showId: show.id,
      data: { programPlanId: plannedBeat.programId, plannedBeatId: plannedBeat.id, type: plannedBeat.type },
    });
  }
  // Selection marks a beat `scheduled` before the composer has the final say on
  // double booking; anything that did not reach the card goes back in the pool
  // for the next show rather than staying a phantom claim on this one.
  releaseUncommittedBeats(world, plannedBeats);
  world.shows.push(show);
  for (const wrestlerId of new Set(slots.flatMap((booked) => booked.participantWrestlerIds))) {
    if (isAwayFromTelevision(world, wrestlerId)) {
      addEvent(world, ctx, {
        type: "injury", summary: `${world.wrestlers.find((wrestler) => wrestler.id === wrestlerId)?.name ?? wrestlerId} has recovered and returns to the card.`,
        wrestlerIds: [wrestlerId], showId: show.id, data: { absence: "return" },
      });
    }
  }
  const segmentCount = slots.filter((booked) => booked.kind === "segment").length;
  addEvent(world, ctx, {
    type: "show_booked", summary: `The GM booked ${slots.length - segmentCount} matches and ${segmentCount} segments for the next ${kind.toUpperCase()} show.`,
    wrestlerIds: slots.flatMap((booked) => booked.participantWrestlerIds), showId: show.id, data: { kind },
  });
  return show;
}

export function bookUpcomingShowIfDue(world: WorldState, ctx: TickContext): void {
  const nextTick = ctx.tick + 1;
  if (!isShowTick(nextTick, world.config) || isBookedForTick(world, nextTick)) return;
  bookShow(world, ctx, nextTick);
}
