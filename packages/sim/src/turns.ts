import type { PlayerTurn, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findRelationship, findWrestler } from "./lookups.js";
import { interactionGatePasses } from "./gates.js";

/**
 * GDD §4 pipeline step 1: validate submitted turns. At most one interaction
 * and one action per wrestler is already structurally guaranteed by
 * `playerTurnSchema` (each is a single optional field, not an array); this
 * stage rejects duplicate submissions for the same wrestler in one tick,
 * turns for unknown wrestlers, and interactions that fail the relationship
 * gate (spec §12 / gates.ts) — the latter drops only the interaction, the
 * rest of the turn (action, responses, intents) still stands.
 */
export function collectTurns(
  world: WorldState,
  submitted: readonly PlayerTurn[],
  ctx: TickContext,
): Map<string, PlayerTurn> {
  const byWrestler = new Map<string, PlayerTurn>();

  for (const turn of submitted) {
    const wrestler = findWrestler(world, turn.wrestlerId);
    if (!wrestler) {
      addEvent(world, ctx, {
        type: "action_rejected",
        summary: `A turn was submitted for unknown wrestler id "${turn.wrestlerId}" and rejected.`,
        wrestlerIds: [],
      });
      continue;
    }

    if (byWrestler.has(turn.wrestlerId)) {
      addEvent(world, ctx, {
        type: "action_rejected",
        summary: `${wrestler.name} submitted more than one turn this tick; only the first was kept.`,
        wrestlerIds: [wrestler.id],
      });
      continue;
    }

    let sanitized = turn;
    if (turn.interaction && turn.interaction.target.kind === "wrestler") {
      const rel = findRelationship(world, turn.wrestlerId, turn.interaction.target.wrestlerId);
      if (!interactionGatePasses(turn.interaction.intent, rel)) {
        addEvent(world, ctx, {
          type: "action_rejected",
          summary: `${wrestler.name}'s ${turn.interaction.intent} was rejected — the relationship isn't strong enough yet.`,
          wrestlerIds: [wrestler.id, turn.interaction.target.wrestlerId],
          data: { intent: turn.interaction.intent },
        });
        const { interaction: _dropped, ...rest } = turn;
        sanitized = rest;
      }
    }

    byWrestler.set(turn.wrestlerId, sanitized);
  }

  return byWrestler;
}
