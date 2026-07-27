import { z } from "zod";

export const cardSizeRangeSchema = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1),
}).refine((range) => range.max >= range.min, {
  message: "card size range max must be at least min",
  path: ["max"],
});
export type CardSizeRange = z.infer<typeof cardSizeRangeSchema>;

/** Scenario-owned scheduling knobs. Defaults preserve the pre-Phase 3.5 cadence. */
export const worldConfigSchema = z.object({
  decisionTicksPerWeek: z.number().int().min(1).default(2),
  pleIntervalWeeks: z.number().int().min(1).default(4),
  tvCardSize: cardSizeRangeSchema.default({ min: 4, max: 6 }),
  pleCardSize: cardSizeRangeSchema.default({ min: 6, max: 8 }),
  sliceWeeks: z.number().int().min(1).default(26),
});
export type WorldConfig = z.infer<typeof worldConfigSchema>;
export const DEFAULT_WORLD_CONFIG: WorldConfig = worldConfigSchema.parse({});
