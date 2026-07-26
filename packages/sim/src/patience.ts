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
