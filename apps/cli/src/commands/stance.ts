import { careerStanceSchema } from "@wrestling/contracts";
import type { CliContext } from "../context.js";
import { findWrestler } from "../format.js";
import { emptyPendingTurn, loadSave, writeSave } from "../store.js";
import { parseOrThrow } from "../validate.js";

export function runStance(args: readonly string[], ctx: CliContext): string {
  const [wrestlerId, stanceArg] = args;
  if (!wrestlerId || !stanceArg) throw new Error("usage: stance <wrestlerId> <stance>");

  const save = loadSave(ctx.filePath);
  const wrestler = findWrestler(save.world, wrestlerId);
  const stance = parseOrThrow(careerStanceSchema, stanceArg, "stance");

  const turn = save.pendingTurns[wrestlerId] ?? emptyPendingTurn(wrestlerId);
  save.pendingTurns[wrestlerId] = { ...turn, stanceChange: stance };
  writeSave(ctx.filePath, save);

  return `${wrestler.name} will queue a stance change to "${stance.replace(/_/g, " ")}", effective next tick.`;
}
