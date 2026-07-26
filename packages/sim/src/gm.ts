import type { GmObjective, MatchSlot, Show, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity } from "./lookups.js";
import { isBookedForTick, isShowTick } from "./booking.js";
import { recentPerformanceReaction } from "./patience.js";

// GDD §11: "possible GM objectives" — rotated by the sim every few weeks.
const ALL_OBJECTIVES: GmObjective[] = [
  "new_main_eventer",
  "strengthen_tag_division",
  "rebuild_championship",
  "capitalise_on_rising_star",
  "cool_down_overexposed_act",
  "prepare_major_event",
];

// "Rotating every few weeks" (GDD §11) isn't pinned to a number; two weeks
// (6 ticks at the default 2 decision + 1 show tick) is this phase's pick.
const OBJECTIVE_ROTATION_TICKS = 6;

export function rotateGmObjectiveIfDue(world: WorldState, ctx: TickContext): void {
  if (ctx.tick - world.gmObjectiveSince < OBJECTIVE_ROTATION_TICKS) return;
  const rng = ctx.rng.fork("gm-objective-rotation");
  const choices = ALL_OBJECTIVES.filter((o) => o !== world.gmObjective);
  const next = rng.pick(choices);
  addEvent(world, ctx, {
    type: "gm_decision",
    summary: `The GM's creative focus shifted from ${world.gmObjective.replace(/_/g, " ")} to ${next.replace(/_/g, " ")}.`,
    wrestlerIds: [],
    data: { previousObjective: world.gmObjective, objective: next },
  });
  world.gmObjective = next;
  world.gmObjectiveSince = ctx.tick;
}

function objectiveFit(world: WorldState, wrestler: Wrestler): number {
  const popularity = findPopularity(world, wrestler.id);
  switch (world.gmObjective) {
    case "new_main_eventer":
      return popularity.momentum > 0 && popularity.generalPopularity < 70 ? popularity.momentum * 0.5 : 0;
    case "rebuild_championship":
      return world.championId === wrestler.id || popularity.generalPopularity > 50 ? 10 : 0;
    case "capitalise_on_rising_star":
      return popularity.momentum > 10 ? popularity.momentum : 0;
    case "cool_down_overexposed_act":
      return popularity.fatigue > 60 ? -10 : 0;
    case "prepare_major_event":
      return popularity.generalPopularity * 0.3;
    case "strengthen_tag_division":
    default:
      return 0;
  }
}

function bookingScore(world: WorldState, wrestler: Wrestler, currentTick: number): number {
  const popularity = findPopularity(world, wrestler.id);
  // Tuning gap #3: being a good soldier (positive gmReaction/backstageReaction
  // from recent matches) now materially improves booking odds, and going
  // off-script/refusing GM asks materially hurts them.
  const { gmReaction, backstageReaction } = recentPerformanceReaction(world, wrestler.id, currentTick);
  return (
    popularity.generalPopularity +
    popularity.momentum * 0.5 +
    objectiveFit(world, wrestler) +
    (gmReaction + backstageReaction) * 0.15
  );
}

const TARGET_SLOT_MIN = 4;
const TARGET_SLOT_MAX = 6;

/**
 * Books a show's card (GDD §4 step 3 / §11): active stories get first
 * priority, remaining slots are filled by popularity/momentum plus GM
 * objective fit. Called one tick ahead of `targetTick` airing (see
 * booking.ts) so players have a decision period to set match intent.
 */
export function bookShow(world: WorldState, ctx: TickContext, targetTick: number): Show {
  const rng = ctx.rng.fork(`booking:${targetTick}`);
  const targetSlotCount = rng.int(TARGET_SLOT_MIN, TARGET_SLOT_MAX);
  const used = new Set<string>();
  const slots: MatchSlot[] = [];

  const storyCandidates = world.stories
    .filter(
      (s) =>
        (s.phase === "building" || s.phase === "peaking") &&
        s.participantWrestlerIds.length === 2 &&
        s.participantWrestlerIds.every((id) => world.wrestlers.some((w) => w.id === id)),
    )
    .slice()
    .sort((a, b) => b.audienceInterest - a.audienceInterest);

  for (const story of storyCandidates) {
    if (slots.length >= targetSlotCount) break;
    const [a, b] = story.participantWrestlerIds as [string, string];
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    slots.push({
      id: ctx.ids.next("slot"),
      participantWrestlerIds: [a, b],
      storyId: story.id,
      gmIntent: world.gmObjective,
      intents: {},
    });
  }

  const remaining = world.wrestlers
    .filter((w) => !used.has(w.id))
    .map((w) => ({ wrestler: w, score: bookingScore(world, w, ctx.tick) }))
    .sort((a, b) => b.score - a.score);

  let i = 0;
  while (slots.length < targetSlotCount && i + 1 < remaining.length) {
    const a = remaining[i];
    const b = remaining[i + 1];
    if (!a || !b) break;
    slots.push({
      id: ctx.ids.next("slot"),
      participantWrestlerIds: [a.wrestler.id, b.wrestler.id],
      gmIntent: world.gmObjective,
      intents: {},
    });
    used.add(a.wrestler.id);
    used.add(b.wrestler.id);
    i += 2;
  }

  const show: Show = { id: ctx.ids.next("show"), tick: targetTick, card: slots };
  world.shows.push(show);
  addEvent(world, ctx, {
    type: "show_booked",
    summary: `The GM booked ${slots.length} matches for the next show.`,
    wrestlerIds: slots.flatMap((s) => s.participantWrestlerIds),
    showId: show.id,
  });
  return show;
}

/** Books the next show's card exactly one tick ahead of it airing, if due and not already booked. */
export function bookUpcomingShowIfDue(world: WorldState, ctx: TickContext): void {
  const nextTick = ctx.tick + 1;
  if (!isShowTick(nextTick)) return;
  if (isBookedForTick(world, nextTick)) return;
  bookShow(world, ctx, nextTick);
}
