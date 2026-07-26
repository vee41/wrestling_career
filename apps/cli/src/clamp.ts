/** Clamp to the shared 0-100 scale (contracts' `scale100Schema`). */
export function clampScale100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
