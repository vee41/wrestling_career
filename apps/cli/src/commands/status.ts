import { extractFlag } from "../args.js";
import type { CliContext } from "../context.js";
import { renderStatus } from "../format.js";
import { loadSave } from "../store.js";

export function runStatus(args: readonly string[], ctx: CliContext): string {
  const { rest, present: debug } = extractFlag(args, "debug");
  const [wrestlerId] = rest;
  if (!wrestlerId) throw new Error("usage: status <wrestlerId> [--debug]");

  const { world } = loadSave(ctx.filePath);
  return renderStatus(world, wrestlerId, debug);
}
