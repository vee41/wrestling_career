import type { BookingCandidateTrace, BookingTrace, CardSlot, GmObjective, MatchSlot, PlannedBeat, ProgramPlan, SegmentSlot, Show, Title, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isBookedForTick, isShowTick, showKindForTick, weekForTick, weeksSinceLastAppearance } from "./booking.js";
import { recentPerformanceReaction } from "./patience.js";
import { selectPlannedBeatsForShow } from "./program-plans.js";

// The MVP has no tag division. Keep its legacy token in contracts for old
// snapshots, but never select an objective the scenario cannot execute.
export const SUPPORTED_GM_OBJECTIVES: GmObjective[] = [
  "new_main_eventer", "rebuild_championship", "capitalise_on_rising_star",
  "cool_down_overexposed_act", "prepare_major_event",
];
const LEGACY_BOOKING_OBJECTIVE_ROTATION_TICKS = 6;
export const BOOKABLE_CONDITION_THRESHOLD = 40;

/**
 * Compatibility-only filler guidance. It preserves the pre-plan card
 * composer through Phase 3.11; ProgramPlan is the durable creative source.
 */
export function rotateBookingObjectiveIfDue(world: WorldState, ctx: TickContext): void {
  if (ctx.tick - world.bookingObjectiveSince < LEGACY_BOOKING_OBJECTIVE_ROTATION_TICKS) return;
  const rng = ctx.rng.fork("gm-objective-rotation");
  const allObjectives: GmObjective[] = [
    "new_main_eventer", "strengthen_tag_division", "rebuild_championship", "capitalise_on_rising_star",
    "cool_down_overexposed_act", "prepare_major_event",
  ];
  const next = rng.pick(allObjectives.filter((objective) => objective !== world.bookingObjective));
  addEvent(world, ctx, {
    type: "gm_decision",
    summary: `The GM's operational booking focus shifted from ${world.bookingObjective.replace(/_/g, " ")} to ${next.replace(/_/g, " ")}.`,
    wrestlerIds: [], data: { previousObjective: world.bookingObjective, objective: next, scope: "legacy_booking" },
  });
  world.bookingObjective = next;
  world.bookingObjectiveSince = ctx.tick;
}

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

function objectiveFit(world: WorldState, wrestler: Wrestler): number {
  const popularity = findPopularity(world, wrestler.id);
  switch (world.bookingObjective) {
    case "new_main_eventer": return popularity.momentum > 0 && popularity.generalPopularity < 70 ? popularity.momentum * 0.5 : 0;
    case "rebuild_championship": return isChampion(world, wrestler.id) || popularity.generalPopularity > 50 ? 10 : 0;
    case "capitalise_on_rising_star": return popularity.momentum > 10 ? popularity.momentum : 0;
    // This is deliberately a real booking penalty, not merely a slower rise:
    // an overexposed act is pushed down the card and may be rested entirely.
    case "cool_down_overexposed_act": return popularity.fatigue > 60 ? -35 : 0;
    case "prepare_major_event": return popularity.generalPopularity * 0.3;
    case "strengthen_tag_division": default: return 0;
  }
}

export function bookingScore(world: WorldState, wrestler: Wrestler, currentTick: number): number {
  const popularity = findPopularity(world, wrestler.id);
  const { gmReaction, backstageReaction } = recentPerformanceReaction(world, wrestler.id, currentTick);
  return popularity.generalPopularity + popularity.momentum * 0.5 + objectiveFit(world, wrestler) + (gmReaction + backstageReaction) * 0.15;
}

