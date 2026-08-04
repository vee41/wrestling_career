import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";
import { plannedSegmentOutcomeSchema } from "./planned-outcome.js";

/** The intentionally small Phase 3.10 creative vocabulary (booking AI §6). */
export const plannedBeatTypeSchema = z.enum([
  "promo_interview",
  "confrontation",
  "attack_save_interference",
  "showcase_contender_match",
  "direct_rivalry_match",
  "go_home_angle",
  "ple_payoff",
]);
export type PlannedBeatType = z.infer<typeof plannedBeatTypeSchema>;

export const plannedBeatSlotKindSchema = z.enum(["match", "segment", "either"]);
export type PlannedBeatSlotKind = z.infer<typeof plannedBeatSlotKindSchema>;

export const plannedBeatStatusSchema = z.enum(["provisional", "scheduled", "resolved", "skipped", "invalidated"]);
export type PlannedBeatStatus = z.infer<typeof plannedBeatStatusSchema>;

export const plannedBeatPreconditionsSchema = z.object({
  requiredResolvedBeatIds: z.array(idSchema).default([]),
  requirePle: z.boolean().default(false),
});
export type PlannedBeatPreconditions = z.infer<typeof plannedBeatPreconditionsSchema>;

export const plannedBeatSchema = z.object({
  id: idSchema,
  programId: idSchema,
  type: plannedBeatTypeSchema,
  requiredParticipantWrestlerIds: z.array(idSchema).min(1),
  optionalParticipantWrestlerIds: z.array(idSchema).default([]),
  earliestTick: tickSchema,
  latestTick: tickSchema,
  preconditions: plannedBeatPreconditionsSchema.default({}),
  intendedStoryEffect: z.string().min(1),
  // Segment plans own their creative outcome before a card slot is committed.
  plannedSegmentOutcome: plannedSegmentOutcomeSchema.optional(),
  escalationLevel: z.number().int().min(0).max(3),
  spendsDirectMatchup: z.boolean(),
  compatibleSlotKind: plannedBeatSlotKindSchema,
  status: plannedBeatStatusSchema,
  scheduledShowId: idSchema.optional(),
  resultIds: z.array(idSchema).default([]),
}).superRefine((beat, ctx) => {
  if (beat.latestTick < beat.earliestTick) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "latestTick must not precede earliestTick", path: ["latestTick"] });
  }
  if (beat.optionalParticipantWrestlerIds.some((id) => beat.requiredParticipantWrestlerIds.includes(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "optional participants must not duplicate required participants", path: ["optionalParticipantWrestlerIds"] });
  }
  if (beat.type === "ple_payoff" && (!beat.preconditions.requirePle || beat.compatibleSlotKind !== "match")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PLE payoff must require a PLE match", path: ["preconditions"] });
  }
});
export type PlannedBeat = z.infer<typeof plannedBeatSchema>;
