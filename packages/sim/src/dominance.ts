import type { Wrestler } from "@wrestling/contracts";
import type { Rng } from "./rng.js";

// Spec §6.4 uses the same psychology/professionalism contest for a match or
// segment. Experience has no dedicated stat, so use overall skill as its
// stable proxy (the same approximation formerly local to match.ts).
function creativeIq(wrestler: Wrestler): number {
  const skills = Object.values(wrestler.skills);
  const experienceProxy = skills.reduce((sum, value) => sum + value, 0) / skills.length;
  return wrestler.skills.psychology * 0.4 + wrestler.skills.professionalism * 0.4 + wrestler.condition * 0.1 + experienceProxy * 0.1;
}

export function dominantParticipant(participants: readonly Wrestler[], rng: Rng): number {
  let index = 0;
  let score = Number.NEGATIVE_INFINITY;
  participants.forEach((participant, candidateIndex) => {
    const candidate = creativeIq(participant) + rng.float(-8, 8);
    if (candidate > score) {
      score = candidate;
      index = candidateIndex;
    }
  });
  return index;
}

export function intentsConflict(values: readonly number[], threshold = 0.6): boolean {
  return Math.max(...values) - Math.min(...values) > threshold;
}
