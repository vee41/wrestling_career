import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { playerTurnSchema, worldStateSchema, type PlayerTurn, type WorldState } from "@wrestling/contracts";

/** A CLI save: the authoritative WorldState plus each wrestler's turn-in-progress for the next tick. */
export interface CliSave {
  world: WorldState;
  pendingTurns: Record<string, PlayerTurn>;
}

export const DEFAULT_SAVE_FILE = "wrestling-save.json";

export function resolveSaveFile(explicit: string | undefined): string {
  return explicit ?? process.env["WRESTLING_SAVE_FILE"] ?? DEFAULT_SAVE_FILE;
}

export function saveExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function loadSave(filePath: string): CliSave {
  if (!existsSync(filePath)) {
    throw new Error(`no saved world at "${filePath}" — run \`seed\` first`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { world: unknown; pendingTurns?: unknown };
  const world = worldStateSchema.parse(raw.world);
  const pendingTurns: Record<string, PlayerTurn> = {};
  for (const [wrestlerId, turn] of Object.entries((raw.pendingTurns ?? {}) as Record<string, unknown>)) {
    pendingTurns[wrestlerId] = playerTurnSchema.parse(turn);
  }
  return { world, pendingTurns };
}

export function writeSave(filePath: string, save: CliSave): void {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(save, null, 2)}\n`, "utf-8");
}

/** A fresh, schema-valid empty turn for a wrestler who hasn't queued anything yet this tick. */
export function emptyPendingTurn(wrestlerId: string): PlayerTurn {
  return playerTurnSchema.parse({ wrestlerId });
}
