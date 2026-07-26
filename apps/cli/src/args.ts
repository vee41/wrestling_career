/** Extract a boolean `--name` flag, returning the remaining positional/flag tokens. */
export function extractFlag(args: readonly string[], name: string): { rest: string[]; present: boolean } {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return { rest: [...args], present: false };
  return { rest: [...args.slice(0, idx), ...args.slice(idx + 1)], present: true };
}

/** Extract a `--name value` option, returning the remaining tokens and the value (if present). */
export function extractOption(
  args: readonly string[],
  name: string,
): { rest: string[]; value?: string } {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return { rest: [...args] };
  const value = args[idx + 1];
  if (value === undefined) return { rest: [...args.slice(0, idx)] };
  return { rest: [...args.slice(0, idx), ...args.slice(idx + 2)], value };
}

export function parsePositiveInt(value: string | undefined, fallback: number, flagName: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`--${flagName} must be a positive integer`);
  return parsed;
}
