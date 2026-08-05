/** Small descriptive-statistics helpers shared by the slice analysis and the booking metrics. */

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

export function stdDev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 1-based ranks with ties averaged (standard Spearman tie handling). */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((_, index) => index).sort((a, b) => values[a]! - values[b]!);
  const result = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]!] === values[order[i]!]) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) result[order[k]!] = averageRank;
    i = j + 1;
  }
  return result;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((total, value) => total + value, 0) / n;
  const meanY = ys.reduce((total, value) => total + value, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return pearson(ranks(xs), ranks(ys));
}

/** A count for every token of a closed enum, so a never-observed token reports 0 rather than vanishing from a report. */
export function zeroedCounts<T extends string>(tokens: readonly T[]): Record<T, number> {
  return Object.fromEntries(tokens.map((token) => [token, 0])) as Record<T, number>;
}

export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
