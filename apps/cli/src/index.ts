#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { CONTRACTS_PACKAGE_NAME } from "@wrestling/contracts";
import { describeNarrative } from "@wrestling/narrative";
import { describeSim } from "@wrestling/sim";
import { runCli } from "./cli.js";
import type { CliContext } from "./context.js";
import { resolveSaveFile } from "./store.js";

export function describeCli(): string {
  return [CONTRACTS_PACKAGE_NAME, describeSim(), describeNarrative()].join(" | ");
}

/** Split out the global `--file <path>` option, wherever it appears in argv. */
export function parseGlobalArgs(argv: readonly string[]): { rest: string[]; ctx: CliContext } {
  const idx = argv.indexOf("--file");
  if (idx === -1) return { rest: [...argv], ctx: { filePath: resolveSaveFile(undefined) } };
  const filePath = argv[idx + 1];
  const rest = [...argv.slice(0, idx), ...argv.slice(idx + 2)];
  return { rest, ctx: { filePath: resolveSaveFile(filePath) } };
}

function main(): void {
  const { rest, ctx } = parseGlobalArgs(process.argv.slice(2));
  try {
    console.log(runCli(rest, ctx));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) main();
