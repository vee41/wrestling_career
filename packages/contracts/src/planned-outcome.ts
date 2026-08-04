import { z } from "zod";
import { idSchema } from "./common.js";

/** The creative instruction for a match. Execution may only depart through a recorded disruption. */
export const finishFamilySchema = z.enum(["clean", "dirty", "interference", "disqualification", "no_contest"]);
export type FinishFamily = z.infer<typeof finishFamilySchema>;

export const titleConsequenceSchema = z.enum(["change", "retain", "none"]);
export type TitleConsequence = z.infer<typeof titleConsequenceSchema>;

export const adherenceStrengthSchema = z.enum(["strict", "standard", "flexible"]);
export type AdherenceStrength = z.infer<typeof adherenceStrengthSchema>;

export const plannedFinishSchema = z.object({
  intendedWinnerWrestlerId: idSchema,
  finishFamily: finishFamilySchema,
  protectedWrestlerIds: z.array(idSchema).default([]),
  intendedTitleConsequence: titleConsequenceSchema,
  intendedStoryEffect: z.string().min(1),
  adherenceStrength: adherenceStrengthSchema,
});
export type PlannedFinish = z.infer<typeof plannedFinishSchema>;

export const plannedSegmentOutcomeSchema = z.object({
  intendedDominantWrestlerId: idSchema,
  intendedHeatDirection: z.enum(["positive", "negative", "mixed", "neutral"]),
  intendedStoryEffect: z.string().min(1),
  protectedWrestlerIds: z.array(idSchema).default([]),
  adherenceStrength: adherenceStrengthSchema,
});
export type PlannedSegmentOutcome = z.infer<typeof plannedSegmentOutcomeSchema>;

export const executionAdherenceSchema = z.enum(["adhered", "deviated"]);
export type ExecutionAdherence = z.infer<typeof executionAdherenceSchema>;

/** A closed set makes every creative change explainable in reports and replanning. */
export const executionDeviationCauseSchema = z.enum(["injury", "refusal", "dominant_conflicting_intent", "failed_interference"]);
export type ExecutionDeviationCause = z.infer<typeof executionDeviationCauseSchema>;

export const actualMatchOutcomeSchema = z.object({
  winnerWrestlerId: idSchema,
  finishFamily: finishFamilySchema,
  titleConsequence: titleConsequenceSchema,
  storyEffect: z.string().min(1),
});
export type ActualMatchOutcome = z.infer<typeof actualMatchOutcomeSchema>;

export const actualSegmentOutcomeSchema = z.object({
  dominantWrestlerId: idSchema,
  heatDirection: z.enum(["positive", "negative", "mixed", "neutral"]),
  storyEffect: z.string().min(1),
});
export type ActualSegmentOutcome = z.infer<typeof actualSegmentOutcomeSchema>;
