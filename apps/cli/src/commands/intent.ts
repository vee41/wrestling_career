import { matchIntentSchema } from "@wrestling/contracts";
import type { CliContext } from "../context.js";
import { findWrestler } from "../format.js";
import { emptyPendingTurn, loadSave, writeSave } from "../store.js";
import { parseOrThrow } from "../validate.js";

export function runIntent(args: readonly string[], ctx: CliContext): string {
  const [wrestlerId, matchSlotId, intentArg] = args;
  if (!wrestlerId || !matchSlotId || !intentArg) {
    throw new Error("usage: intent <wrestlerId> <matchSlotId> <intent>");
  }

  const save = loadSave(ctx.filePath);
  const wrestler = findWrestler(save.world, wrestlerId);
  const slot = save.world.shows.flatMap((s) => s.card).find((c) => c.id === matchSlotId);
  if (!slot) {
    throw new Error(`unknown match slot "${matchSlotId}" — check \`status ${wrestlerId}\` for upcoming bookings`);
  }
  if (!slot.participantWrestlerIds.includes(wrestlerId)) {
    throw new Error(`${wrestler.name} isn't booked in match slot "${matchSlotId}"`);
  }

  const intent = parseOrThrow(matchIntentSchema, intentArg, "intent");

  const turn = save.pendingTurns[wrestlerId] ?? emptyPendingTurn(wrestlerId);
  save.pendingTurns[wrestlerId] = { ...turn, matchIntents: { ...turn.matchIntents, [matchSlotId]: intent } };
  writeSave(ctx.filePath, save);

  return `${wrestler.name} will approach match "${matchSlotId}" with intent: ${intent.replace(/_/g, " ")}.`;
}
