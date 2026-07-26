export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Clamp a probability to [0, 1] without rounding to an integer. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Clamp to the shared 0-100 scale (common.ts `scale100Schema`). */
export function clampScale100(value: number): number {
  return clamp(value, 0, 100);
}

/** Clamp to the shared signed -100..100 scale (common.ts `deltaScale100Schema`). */
export function clampDelta100(value: number): number {
  return clamp(value, -100, 100);
}

/** Move `current` toward `target` by at most `maxStep` — used to cap per-tick deltas (GDD §10). */
export function moveToward(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return Math.round(target);
  return Math.round(current + Math.sign(diff) * maxStep);
}
