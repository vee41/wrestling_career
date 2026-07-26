import { extractOption } from "../args.js";
import type { CliContext } from "../context.js";
import { buildWorld } from "../seed.js";
import { writeSave, type CliSave } from "../store.js";
import { newId } from "../ids.js";

export function runSeed(args: readonly string[], ctx: CliContext): string {
  const { rest: r1, value: wrestlersOpt } = extractOption(args, "wrestlers");
  const { rest: r2, value: humansOpt } = extractOption(r1, "humans");
  const { rest: r3, value: seedOpt } = extractOption(r2, "seed");
  if (r3.length > 0) throw new Error(`seed: unexpected argument "${r3[0]}"`);

  const wrestlerCount = wrestlersOpt !== undefined ? Number.parseInt(wrestlersOpt, 10) : 30;
  const humanCount = humansOpt !== undefined ? Number.parseInt(humansOpt, 10) : 1;
  const seed = seedOpt ?? newId("seed");

  if (!Number.isFinite(wrestlerCount) || wrestlerCount < 2) {
    throw new Error("--wrestlers must be an integer >= 2");
  }
  if (!Number.isFinite(humanCount) || humanCount < 0 || humanCount > wrestlerCount) {
    throw new Error("--humans must be between 0 and --wrestlers");
  }

  const world = buildWorld({ wrestlerCount, humanCount, seed });
  const save: CliSave = { world, pendingTurns: {} };
  writeSave(ctx.filePath, save);

  const humans = world.wrestlers.filter((w) => w.controlledBy === "human");
  return [
    `Seeded a new world at ${ctx.filePath} (seed "${seed}").`,
    `${world.wrestlers.length} wrestlers, ${humans.length} human-controlled.`,
    "Human-controlled wrestlers:",
    ...humans.map((w) => `  - ${w.id}  (${w.name})`),
    `GM objective: ${world.gmObjective.replace(/_/g, " ")}`,
  ].join("\n");
}