function bookableWrestlers(world: WorldState): Wrestler[] {
  // Condition is a hard card-composer constraint. A title program must be
  // revised around an unavailable holder, never waive medical availability.
  return world.wrestlers.filter((wrestler) => wrestler.condition >= BOOKABLE_CONDITION_THRESHOLD);
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
  const protagonist = plan.participants.find((participant) => participant.role === "protagonist")?.wrestlerId ?? participants[0]!;
  const wantsChange = plan.creativeObjective === "change_championship" || plan.creativeObjective === "establish_challenger" || plan.creativeObjective === "elevate_act";
  const intendedWinnerWrestlerId = titleHolder !== undefined && !wantsChange ? titleHolder : protagonist;
  const winner = participants.includes(intendedWinnerWrestlerId) ? intendedWinnerWrestlerId : participants[0]!;
  const winnerRole = plan.participants.find((participant) => participant.wrestlerId === winner)?.role;
  return {
    intendedWinnerWrestlerId: winner,
    finishFamily: titleHolder !== undefined && winnerRole === "antagonist" ? "dirty" : "clean",
    protectedWrestlerIds: [...plan.protectedWrestlerIds],
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

function assignPositions(world: WorldState, slots: CardSlot[]): CardSlot[] {
  const ranked = slots.slice().sort((a, b) => programHeat(world, b) - programHeat(world, a));
  // The previous descending-heat implementation made the coldest slot the
  // opener. Give the first two strongest justified attractions the opener
  // and main event respectively, leaving room for a supporting upper slot.
  const main = ranked[0];
  const opener = ranked[1] ?? main;
  return ranked.map((booked, index) => ({
    ...booked,
    position: booked.id === main?.id ? "main_event" : booked.id === opener?.id ? "opener" : index === 2 ? "upper" : "mid",
  }));
}

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
    promotionObjectiveFit: objective,
    freshness: slot.participantWrestlerIds.reduce((sum, id) => sum + (weeksSinceLastAppearance(world, id, targetTick) ?? 1), 0),
    cardShapeContribution: slot.kind === "segment" ? 2 : 1,
    overexposure: -overexposure,
    conditionRisk: -conditionRisk,
  };
}

function placementReason(slot: CardSlot): string {
  if (slot.plannedBeatId !== undefined) return "reserved program beat";
  if (slot.titleId !== undefined) return "title obligation";
  if (slot.storyId !== undefined) return "supporting story progression";
  return "roster rotation showcase";
}

