import { z } from "zod";

export const cardSizeRangeSchema = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1),
}).refine((range) => range.max >= range.min, {
  message: "card size range max must be at least min",
  path: ["max"],
});
export type CardSizeRange = z.infer<typeof cardSizeRangeSchema>;

/** Scenario-owned controls for GDD §10's anchored, surprise-driven popularity model. */
export const popularityTuningSchema = z.object({
  segmentPerformanceWeight: z.number().min(0).default(0.55),
  segmentCrowdWeight: z.number().min(0).default(0.35),
  segmentStoryWeight: z.number().min(0).default(0.1),
  overexposureFatigueFloor: z.number().min(0).max(100).default(50),
  overexposurePenaltyFactor: z.number().min(0).default(0.3),
  reactionMaxStep: z.number().int().min(0).max(100).default(15),
  reactionDecayStep: z.number().int().min(0).max(100).default(5),
  popularityMaxStep: z.number().int().min(0).max(100).default(3),
  momentumDecayFactor: z.number().min(0).max(1).default(0.85),
  momentumMemoryFactor: z.number().min(0).max(1).default(0.35),
  momentumSurpriseFactor: z.number().min(0).max(1).default(0.65),
  momentumPushFactor: z.number().min(0).default(4),
  /** Maximum hot-streak lift above the durable earned-status anchor. */
  popularityBand: z.number().positive().max(100).default(12),
  gravityFactor: z.number().min(0).default(0.08),
  idleGravityFactor: z.number().min(0).default(0.01),
  crowdIgnitionChance: z.number().min(0).max(1).default(0.18),
  crowdIgnitionMomentumMin: z.number().int().min(0).max(100).default(20),
  crowdIgnitionMomentumMax: z.number().int().min(0).max(100).default(30),
  lossEdgeBase: z.number().min(0).default(8),
  /**
   * A segment has no winner, so its edge comes from the popularity gap the
   * dominant participant carried the exchange over. Deliberately far below the
   * match-win factor: out-talking a bigger star is a real gain, but it is not
   * beating them.
   */
  segmentDominantEdgeFactor: z.number().min(0).max(0.5).default(0.15),
  /**
   * The edge every other segment participant takes. Losing a promo exchange is
   * not losing clean in a main event, so the default is exactly zero; the
   * bound keeps a scenario from turning an appearance back into a burial.
   */
  segmentNonDominantEdge: z.number().min(-5).max(0).default(0),
  pleMainEventStarPowerGain: z.number().int().min(0).max(100).default(2),
  sustainedMomentumStarPowerChange: z.number().int().min(0).max(100).default(1),
  worldTitleWinStarPowerGain: z.number().int().min(0).max(100).default(12),
  worldTitleLossStarPowerLoss: z.number().int().min(0).max(100).default(10),
  midcardTitleWinStarPowerGain: z.number().int().min(0).max(100).default(8),
  midcardTitleLossStarPowerLoss: z.number().int().min(0).max(100).default(6),
  scarcityCrowdBonusMax: z.number().min(0).max(100).default(18),
  scarcityStarPowerFloor: z.number().min(0).max(100).default(55),
  relevanceGraceWeeks: z.number().int().min(0).default(3),
  relevanceDecayRatePerWeek: z.number().min(0).default(2),
  relevanceDecayCap: z.number().min(0).max(100).default(20),
  relevanceHardFloor: z.number().min(0).max(100).default(10),
  rubStarPowerGain: z.number().int().min(0).max(100).default(3),
}).refine((tuning) => tuning.crowdIgnitionMomentumMax >= tuning.crowdIgnitionMomentumMin, {
  message: "crowd ignition momentum max must be at least min",
  path: ["crowdIgnitionMomentumMax"],
});
export type PopularityTuning = z.infer<typeof popularityTuningSchema>;

/** Scenario-owned controls for how wrestler attributes turn into match outcomes. */
export const matchTuningSchema = z.object({
  ringPerformanceWeight: z.number().min(0).default(0.35),
  psychologyWeight: z.number().min(0).default(0.25),
  athleticismWeight: z.number().min(0).default(0.2),
  conditionWeight: z.number().min(0).default(0.2),
  storyMomentumFactor: z.number().min(0).default(0.08),
  intentAssertivenessFactor: z.number().min(0).default(8),
  performanceVariance: z.number().min(0).max(100).default(10),
  qualityRawScoreWeight: z.number().min(0).default(0.7),
  qualityChemistryWeight: z.number().min(0).default(0.3),
  crowdQualityWeight: z.number().min(0).default(0.5),
  crowdStoryInterestWeight: z.number().min(0).default(0.3),
  crowdNoStoryBase: z.number().min(0).max(100).default(10),
  crowdVariance: z.number().int().min(0).max(100).default(8),
});
export type MatchTuning = z.infer<typeof matchTuningSchema>;

/**
 * Scenario-owned controls for wear, injury severity, and enforced absence.
 *
 * The distinction this group exists to hold: `condition` is the gradual wear
 * axis and a tick of rest moves it, while an injury writes a *calendar* fact —
 * a clearance tick nothing but time can reach. Without that, an injury is only
 * a condition dip the wrestler heals out of before the next card is composed.
 */
