// Spec §8 — deterministic mappings from raw sim numbers to the qualitative
// forms players are actually shown. Raw numbers never leave the
// server/sim boundary in player-facing surfaces; CLI and web both render
// through these same functions so the two never drift.

export type RelationshipTier = "hostile" | "cold" | "neutral" | "warm" | "trusted";

/** For a signed -100..100 relationship dimension (affinity, respect, trust). */
export function relationshipTier(value: number): RelationshipTier {
  if (value <= -60) return "hostile";
  if (value <= -20) return "cold";
  if (value < 20) return "neutral";
  if (value < 60) return "warm";
  return "trusted";
}

export type MomentumDirection = "rising" | "steady" | "falling";

/** For a signed -100..100 momentum value, with a dead zone around zero. */
export function momentumDirection(value: number, deadZone = 10): MomentumDirection {
  if (value > deadZone) return "rising";
  if (value < -deadZone) return "falling";
  return "steady";
}

export type PopularityBand = "unknown" | "cult" | "known" | "over" | "star";

/** For the 0-100 generalPopularity dimension of a popularity block. */
export function popularityBand(value: number): PopularityBand {
  if (value < 20) return "unknown";
  if (value < 40) return "cult";
  if (value < 60) return "known";
  if (value < 80) return "over";
  return "star";
}

export type SkillBandOther = "weak" | "average" | "strong";
export type SkillBandOwn = "weak" | "developing" | "average" | "strong" | "elite";

/**
 * Own skills are shown in a finer band than what you see of others
 * (spec §8.2). Pass `viewpoint: "other"` when rendering someone else's
 * skill for a player who isn't them.
 */
export function skillBand(value: number, viewpoint: "own"): SkillBandOwn;
export function skillBand(value: number, viewpoint?: "other"): SkillBandOther;
export function skillBand(
  value: number,
  viewpoint: "own" | "other" = "other",
): SkillBandOwn | SkillBandOther {
  if (viewpoint === "own") {
    if (value < 20) return "weak";
    if (value < 40) return "developing";
    if (value < 60) return "average";
    if (value < 80) return "strong";
    return "elite";
  }
  if (value < 34) return "weak";
  if (value < 67) return "average";
  return "strong";
}