/** Build the durable, private audit record after hard-valid candidates are committed. */
function compositionTrace(world: WorldState, composedAtTick: number, targetTick: number, card: readonly CardSlot[]): BookingTrace {
  const selectedBeatIds = new Set(card.flatMap((slot) => slot.plannedBeatId === undefined ? [] : [slot.plannedBeatId]));
  const candidates: BookingCandidateTrace[] = card.map((slot) => {
    const components = scoreComponents(world, slot, targetTick);
    return {
      id: `candidate:${slot.id}`, kind: slot.kind ?? "match", participantWrestlerIds: [...slot.participantWrestlerIds],
      ...(slot.programId === undefined ? {} : { programId: slot.programId }),
      ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }),
      ...(slot.kind === "match" && slot.titleId !== undefined ? { titleId: slot.titleId } : {}),
      disposition: "selected", hardInvalidReasons: [], scoreComponents: components,
      totalScore: Object.values(components).reduce((sum, value) => sum + value, 0), slotId: slot.id,
      placementReason: `${placementReason(slot)}; ${slot.position.replace(/_/g, " ")}`,
    };
  });
  const isPle = showKindForTick(targetTick, world.config) === "ple";
  for (const beat of world.plannedBeats) {
    if ((beat.status !== "provisional" && beat.status !== "scheduled" && beat.status !== "invalidated") || selectedBeatIds.has(beat.id)) continue;
    const missingPrerequisite = beat.preconditions.requiredResolvedBeatIds.some((id) => world.plannedBeats.find((candidate) => candidate.id === id)?.status !== "resolved");
    const unavailable = beat.requiredParticipantWrestlerIds.some((id) => (world.wrestlers.find((wrestler) => wrestler.id === id)?.condition ?? 0) < BOOKABLE_CONDITION_THRESHOLD);
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
      ? { kind: "segment", id: `trace-${beat.id}`, participantWrestlerIds: beat.requiredParticipantWrestlerIds, position: "mid", gmIntent: world.bookingObjective, programId: beat.programId, ...(storyId === undefined ? {} : { storyId }), intents: {} }
      : { kind: "match", id: `trace-${beat.id}`, participantWrestlerIds: beat.requiredParticipantWrestlerIds, position: "mid", gmIntent: world.bookingObjective, programId: beat.programId, ...(storyId === undefined ? {} : { storyId }), intents: {} };
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
    // This beat was not actually committed; make it eligible for the next
    // composition attempt instead of leaving a phantom scheduled beat.
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
    addEvent(world, ctx, {
      type: "injury",
      summary: `${wrestler.name} is not cleared to compete and will miss the upcoming show.`,
      wrestlerIds: [wrestler.id], data: { absence: "missed_show", condition: wrestler.condition },
    });
  }
  const used = new Set<string>();
  const slots: CardSlot[] = [];
  // Planned beats claim their own match/segment primitive. The old random
  // segment chance remains only for unplanned filler below.
  const plannedBeats = selectPlannedBeatsForShow(world, ctx, targetTick, targetSlotCount);
  for (const plannedBeat of plannedBeats) {
    const plan = world.programPlans.find((candidate) => candidate.id === plannedBeat.programId)!;
    const participants = [...plannedBeat.requiredParticipantWrestlerIds, ...plannedBeat.optionalParticipantWrestlerIds]
      .filter((id, index, all) => all.indexOf(id) === index);
    if (participants.some((id) => used.has(id))) {
      // `selectPlannedBeatsForShow` is intentionally program-local; the
      // composer is the final no-double-booking authority.
      plannedBeat.status = "provisional";
      continue;
    }
    participants.forEach((id) => used.add(id));
    const shared = { storyId: plan.storyId, programId: plan.id, plannedBeatId: plannedBeat.id };
    const titleId = plannedBeat.type === "ple_payoff" ? plan.stakesTitleId : undefined;
    slots.push(plannedBeat.compatibleSlotKind === "match"
      ? slot(ctx, participants, world.bookingObjective, { ...shared, ...(titleId === undefined ? {} : { titleId }), plannedFinish: finishForPlannedBeat(world, plan, plannedBeat, participants, titleId) })
      : segmentSlot(ctx, participants, world.bookingObjective, { ...shared, ...(plannedBeat.plannedSegmentOutcome === undefined ? {} : { plannedOutcome: plannedBeat.plannedSegmentOutcome }) }));
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

  // A PLE first reserves a genuine blowoff for every peaking story.
  if (kind === "ple") {
    for (const story of world.stories.filter((candidate) => candidate.phase === "peaking" && candidate.participantWrestlerIds.length >= 2)) {
      const participants = story.participantWrestlerIds;
      if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
      const linkedPlan = world.programPlans.find((plan) => plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready"));
      if (directMatchOnCooldown(world, participants, targetTick, linkedPlan?.id)) continue;
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
      const potentialSlot = slot(ctx, participants, world.bookingObjective, {
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
      slots.push(slot(ctx, [holderId, contender.id], world.bookingObjective, {
        titleId: title.id, ...(storyId ? { storyId } : {}),
      }));
    }
  }

  const storySlotBudget = kind === "tv" ? Math.min(2, targetSlotCount) : targetSlotCount;
  const stories = world.stories.filter((story) => story.phase === "building" && story.participantWrestlerIds.length >= 2)
    .sort((a, b) => b.audienceInterest - a.audienceInterest);
  for (const story of stories) {
    if (slots.length >= storySlotBudget) break;
    const participants = story.participantWrestlerIds;
    if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
    const linkedPlan = world.programPlans.find((plan) => plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready"));
    if (directMatchOnCooldown(world, participants, targetTick, linkedPlan?.id)) continue;
    for (const wrestlerId of participants) used.add(wrestlerId);
    // TV title bouts are exceptional and only happen when the story itself justifies one.
    const title = kind === "tv" && ctx.rng.fork(`tv-title:${story.id}`).chance(0.08)
      ? world.titles.find((candidate) => candidate.tier === "midcard" && candidate.holderId !== undefined && participants.includes(candidate.holderId) && participantsTitleEligible(world, participants, candidate.tier)) : undefined;
    const useSegment = kind === "tv" && ctx.rng.fork(`story-segment:${targetTick}:${story.id}`).chance(world.config.booking.segmentChance);
    slots.push(useSegment
      ? segmentSlot(ctx, participants, world.bookingObjective, { storyId: story.id })
      : slot(ctx, participants, world.bookingObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
  }

  const previousAppearances = new Map<string, number>();
  for (const result of world.matchResults) {
    for (const wrestlerId of result.participantWrestlerIds) {
      previousAppearances.set(wrestlerId, (previousAppearances.get(wrestlerId) ?? 0) + 1);
    }
  }
  const remaining = bookableWrestlers(world)
    .filter((wrestler) => !used.has(wrestler.id))
    // Legends and part-timers only appear through the meaningful story/title
    // passes above; ordinary rotation never spends a rare appearance.
    .filter((wrestler) => !world.config.roles[wrestler.role].storyGated)
    .filter((wrestler) => !(world.bookingObjective === "cool_down_overexposed_act" && findPopularity(world, wrestler.id).fatigue > 75))
    // Existing stories and title scenes still lead the card, but open slots
    // deliberately rotate the rest of the roster through it.
    .sort((a, b) => {
      const rotationScore = (wrestler: Wrestler) => {
        const appearances = previousAppearances.get(wrestler.id) ?? 0;
        const missedShow = world.events.some((event) =>
          event.type === "injury" && event.wrestlerIds.includes(wrestler.id) && event.data["absence"] === "missed_show",
        );
        const returned = world.events.some((event) =>
          event.type === "injury" && event.wrestlerIds.includes(wrestler.id) && event.data["absence"] === "return",
        );
        // The first recovered booking is the visible return beat, so it gets
        // priority over ordinary rotation once the wrestler is cleared.
        const returnBonus = missedShow && !returned ? 500 : 0;
        const popularity = findPopularity(world, wrestler.id);
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
      return rotationScore(b) - rotationScore(a);
    });
  let index = 0;
  // One TV undercard match may become a triple threat or fatal four-way. It
  // draws strictly from `remaining`, never consuming a story or title slot.
  const canBookMultiWay = kind === "tv" && slots.length < targetSlotCount && remaining.length >= 3;
  if (canBookMultiWay && ctx.rng.fork(`multi-way:${targetTick}`).chance(world.config.booking.multiWayChance)) {
    const participantCount = Math.min(world.config.booking.maxMultiWayParticipants, remaining.length);
    const participants = remaining.slice(0, participantCount).map((wrestler) => wrestler.id);
    slots.push(slot(ctx, participants, world.bookingObjective));
    index = participantCount;
  }
  for (; slots.length < targetSlotCount && index + 1 < remaining.length; index += 2) {
    const a = remaining[index]; const b = remaining[index + 1];
    if (!a || !b) break;
    if (directMatchOnCooldown(world, [a.id, b.id], targetTick)) continue;
    slots.push(slot(ctx, [a.id, b.id], world.bookingObjective));
  }

  const committedSlots = slots.map((booked) => {
    if (booked.kind === "segment" || booked.plannedFinish !== undefined || (booked.storyId === undefined && booked.titleId === undefined)) return booked;
    return { ...booked, plannedFinish: finishForBookedStoryOrTitle(world, booked) };
  });
  const positionedCard = assignPositions(world, committedSlots);
  const show: Show = {
    id: ctx.ids.next("show"), tick: targetTick, kind, card: positionedCard,
    bookingTrace: compositionTrace(world, ctx.tick, targetTick, positionedCard),
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
  world.shows.push(show);
  for (const wrestlerId of slots.flatMap((booked) => booked.participantWrestlerIds)) {
    const hasUnreturnedAbsence = world.events.some((event) =>
      event.type === "injury" && event.wrestlerIds.includes(wrestlerId) && event.data["absence"] === "missed_show",
    );
    const hasReturned = world.events.some((event) =>
      event.type === "injury" && event.wrestlerIds.includes(wrestlerId) && event.data["absence"] === "return",
    );
    if (hasUnreturnedAbsence && !hasReturned) {
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