export const healthTuningSchema = z.object({
  /**
   * The condition at or above which a wrestler may be booked. Being driven
   * below it by a match is, by definition, the injury.
   */
  bookableCondition: z.number().min(0).max(100).default(40),
  /**
   * An injury that leaves a wrestler at or below this is serious rather than
   * minor: the match did real damage instead of ordinary wear. This is the
   * axis that separates the tiers — an injury lands somewhere in the band
   * between here and `bookableCondition`, and how deep decides the layoff.
   */
  seriousInjuryCondition: z.number().min(0).max(100).default(30),
  /**
   * The match physical cost at or above which an injury is serious whatever
   * condition it left — the wrestler who got hurt taking a real risk.
   */
  seriousInjuryPhysicalCost: z.number().min(0).max(100).default(38),
  /** Whole show weeks a minor injury keeps a wrestler off the card. */
  minorAbsenceWeeks: z.number().int().min(1).default(1),
  /** Whole show weeks a serious injury costs — a full PLE cycle at the shipped cadence. */
  seriousAbsenceWeeks: z.number().int().min(1).default(4),
}).refine((tuning) => tuning.seriousInjuryCondition <= tuning.bookableCondition, {
  message: "seriousInjuryCondition must not exceed bookableCondition",
  path: ["seriousInjuryCondition"],
}).refine((tuning) => tuning.seriousAbsenceWeeks >= tuning.minorAbsenceWeeks, {
  message: "seriousAbsenceWeeks must be at least minorAbsenceWeeks",
  path: ["seriousAbsenceWeeks"],
});
export type HealthTuning = z.infer<typeof healthTuningSchema>;

export const titleEligibilitySchema = z.enum(["none", "all", "midcard"]);
export type TitleEligibility = z.infer<typeof titleEligibilitySchema>;

/** Scenario-owned cadence and eligibility for each authored GDD §10.5 role. */
export const roleTuningSchema = z.object({
  idealGapWeeks: z.number().positive().default(1),
  scarcityMagnitude: z.number().min(0).default(0.15),
  overexposureSensitivity: z.number().min(0).default(1),
  relevanceDecay: z.boolean().default(false),
  storyGated: z.boolean().default(false),
  titleEligibility: titleEligibilitySchema.default("all"),
});
export type RoleTuning = z.infer<typeof roleTuningSchema>;

export const rolesTuningSchema = z.object({
  legend: roleTuningSchema.default({
    idealGapWeeks: 8, scarcityMagnitude: 1, overexposureSensitivity: 2,
    relevanceDecay: false, storyGated: true, titleEligibility: "none",
  }),
  part_timer: roleTuningSchema.default({
    idealGapWeeks: 3, scarcityMagnitude: 0.6, overexposureSensitivity: 1.4,
    relevanceDecay: false, storyGated: true, titleEligibility: "all",
  }),
  regular: roleTuningSchema.default({
    idealGapWeeks: 1, scarcityMagnitude: 0.15, overexposureSensitivity: 1,
    relevanceDecay: true, storyGated: false, titleEligibility: "all",
  }),
  prospect: roleTuningSchema.default({
    idealGapWeeks: 2, scarcityMagnitude: 0.15, overexposureSensitivity: 0.8,
    relevanceDecay: false, storyGated: false, titleEligibility: "midcard",
  }),
});
export type RolesTuning = z.infer<typeof rolesTuningSchema>;

