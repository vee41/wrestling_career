import type { InteractionIntent, WorldState } from "@wrestling/contracts";

/**
 * Spec §4.2 / GDD §11 — "repeating the same ask or pitch within a short
 * window reduces receptiveness and trust." Derived from the event log
 * rather than stored state: every resolved interaction is logged with the
 * proposer id and intent in `data`, so patience is just a windowed scan.
 */
export const PATIENCE_WINDOW_TICKS = 6;

export function countRecentInteractions(
  world: WorldState,
  wrestlerId: string,
  intent: InteractionIntent,
  currentTick: number,
  windowTicks: number = PATIENCE_WINDOW_TICKS,
): number {
  return world.events.filter(
    (e) =>
      e.type === "interaction_resolved" &&
      e.tick > currentTick - windowTicks &&
      e.tick <= currentTick &&
      e.wrestlerIds[0] === wrestlerId &&
      e.data["intent"] === intent,
  ).length;
}

/** Receptiveness multiplier in (0, 1] — repeated identical asks erode it. */
export function patienceMultiplier(repeatCount: number): number {
  if (repeatCount <= 0) return 1;
  return 1 / (1 + repeatCount * 0.6);
}

/**
 * PLAN Phase 3 tuning gap #3: `gmReactionDelta`/`backstageReactionDelta` are
 * computed per match (match.ts) but were previously never read again —
 * refusing a booking request or going off-script had no lasting GM-side
 * cost, and being a good soldier backstage never paid off. This windows the
 * same signal patience.ts already windows interactions over, joined through
 * each match's show to recover its tick.
 */
export function recentPerformanceReaction(
  world: WorldState,
  wrestlerId: string,
  currentTick: number,
  windowTicks: number = PATIENCE_WINDOW_TICKS,
): { gmReaction: number; backstageReaction: number } {
  const showTickById = new Map(world.shows.map((s) => [s.id, s.tick]));
  let gmReaction = 0;
  let backstageReaction = 0;
  for (const result of world.matchResults) {
    const tick = showTickById.get(result.showId);
    if (tick === undefined || tick <= currentTick - windowTicks || tick > currentTick) continue;
    const perf = result.performances.find((p) => p.wrestlerId === wrestlerId);
    if (!perf) continue;
    gmReaction += perf.gmReactionDelta;
    backstageReaction += perf.backstageReactionDelta;
  }
  return { gmReaction, backstageReaction };
}
