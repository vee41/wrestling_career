import { interactionSchema, type InteractionTarget } from "@wrestling/contracts";
import { extractOption } from "../args.js";
import type { CliContext } from "../context.js";
import { findName, findWrestler } from "../format.js";
import { newId } from "../ids.js";
import { emptyPendingTurn, loadSave, writeSave } from "../store.js";
import { parseOrThrow } from "../validate.js";

export function runInteract(args: readonly string[], ctx: CliContext): string {
  const { rest, value: about } = extractOption(args, "about");
  const [wrestlerId, targetArg, intentArg, ...emphasisParts] = rest;
  if (!wrestlerId || !targetArg || !intentArg) {
    throw new Error(
      "usage: interact <wrestlerId> <gm|targetWrestlerId> <intent> [emphasis...] [--about <wrestlerId>]",
    );
  }

  const save = loadSave(ctx.filePath);
  const wrestler = findWrestler(save.world, wrestlerId);

  const target: InteractionTarget =
    targetArg === "gm" ? { kind: "gm" } : { kind: "wrestler", wrestlerId: targetArg };
  if (target.kind === "wrestler") {
    findWrestler(save.world, target.wrestlerId); // throws if unknown
  }
  if (about !== undefined) findWrestler(save.world, about); // throws if unknown

  const emphasis = emphasisParts.length > 0 ? emphasisParts.join(" ") : undefined;
  const interaction = parseOrThrow(
    interactionSchema,
    {
      id: newId("interaction"),
      wrestlerId,
      target,
      intent: intentArg,
      ...(emphasis !== undefined ? { emphasis } : {}),
      // Only meaningful for a `pitch_feud` toward the GM (spec §3.2) — names
      // who the pitched feud would be with, per contracts' interaction.ts.
      ...(about !== undefined ? { subjectWrestlerId: about } : {}),
    },
    `interact`,
  );

  const turn = save.pendingTurns[wrestlerId] ?? emptyPendingTurn(wrestlerId);
  const overwritten = turn.interaction !== undefined;
  save.pendingTurns[wrestlerId] = { ...turn, interaction };
  writeSave(ctx.filePath, save);

  const targetLabel = targetArg === "gm" ? "the GM" : findName(save.world, targetArg);
  return `${wrestler.name} will ${intentArg.replace(/_/g, " ")} toward ${targetLabel} next tick.${
    overwritten ? " (replaced a previously queued interaction)" : ""
  }`;
}
