import type { CareerStance, MatchIntent, SegmentIntent } from "@wrestling/contracts";

/**
 * Spec §7.2: stance IS the AI utility-weight preset. The spec enumerates the
 * 9 stance tokens (§7.1) but not concrete weights, so this table is the
 * Phase 2 "simplest thing that preserves the pillars" choice — every
 * dimension is a 0..1 relative preference used only to compare options
 * within one wrestler's own decision, never compared across wrestlers.
 */
export interface StanceWeights {
  ambition: number;
  health: number;
  creative: number;
  characterProtection: number;
  loyalty: number;
  income: number;
  quality: number;
  conflictAversion: number;
  riskTolerance: number;
}

const STANCE_WEIGHTS: Record<CareerStance, StanceWeights> = {
  prioritize_health: {
    ambition: 0.3,
    health: 1.0,
    creative: 0.4,
    characterProtection: 0.4,
    loyalty: 0.3,
    income: 0.3,
    quality: 0.3,
    conflictAversion: 0.6,
    riskTolerance: 0.1,
  },
  chase_popularity: {
    ambition: 0.9,
    health: 0.3,
    creative: 0.4,
    characterProtection: 0.3,
    loyalty: 0.3,
    income: 0.4,
    quality: 0.5,
    conflictAversion: 0.2,
    riskTolerance: 0.7,
  },
  cooperate_with_creative: {
    ambition: 0.4,
    health: 0.4,
    creative: 1.0,
    characterProtection: 0.3,
    loyalty: 0.4,
    income: 0.3,
    quality: 0.5,
    conflictAversion: 0.6,
    riskTolerance: 0.3,
  },
  protect_character: {
    ambition: 0.4,
    health: 0.4,
    creative: 0.4,
    characterProtection: 1.0,
    loyalty: 0.3,
    income: 0.3,
    quality: 0.4,
    conflictAversion: 0.5,
    riskTolerance: 0.2,
  },
  support_allies: {
    ambition: 0.3,
    health: 0.4,
    creative: 0.4,
    characterProtection: 0.3,
    loyalty: 1.0,
    income: 0.2,
    quality: 0.4,
    conflictAversion: 0.5,
    riskTolerance: 0.3,
  },
  pursue_championships: {
    ambition: 1.0,
    health: 0.3,
    creative: 0.4,
    characterProtection: 0.4,
    loyalty: 0.2,
    income: 0.3,
    quality: 0.5,
    conflictAversion: 0.2,
    riskTolerance: 0.6,
  },
  maximize_income: {
    ambition: 0.5,
    health: 0.3,
    creative: 0.3,
    characterProtection: 0.3,
    loyalty: 0.2,
    income: 1.0,
    quality: 0.3,
    conflictAversion: 0.3,
    riskTolerance: 0.4,
  },
  seek_match_quality: {
    ambition: 0.4,
    health: 0.4,
    creative: 0.4,
    characterProtection: 0.4,
    loyalty: 0.3,
    income: 0.2,
    quality: 1.0,
    conflictAversion: 0.3,
    riskTolerance: 0.5,
  },
  avoid_conflict: {
    ambition: 0.3,
    health: 0.5,
    creative: 0.5,
    characterProtection: 0.4,
    loyalty: 0.4,
    income: 0.3,
    quality: 0.3,
    conflictAversion: 1.0,
    riskTolerance: 0.2,
  },
};

export function stanceWeights(stance: CareerStance): StanceWeights {
  return STANCE_WEIGHTS[stance];
}

// Spec §7.1: "when a booked player sets no explicit intent, their stance
// provides the default." `protect_character` is the one token the spec
// pins explicitly; the rest are this phase's simplification.
const DEFAULT_MATCH_INTENT: Record<CareerStance, MatchIntent> = {
  prioritize_health: "work_safely",
  chase_popularity: "play_to_crowd",
  cooperate_with_creative: "follow_plan",
  protect_character: "protect_character",
  support_allies: "elevate_opponent",
  pursue_championships: "chase_quality",
  maximize_income: "play_to_crowd",
  seek_match_quality: "chase_quality",
  avoid_conflict: "follow_plan",
};

export function defaultMatchIntent(stance: CareerStance): MatchIntent {
  return DEFAULT_MATCH_INTENT[stance];
}

const DEFAULT_SEGMENT_INTENT: Record<CareerStance, SegmentIntent> = {
  prioritize_health: "stay_controlled",
  chase_popularity: "escalate_rivalry",
  cooperate_with_creative: "promote_opponent",
  protect_character: "protect_mystery",
  support_allies: "promote_opponent",
  pursue_championships: "escalate_rivalry",
  maximize_income: "seek_controversy",
  seek_match_quality: "build_sympathy",
  avoid_conflict: "stay_controlled",
};

export function defaultSegmentIntent(stance: CareerStance): SegmentIntent {
  return DEFAULT_SEGMENT_INTENT[stance];
}