/** Scenario-owned controls for pacing established acts and varying undercard matches. */
export const bookingTuningSchema = z.object({
  restTierPopularityThreshold: z.number().min(0).max(100).default(65),
  restPenalty: z.number().min(0).default(150),
  maxMultiWayParticipants: z.number().int().min(3).max(4).default(4),
  multiWayChance: z.number().min(0).max(1).default(0.15),
  // Phase 3.7.4: rank programs by their heat, with a championship as
  // meaningful stakes rather than a forced card position.
  heatStoryMomentumWeight: z.number().min(0).default(0.5),
  heatParticipantMomentumWeight: z.number().min(0).default(0.3),
  heatParticipantPopularityWeight: z.number().min(0).default(0.1),
  grudgeHeatBonus: z.number().min(0).default(15),
  worldTitleStakesHeatBonus: z.number().min(0).default(30),
  midcardTitleStakesHeatBonus: z.number().min(0).default(12),
  titleDefenseStalenessWeeks: z.number().int().min(0).default(8),
  contenderReadyMomentumThreshold: z.number().min(-100).max(100).default(20),
  /** Chance for an eligible TV building-story slot to become a non-match beat. */
  segmentChance: z.number().min(0).max(1).default(0.25),
  /**
   * How many television shows a program must have between its start and its
   * payoff before it may aim at that PLE. A plan seeded days before an event
   * has no runway to build one, so it aims at the following one instead of
   * booking beats into windows that have already closed.
   */
  minimumProgramBuildShows: z.number().int().min(1).default(2),
  /**
   * How many times a plan whose payoff window passed unresolved may extend to
   * the next viable PLE before it is abandoned. Zero abandons immediately.
   */
  maxPayoffExtensions: z.number().int().min(0).default(1),
  /**
   * How long a `cooling` story may sit without advancement before it resolves
   * quietly, releasing its participants. This is the exit that keeps cold
   * programs from accumulating as a permanent backlog.
   */
  coolingResolveWeeks: z.number().int().min(1).default(3),
  /**
   * How far a story's audience interest may fall below its own peak before the
   * planner treats the crowd as having answered: the `crowd_response` trigger.
   */
  crowdResponseInterestDrop: z.number().min(1).max(100).default(20),
  /**
   * How many resolved segment beats may execute against their intended heat
   * direction before the crowd response is read as a pivot rather than a dip.
   */
  heatContradictionLimit: z.number().int().min(1).default(2),
  /** How long a `cool_down` response keeps a program off television. */
  coolDownTicks: z.number().int().min(1).default(3),
  /**
   * How often one program may resolve the same beat type before the build is
   * repetitive: the `repetition` trigger. The first occurrence accelerates the
   * program to its payoff, a second abandons it.
   */
  repeatedBeatTypeLimit: z.number().int().min(2).default(3),
  /**
   * How many program payoffs one event may carry. A card of nothing but
   * blowoffs makes none of them matter, so the coldest programs beyond this are
   * extended to the next event: the `payoff_capacity` trigger.
   */
  maxPayoffsPerEvent: z.number().int().min(1).default(4),
  /**
   * How long the private planner candidate trace is kept. Two candidates are
   * appended every planning pass, so this is windowed like `world.events`;
   * the default holds several PLE cycles of history for the booking report.
   */
  programCandidateRetentionTicks: z.number().int().min(1).default(30),
  /**
   * How many wrestlers from outside a program a beat names as possible extra
   * bodies — the opponent a showcase needs, the run-in an interference angle
   * needs. Named at plan time but chosen at booking time, so more than one is
   * listed: who is available and unbooked changes over the weeks in between.
   */
  beatOutsideCandidateCount: z.number().int().min(1).default(3),
  /**
   * How many of those named outsiders one beat may actually book. A showcase
   * needs exactly one opponent and an angle needs one run-in; raising this
   * turns beats into multi-participant angles.
   */
  maxOptionalBeatParticipants: z.number().int().min(0).default(1),
  /**
   * How much a match outranks a segment when the two compete for a television
   * main event. Additive rather than absolute: television closes on a match
   * unless an angle is genuinely hotter than every match on the show.
   */
  tvMainEventMatchBias: z.number().min(0).default(30),
  /**
   * What a program pays to keep the card position it held on the previous
   * show. Three identical main events running is the card telling the audience
   * nothing has changed.
   */
  repeatPlacementPenalty: z.number().min(0).default(25),
  /**
   * The soft-score cost of a pairing the audience has already seen this run.
   * booking_ai §10 lists this term; nothing implemented it before Phase
   * 3.12.7, so open rotation quietly ran the same match repeatedly.
   */
  repeatPairingPenalty: z.number().min(0).default(20),
  /** The extra cost of running a pairing again on the very next show. */
  consecutivePairingPenalty: z.number().min(0).default(60),
  /**
   * What the promotion's creative objective is worth to a slot that structurally
   * serves it — a title match on a `rebuild_championship` cycle, a program beat
   * as a major event approaches. Doubled on a go-home show, where what is left
   * to say has to be said now.
   */
  objectiveSlotFitBonus: z.number().min(0).default(20),
  /**
   * How many recent open-rotation matches a wrestler's form is read from. This
   * is the contender pipeline: results in matches nobody planned are the
   * promotion's own evidence about who is worth building a program around.
   */
  rotationFormMatches: z.number().int().min(1).default(3),
  /**
   * What one net rotation win is worth to a program candidate whose objective
   * is to *build* somebody (`establish_challenger`, `elevate_act`).
   */
  contenderFormBonus: z.number().min(0).default(8),
});
export type BookingTuning = z.infer<typeof bookingTuningSchema>;

/** Scenario-owned scheduling and simulation tuning controls. */
export const worldConfigSchema = z.object({
  decisionTicksPerWeek: z.number().int().min(1).default(2),
  pleIntervalWeeks: z.number().int().min(1).default(4),
  tvCardSize: cardSizeRangeSchema.default({ min: 4, max: 6 }),
  pleCardSize: cardSizeRangeSchema.default({ min: 6, max: 8 }),
  sliceWeeks: z.number().int().min(1).default(26),
  popularity: popularityTuningSchema.default({}),
  match: matchTuningSchema.default({}),
  health: healthTuningSchema.default({}),
  roles: rolesTuningSchema.default({}),
  booking: bookingTuningSchema.default({}),
});
export type WorldConfig = z.infer<typeof worldConfigSchema>;
export const DEFAULT_WORLD_CONFIG: WorldConfig = worldConfigSchema.parse({});
