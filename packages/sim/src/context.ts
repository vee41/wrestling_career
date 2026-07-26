import type { WorldEvent, WorldEventType, WorldState } from "@wrestling/contracts";
import type { IdFactory } from "./ids.js";
import type { Rng } from "./rng.js";

/**
 * Shared state threaded through every tick stage. `tick` is the tick number
 * being resolved (stamped on all events this tick produces); the draft
 * WorldState's own `tick` counter is bumped to tick+1 only at the very end.
 */
export interface TickContext {
  tick: number;
  rng: Rng;
  ids: IdFactory;
  /** Events produced during this tick only — the subset returned by runTick. */
  events: WorldEvent[];
}

export interface NewEvent {
  type: WorldEventType;
  summary: string;
  wrestlerIds: string[];
  storyId?: string;
  matchId?: string;
  showId?: string;
  data?: Record<string, unknown>;
}

/** Append a world event to both the persistent log (`world.events`) and this tick's return batch. */
export function addEvent(world: WorldState, ctx: TickContext, event: NewEvent): WorldEvent {
  const full: WorldEvent = {
    id: ctx.ids.next("event"),
    tick: ctx.tick,
    type: event.type,
    summary: event.summary,
    wrestlerIds: event.wrestlerIds,
    ...(event.storyId !== undefined ? { storyId: event.storyId } : {}),
    ...(event.matchId !== undefined ? { matchId: event.matchId } : {}),
    ...(event.showId !== undefined ? { showId: event.showId } : {}),
    data: event.data ?? {},
  };
  world.events.push(full);
  ctx.events.push(full);
  return full;
}
