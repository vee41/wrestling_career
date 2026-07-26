import { extractOption, parsePositiveInt } from "../args.js";
import type { CliContext } from "../context.js";
import { renderSheet } from "../format.js";
import { loadSave } from "../store.js";

export function runSheet(args: readonly string[], ctx: CliContext): string {
  const { rest, value: limitOpt } = extractOption(args, "limit");
  if (rest.length > 0) throw new Error(`sheet: unexpected argument "${rest[0]}"`);
  const limit = parsePositiveInt(limitOpt, 25, "limit");

  const { world } = loadSave(ctx.filePath);
  return renderSheet(world, limit);
}
