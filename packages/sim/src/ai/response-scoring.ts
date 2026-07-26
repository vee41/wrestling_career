import type { Rng } from "../rng.js";
import type { StanceWeights } from "./stance-weights.js";

// Shared scorer for reactive-decision responses (spec §5.2: accept, refuse,
// negotiate, ignore, delay, escalate, cooperate_conditionally) and proposal
// responses (spec §3.3: accept, reject, counter, ignore) — the two token
// sets overlap in meaning (reject~refuse, counter~negotiate) so one
// archetype table drives both instead of duplicating the heuristic.
interface ResponseArchetype {
  cooperativeness: number;
  risk: number;
}

const ARCHETYPES: Record<string, ResponseArchetype> = {
  accept: { cooperativeness: 1, risk: 0.5 },
  reject: { cooperativeness: 0, risk: 0.2 },
  refuse: { cooperativeness: 0, risk: 0.2 },
  counter: { cooperativeness: 0.6, risk: 0.3 },
  negotiate: { cooperativeness: 0.6, risk: 0.3 },
  ignore: { cooperativeness: 0.2, risk: 0.1 },
  delay: { cooperativeness: 0.4, risk: 0.1 },
  escalate: { cooperativeness: 0.1, risk: 0.9 },
  cooperate_conditionally: { cooperativeness: 0.7, risk: 0.4 },
};

export function scoreResponseToken(token: string, weights: StanceWeights): number {
  const archetype = ARCHETYPES[token];
  if (!archetype) throw new Error(`no response archetype for token "${token}"`);
  let score = weights.creative * archetype.cooperativeness * 0.6 + weights.riskTolerance * archetype.risk * 0.5;
  if (token === "refuse" || token === "reject") {
    score += weights.characterProtection * 0.5 + weights.health * 0.3;
  }
  if (token === "ignore" || token === "delay") {
    score += weights.conflictAversion * 0.5;
  }
  if (token === "escalate") {
    score += weights.ambition * 0.5 - weights.conflictAversion * 0.6;
  }
  if (token === "accept" || token === "cooperate_conditionally") {
    score += weights.loyalty * 0.3;
  }
  return score;
}

export function pickBestResponse<T extends string>(
  offered: readonly T[],
  weights: StanceWeights,
  rng: Rng,
): T {
  let best: T[] = [];
  let bestScore = -Infinity;
  for (const token of offered) {
    const score = scoreResponseToken(token, weights);
    if (score > bestScore) {
      bestScore = score;
      best = [token];
    } else if (score === bestScore) {
      best.push(token);
    }
  }
  return rng.pick(best);
}
