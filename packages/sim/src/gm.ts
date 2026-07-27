import type { GmObjective, MatchSlot, Show, Title, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isBookedForTick, isShowTick, showKindForTick } from "./booking.js";
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
function recentlyAppeared(world: WorldState, wrestlerId: string, targetTick: number): boolean {
  const previousShow = world.shows
    .filter((show) => show.tick < targetTick)
    .sort((a, b) => b.tick - a.tick)[0];
  return previousShow !== undefined && world.matchResults.some((result) =>
    result.showId === previousShow.id && result.participantWrestlerIds.includes(wrestlerId),
  );
}

function slot(ctx: TickContext, participants: string[], gmIntent: GmObjective, extras: Partial<MatchSlot> = {}): MatchSlot {
  return { id: ctx.ids.next("slot"), participantWrestlerIds: participants, position: "mid", gmIntent, intents: {}, ...extras };
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
    .filter((wrestler) => wrestler.id !== holder && !used.has(wrestler.id))
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

function assignPositions(world: WorldState, slots: MatchSlot[], currentTick: number, kind: Show["kind"]): MatchSlot[] {
  const ranked = slots.slice().sort((a, b) => {
    const titleWeight = (slot: MatchSlot) => {
      const title = slot.titleId ? world.titles.find((candidate) => candidate.id === slot.titleId) : undefined;
      return title?.tier === "world" ? 2 : title?.tier === "midcard" ? 1 : 0;
    };
    const score = (slot: MatchSlot) => slot.participantWrestlerIds.reduce(
      (sum, id) => sum + bookingScore(world, world.wrestlers.find((w) => w.id === id) as Wrestler, currentTick), 0,
    );
    return titleWeight(b) - titleWeight(a) || score(b) - score(a);
  });
  return ranked.map((booked, index) => {
    const title = booked.titleId ? world.titles.find((candidate) => candidate.id === booked.titleId) : undefined;
    const position = title?.tier === "world" && kind === "ple" ? "main_event"
      : title?.tier === "midcard" && kind === "ple" ? "upper"
      : index === 0 ? "main_event" : index === 1 ? "upper" : index === ranked.length - 1 ? "opener" : "mid";
    return { ...booked, position };
  });
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
  const slots: MatchSlot[] = [];

  // A PLE first reserves a genuine blowoff for every peaking story.
  if (kind === "ple") {
    for (const story of world.stories.filter((candidate) => candidate.phase === "peaking" && candidate.participantWrestlerIds.length >= 2)) {
      const participants = story.participantWrestlerIds;
      if (participants.some((id) => used.has(id) || !eligible.has(id))) continue;
      const title = world.titles.find((candidate) => candidate.holderId !== undefined && participants.includes(candidate.holderId));
      // Repeating a title-feud blowoff would lock the same challenger into
      // every PLE main event. Let the mandatory title-contender pass below
      // rotate a fresh opponent while this story waits for TV fallout.
      const pairAlreadyMetForTitle = title !== undefined && world.matchResults.some((result) => {
        const priorShow = world.shows.find((show) => show.id === result.showId);
        const priorSlot = priorShow?.card.find((slot) => slot.id === result.matchSlotId);
        return priorSlot?.titleId === title.id && participants.every((id) => result.participantWrestlerIds.includes(id));
      });
      if (pairAlreadyMetForTitle) continue;
      for (const wrestlerId of participants) used.add(wrestlerId);
      slots.push(slot(ctx, participants, world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
    }
  }

  // PLE title defences are mandatory. A story participant is preferred as challenger.
  if (kind === "ple") {
    for (const title of world.titles) {
      if (!title.holderId || !eligible.has(title.holderId)) continue;
      const holderId = title.holderId;
      // A peaking title story may already have claimed this belt's PLE
      // defense. Do not turn that one match into a second title defense.
      if (slots.some((candidate) => candidate.titleId === title.id)) continue;
      const existing = slots.find((candidate) => candidate.participantWrestlerIds.includes(holderId) && candidate.titleId === undefined);
      if (existing) { existing.titleId = title.id; continue; }
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
      ? world.titles.find((candidate) => candidate.tier === "midcard" && candidate.holderId !== undefined && participants.includes(candidate.holderId)) : undefined;
    slots.push(slot(ctx, participants, world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
  }

  const previousAppearances = new Map<string, number>();
  for (const result of world.matchResults) {
    for (const wrestlerId of result.participantWrestlerIds) {
      previousAppearances.set(wrestlerId, (previousAppearances.get(wrestlerId) ?? 0) + 1);
    }
  }
  const remaining = bookableWrestlers(world)
    .filter((wrestler) => !used.has(wrestler.id))
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
        // This applies only to the open rotation pool. Story and title slots
        // above remain earned appearances, so an active main event program
        // still works every week while unattached stars are deliberately paced.
        const restPenalty = popularity.generalPopularity >= world.config.booking.restTierPopularityThreshold && recentlyAppeared(world, wrestler.id, targetTick)
          ? world.config.booking.restPenalty
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

  const show: Show = { id: ctx.ids.next("show"), tick: targetTick, kind, card: assignPositions(world, slots, ctx.tick, kind) };
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
  addEvent(world, ctx, {
    type: "show_booked", summary: `The GM booked ${slots.length} matches for the next ${kind.toUpperCase()} show.`,
    wrestlerIds: slots.flatMap((booked) => booked.participantWrestlerIds), showId: show.id, data: { kind },
  });
  return show;
}

export function bookUpcomingShowIfDue(world: WorldState, ctx: TickContext): void {
  const nextTick = ctx.tick + 1;
  if (!isShowTick(nextTick, world.config) || isBookedForTick(world, nextTick)) return;
  bookShow(world, ctx, nextTick);
}
