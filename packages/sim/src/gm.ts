import type { CardSlot, GmObjective, MatchSlot, SegmentSlot, Show, Title, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isBookedForTick, isShowTick, showKindForTick, weekForTick, weeksSinceLastAppearance } from "./booking.js";
import { recentPerformanceReaction } from "./patience.js";

const ALL_OBJECTIVES: GmObjective[] = [
  "new_main_eventer", "strengthen_tag_division", "rebuild_championship", "capitalise_on_rising_star",
  "cool_down_overexposed_act", "prepare_major_event",
];
const OBJECTIVE_ROTATION_TICKS = 6;
export const BOOKABLE_CONDITION_THRESHOLD = 40;

export function rotateGmObjectiveIfDue(world: WorldState, ctx: TickContext): void {
  if (ctx.tick - world.gmObjectiveSince < OBJECTIVE_ROTATION_TICKS) return;
  const rng = ctx.rng.fork("gm-objective-rotation");
  const next = rng.pick(ALL_OBJECTIVES.filter((o) => o !== world.gmObjective));
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
  switch (world.gmObjective) {
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
  // A champion working hurt is a familiar short-term story risk; without
  // this narrow exception one injury can erase an entire title line for the
  // rest of the six-month validation slice. Other wrestlers still observe
  // the normal absence threshold.
  return world.wrestlers.filter((wrestler) => wrestler.condition >= BOOKABLE_CONDITION_THRESHOLD || isChampion(world, wrestler.id));
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
  return ranked.map((booked, index) => {
    const position = index === 0 ? "main_event" : index === 1 ? "upper" : index === ranked.length - 1 ? "opener" : "mid";
    return { ...booked, position };
  });
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

  const storySlotBudget = kind === "tv" ? Math.min(2, targetSlotCount) : targetSlotCount;
  const stories = world.stories.filter((story) => story.phase === "building" && story.participantWrestlerIds.length >= 2)
    .sort((a, b) => b.audienceInterest - a.audienceInterest);
  for (const story of stories) {
    if (slots.length >= storySlotBudget) break;
    const participants = story.participantWrestlerIds;
    if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
    for (const wrestlerId of participants) used.add(wrestlerId);
    // TV title bouts are exceptional and only happen when the story itself justifies one.
    const title = kind === "tv" && ctx.rng.fork(`tv-title:${story.id}`).chance(0.08)
      ? world.titles.find((candidate) => candidate.tier === "midcard" && candidate.holderId !== undefined && participants.includes(candidate.holderId) && participantsTitleEligible(world, participants, candidate.tier)) : undefined;
    const useSegment = kind === "tv" && ctx.rng.fork(`story-segment:${targetTick}:${story.id}`).chance(world.config.booking.segmentChance);
    slots.push(useSegment
      ? segmentSlot(ctx, participants, world.gmObjective, { storyId: story.id })
      : slot(ctx, participants, world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
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
    .filter((wrestler) => !(world.gmObjective === "cool_down_overexposed_act" && findPopularity(world, wrestler.id).fatigue > 75))
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
    slots.push(slot(ctx, participants, world.gmObjective));
    index = participantCount;
  }
  for (; slots.length < targetSlotCount && index + 1 < remaining.length; index += 2) {
    const a = remaining[index]; const b = remaining[index + 1];
    if (!a || !b) break;
    slots.push(slot(ctx, [a.id, b.id], world.gmObjective));
  }

  const show: Show = { id: ctx.ids.next("show"), tick: targetTick, kind, card: assignPositions(world, slots) };
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
