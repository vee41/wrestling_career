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
  gravityFactor: z.number().min(0).default(0.08),
  idleGravityFactor: z.number().min(0).default(0.01),
  crowdIgnitionChance: z.number().min(0).max(1).default(0.18),
  crowdIgnitionMomentumMin: z.number().int().min(0).max(100).default(20),
  crowdIgnitionMomentumMax: z.number().int().min(0).max(100).default(30),
  lossEdgeBase: z.number().min(0).default(8),
  pleMainEventStarPowerGain: z.number().int().min(0).max(100).default(2),
  sustainedMomentumStarPowerChange: z.number().int().min(0).max(100).default(1),
  worldTitleWinStarPowerGain: z.number().int().min(0).max(100).default(12),
  worldTitleLossStarPowerLoss: z.number().int().min(0).max(100).default(10),
  midcardTitleWinStarPowerGain: z.number().int().min(0).max(100).default(8),
  midcardTitleLossStarPowerLoss: z.number().int().min(0).max(100).default(6),
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

/** Scenario-owned scheduling and simulation tuning controls. */
export const worldConfigSchema = z.object({
  decisionTicksPerWeek: z.number().int().min(1).default(2),
  pleIntervalWeeks: z.number().int().min(1).default(4),
  tvCardSize: cardSizeRangeSchema.default({ min: 4, max: 6 }),
  pleCardSize: cardSizeRangeSchema.default({ min: 6, max: 8 }),
  sliceWeeks: z.number().int().min(1).default(26),
  popularity: popularityTuningSchema.default({}),
  match: matchTuningSchema.default({}),
});
export type WorldConfig = z.infer<typeof worldConfigSchema>;
export const DEFAULT_WORLD_CONFIG: WorldConfig = worldConfigSchema.parse({});
