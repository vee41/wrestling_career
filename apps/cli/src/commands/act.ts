import { actionSchema, type Action } from "@wrestling/contracts";
import { extractFlag, extractOption } from "../args.js";
import type { CliContext } from "../context.js";
import { findWrestler } from "../format.js";
import { newId } from "../ids.js";
import { emptyPendingTurn, loadSave, writeSave } from "../store.js";
import { parseOrThrow } from "../validate.js";

const ACTION_TYPES = ["train_skill", "recover", "promote_match", "develop_character"] as const;

export function runAct(args: readonly string[], ctx: CliContext): string {
  const { rest: r0, present: invest } = extractFlag(args, "invest");
  const [wrestlerId, actionType, ...rest] = r0;
  if (!wrestlerId || !actionType) {
    throw new Error(`usage: act <wrestlerId> <${ACTION_TYPES.join("|")}> [...args] [--invest]`);
  }

  const save = loadSave(ctx.filePath);
  const wrestler = findWrestler(save.world, wrestlerId);
  const id = newId("action");
  const investPart = invest ? { invest: true } : {};

  let action: Action;
  switch (actionType) {
    case "train_skill": {
      const skill = rest[0];
      if (!skill) throw new Error("train_skill requires a <skill> argument");
      action = parseOrThrow(actionSchema, { type: "train_skill", id, wrestlerId, skill, ...investPart }, "act");
      break;
    }
    case "recover": {
      action = parseOrThrow(actionSchema, { type: "recover", id, wrestlerId, ...investPart }, "act");
      break;
    }
    case "promote_match": {
      const matchSlotId = rest[0];
      if (!matchSlotId) throw new Error("promote_match requires a <matchSlotId> argument");
      const known = save.world.shows.flatMap((s) => s.card).some((c) => c.id === matchSlotId);
      if (!known) {
        throw new Error(`no known match slot "${matchSlotId}" — check \`status ${wrestlerId}\` for upcoming bookings`);
      }
      action = parseOrThrow(
        actionSchema,
        { type: "promote_match", id, wrestlerId, matchSlotId, ...investPart },
        "act",
      );
      break;
    }
    case "develop_character": {
      const { rest: r1, value: concept } = extractOption(rest, "concept");
      const { rest: r2, value: promoTone } = extractOption(r1, "promo-tone");
      const { rest: r3, value: traitsRaw } = extractOption(r2, "traits");
      const { rest: r4, value: presentation } = extractOption(r3, "presentation");
      const { rest: r5, value: direction } = extractOption(r4, "direction");
      if (r5.length > 0) throw new Error(`develop_character: unexpected argument "${r5[0]}"`);

      const adjustment = {
        ...(concept !== undefined ? { concept } : {}),
        ...(promoTone !== undefined ? { promoTone } : {}),
        ...(traitsRaw !== undefined
          ? { traits: traitsRaw.split(",").map((t) => t.trim()).filter((t) => t.length > 0) }
          : {}),
        ...(presentation !== undefined ? { presentation } : {}),
        ...(direction !== undefined ? { currentDirection: direction } : {}),
      };
      if (Object.keys(adjustment).length === 0) {
        throw new Error(
          "develop_character requires at least one of --concept/--promo-tone/--traits/--presentation/--direction",
        );
      }
      action = parseOrThrow(
        actionSchema,
        { type: "develop_character", id, wrestlerId, adjustment, ...investPart },
        "act",
      );
      break;
    }
    default:
      throw new Error(`unknown action type "${actionType}" (expected ${ACTION_TYPES.join("|")})`);
  }

  const turn = save.pendingTurns[wrestlerId] ?? emptyPendingTurn(wrestlerId);
  const overwritten = turn.action !== undefined;
  save.pendingTurns[wrestlerId] = { ...turn, action };
  writeSave(ctx.filePath, save);

  return `${wrestler.name} will ${actionType.replace(/_/g, " ")} next tick.${
    overwritten ? " (replaced a previously queued action)" : ""
  }`;
}
