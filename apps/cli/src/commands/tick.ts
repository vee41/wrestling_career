import { runTick } from "@wrestling/sim";
import { extractOption, parsePositiveInt } from "../args.js";
import type { CliContext } from "../context.js";
import { loadSave, writeSave } from "../store.js";

export function runTickCommand(args: readonly string[], ctx: CliContext): string {
  const { rest, value: countOpt } = extractOption(args, "count");
  if (rest.length > 0) throw new Error(`tick: unexpected argument "${rest[0]}"`);
  const count = parsePositiveInt(countOpt, 1, "count");

  const save = loadSave(ctx.filePath);
  const output: string[] = [];

  for (let i = 0; i < count; i++) {
    const turns = Object.values(save.pendingTurns);
    const startingTick = save.world.tick;
    const result = runTick(save.world, turns, save.world.seed);
    save.world = result.world;
    save.pendingTurns = {};

    output.push(`— Tick ${startingTick} resolved (now tick ${save.world.tick}) —`);
    if (result.events.length === 0) {
      output.push("  (nothing notable happened)");
    } else {
      for (const event of result.events) output.push(`  [${event.type}] ${event.summary}`);
    }
  }

  writeSave(ctx.filePath, save);
  return output.join("\n");
}
