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
  return world.wrestlers.filter((wrestler) => wrestler.condition >= BOOKABLE_CONDITION_THRESHOLD);
}

function storyForPair(world: WorldState, a: string, b: string): string | undefined {
  return world.stories.find((story) =>
    story.phase !== "resolved" && story.participantWrestlerIds.length === 2 &&
    story.participantWrestlerIds.includes(a) && story.participantWrestlerIds.includes(b),
  )?.id;
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
  return bookableWrestlers(world)
    .filter((wrestler) => wrestler.id !== holder && !used.has(wrestler.id))
    .map((wrestler) => ({ wrestler, storyPriority: storyParticipants.includes(wrestler.id) ? 1 : 0, score: bookingScore(world, wrestler, currentTick) }))
    .sort((a, b) => b.storyPriority - a.storyPriority || b.score - a.score)[0]?.wrestler;
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

  // A PLE first reserves a genuine blowoff for every peaking two-person story.
  if (kind === "ple") {
    for (const story of world.stories.filter((candidate) => candidate.phase === "peaking" && candidate.participantWrestlerIds.length === 2)) {
      const [a, b] = story.participantWrestlerIds;
      if (!a || !b || used.has(a) || used.has(b) || !eligible.has(a) || !eligible.has(b)) continue;
      used.add(a); used.add(b);
      const title = world.titles.find((candidate) => candidate.holderId !== undefined && [a, b].includes(candidate.holderId));
      slots.push(slot(ctx, [a, b], world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
    }
  }

  // PLE title defences are mandatory. A story participant is preferred as challenger.
  if (kind === "ple") {
    for (const title of world.titles) {
      if (!title.holderId || !eligible.has(title.holderId)) continue;
      const holderId = title.holderId;
      const existing = slots.find((candidate) => candidate.participantWrestlerIds.includes(holderId));
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

  const stories = world.stories.filter((story) => story.phase === "building" && story.participantWrestlerIds.length === 2)
    .sort((a, b) => b.audienceInterest - a.audienceInterest);
  for (const story of stories) {
    if (slots.length >= targetSlotCount) break;
    const [a, b] = story.participantWrestlerIds;
    if (!a || !b || used.has(a) || used.has(b) || !eligible.has(a) || !eligible.has(b)) continue;
    used.add(a); used.add(b);
    // TV title bouts are exceptional and only happen when the story itself justifies one.
    const title = kind === "tv" && ctx.rng.fork(`tv-title:${story.id}`).chance(0.12)
      ? world.titles.find((candidate) => candidate.holderId === a || candidate.holderId === b) : undefined;
    slots.push(slot(ctx, [a, b], world.gmObjective, { storyId: story.id, ...(title ? { titleId: title.id } : {}) }));
  }

  const remaining = bookableWrestlers(world)
    .filter((wrestler) => !used.has(wrestler.id))
    .filter((wrestler) => !(world.gmObjective === "cool_down_overexposed_act" && findPopularity(world, wrestler.id).fatigue > 75))
    .sort((a, b) => bookingScore(world, b, ctx.tick) - bookingScore(world, a, ctx.tick));
  for (let index = 0; slots.length < targetSlotCount && index + 1 < remaining.length; index += 2) {
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
