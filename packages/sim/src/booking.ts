import type { MatchSlot, Show, WorldState } from "@wrestling/contracts";

/** Default week: 2 decision ticks + 1 show tick (GDD §4) — configurable, not spec-normative. */
export const DECISION_TICKS_PER_WEEK = 2;
export const WEEK_LENGTH_TICKS = DECISION_TICKS_PER_WEEK + 1;

/** Tick 2, 5, 8, ... (0-indexed) are show ticks — the last tick of each week. */
export function isShowTick(tick: number): boolean {
  return tick % WEEK_LENGTH_TICKS === WEEK_LENGTH_TICKS - 1;
}

/**
 * The card is booked one tick ahead of airing (see show.ts's `intents`
 * comment) so players get a decision period to set match intent before it
 * resolves. This finds the show tick a booking made *now* would air on.
 */
export function nextShowTick(currentTick: number): number {
  let t = currentTick;
  while (!isShowTick(t)) t++;
  return t;
}

export interface SlotRef {
  show: Show;
  slot: MatchSlot;
}

/** Booked-but-not-yet-resolved slots (this or a future show tick) featuring `wrestlerId`. */
export function upcomingSlotsFor(
  world: WorldState,
  wrestlerId: string,
  currentTick: number,
): SlotRef[] {
  const refs: SlotRef[] = [];
  for (const show of world.shows) {
    if (show.tick < currentTick) continue;
    for (const slot of show.card) {
      if (slot.participantWrestlerIds.includes(wrestlerId)) refs.push({ show, slot });
    }
  }
  return refs;
}

export function isBookedForTick(world: WorldState, tick: number): boolean {
  return world.shows.some((s) => s.tick === tick);
}
