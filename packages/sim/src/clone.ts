import type { WorldState } from "@wrestling/contracts";

/**
 * `WorldState` round-trips through JSON by construction (contracts' own
 * tests assert this), so a JSON clone is a safe, dependency-free deep copy
 * — no reliance on `structuredClone`'s global type availability.
 */
export function cloneWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}
