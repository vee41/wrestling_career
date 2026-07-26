import { randomUUID } from "node:crypto";

/**
 * CLI-side ids for interaction/action slot objects. These only need to be
 * unique within a save file, not deterministic — the sim's own determinism
 * guarantee covers `runTick(world, playerTurns, seed)`, and a submitted
 * PlayerTurn (ids included) is itself part of "same actions" in that
 * contract, not something the tick engine generates.
 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
