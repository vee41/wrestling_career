import { extractOption } from "../args.js";
import type { CliContext } from "../context.js";
import { writeSave, type CliSave } from "../store.js";
import { newId } from "../ids.js";
import { loadScenario } from "../scenario.js";
import { worldFromScenario } from "@wrestling/sim";

export function runSeed(args: readonly string[], ctx: CliContext): string {
  const { rest: r1, value: scenarioOpt } = extractOption(args, "scenario");
  const { rest: r2, value: humansOpt } = extractOption(r1, "humans");
  const { rest: r3, value: seedOpt } = extractOption(r2, "seed");
  if (r3.length > 0) throw new Error(`seed: unexpected argument "${r3[0]}"`);

  const scenarioId = scenarioOpt ?? "wwe-2026";
  const humanCount = humansOpt !== undefined ? Number.parseInt(humansOpt, 10) : 1;
  const seed = seedOpt ?? newId("seed");

  const scenario = loadScenario(scenarioId, ctx.dataRoot);
  if (!Number.isFinite(humanCount) || humanCount < 0 || humanCount > scenario.roster.length) {
    throw new Error("--humans must be between 0 and the scenario roster size");
  }

  const world = worldFromScenario(scenario, seed);
  for (const wrestler of world.wrestlers.slice(0, humanCount)) wrestler.controlledBy = "human";
  const save: CliSave = { world, pendingTurns: {} };
  writeSave(ctx.filePath, save);

  const humans = world.wrestlers.filter((w) => w.controlledBy === "human");
  return [
    `Seeded ${scenario.manifest.name} at ${ctx.filePath} (scenario "${scenarioId}", seed "${seed}").`,
    `${world.wrestlers.length} wrestlers, ${humans.length} human-controlled.`,
    "Human-controlled wrestlers:",
    ...humans.map((w) => `  - ${w.id}  (${w.name})`),
    `GM objective: ${world.gmObjective.replace(/_/g, " ")}`,
  ].join("\n");
}
