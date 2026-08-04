import { runAct } from "./commands/act.js";
import { runInteract } from "./commands/interact.js";
import { runIntent } from "./commands/intent.js";
import { runRespond } from "./commands/respond.js";
import { runSeed } from "./commands/seed.js";
import { runSheet } from "./commands/sheet.js";
import { runSlice } from "./commands/slice.js";
import { runStance } from "./commands/stance.js";
import { runStatus } from "./commands/status.js";
import { runTickCommand } from "./commands/tick.js";
import type { CliContext } from "./context.js";

export const COMMANDS = [
  "seed",
  "status",
  "interact",
  "act",
  "respond",
  "intent",
  "stance",
  "tick",
  "sheet",
  "slice",
] as const;

export const USAGE = `wrestling-cli <command> [...args] [--file <path>]

Commands:
  seed [--scenario <id>] [--humans N] [--seed <string>]   load a scenario world
  status <wrestlerId> [--debug]                           career view
  interact <wrestlerId> <gm|targetId> <intent> [emphasis] [--about <id>]  fill the interaction slot
  act <wrestlerId> <actionType> [...args] [--invest]       fill the action slot
  respond <wrestlerId> <id> <response> [counterPayload]    answer a reactive decision or proposal
  intent <wrestlerId> <slotId> <intent>                    set a match or segment intent
  stance <wrestlerId> <stance>                             queue a stance change
  tick [--count N]                                         resolve the next tick(s)
  sheet [--limit N]                                        render the dirt sheet
  slice [--scenario <id>] [--seeds N] [--weeks N] [--report <path>]
                                                        run Phase 3.7 slice validation and save an HTML report`;

export function runCli(argv: readonly string[], ctx: CliContext): string {
  const [command, ...rest] = argv;
  switch (command) {
    case "seed":
      return runSeed(rest, ctx);
    case "status":
      return runStatus(rest, ctx);
    case "interact":
      return runInteract(rest, ctx);
    case "act":
      return runAct(rest, ctx);
    case "respond":
      return runRespond(rest, ctx);
    case "intent":
      return runIntent(rest, ctx);
    case "stance":
      return runStance(rest, ctx);
    case "tick":
      return runTickCommand(rest, ctx);
    case "sheet":
      return runSheet(rest, ctx);
    case "slice":
      return runSlice(rest, ctx);
    case undefined:
    case "help":
    case "--help":
      return USAGE;
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}
