import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";
import { matchIntentSchema, segmentIntentSchema } from "./intent.js";
import { plannedFinishSchema, plannedSegmentOutcomeSchema } from "./planned-outcome.js";

export const showKindSchema = z.enum(["tv", "ple"]);
export type ShowKind = z.infer<typeof showKindSchema>;

export const cardPositionSchema = z.enum(["main_event", "upper", "mid", "opener"]);
export type CardPosition = z.infer<typeof cardPositionSchema>;

/**
 * Private GM audit data for a committed card. Scores remain decomposed so a
 * report can explain a booking without reproducing the composer in prose.
 */
export const bookingCandidateDispositionSchema = z.enum(["selected", "rejected", "hard_invalid"]);
export type BookingCandidateDisposition = z.infer<typeof bookingCandidateDispositionSchema>;

/**
 * How the composer reached this candidate. `reserved` candidates are hard
 * obligations claimed in composition order (due payoffs, closing beat windows,
 * title obligations). The two `scored_` pools competed for what capacity was
 * left and were committed strictly in soft-score order, so a rejected candidate
 * outranking a selected one *from the same pool* is a defect the report can
 * see. They are separate pools because they answer to different card-shape
 * budgets: television carries a couple of story items, and open rotation fills
 * whatever is left.
 */
export const bookingSelectionModeSchema = z.enum(["reserved", "scored_story", "scored_rotation"]);
export type BookingSelectionMode = z.infer<typeof bookingSelectionModeSchema>;

export const bookingCandidateTraceSchema = z.object({
  id: idSchema,
  kind: z.enum(["match", "segment"]),
  participantWrestlerIds: z.array(idSchema).min(1),
  programId: idSchema.optional(),
  plannedBeatId: idSchema.optional(),
  titleId: idSchema.optional(),
  disposition: bookingCandidateDispositionSchema,
  selection: bookingSelectionModeSchema.optional(),
  hardInvalidReasons: z.array(z.string().min(1)).default([]),
  scoreComponents: z.record(z.string(), z.number()).default({}),
  totalScore: z.number(),
  slotId: idSchema.optional(),
  placementReason: z.string().min(1).optional(),
}).superRefine((candidate, ctx) => {
  if (candidate.disposition === "hard_invalid" && candidate.hardInvalidReasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "hard-invalid booking candidates require a reason", path: ["hardInvalidReasons"] });
  }
  if (candidate.disposition !== "hard_invalid" && candidate.hardInvalidReasons.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only hard-invalid booking candidates may carry invalid reasons", path: ["hardInvalidReasons"] });
  }
  if (candidate.disposition === "selected" && candidate.slotId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected booking candidates require a slot", path: ["slotId"] });
  }
});
export type BookingCandidateTrace = z.infer<typeof bookingCandidateTraceSchema>;

export const bookingTraceSchema = z.object({
  composedAtTick: tickSchema,
  targetTick: tickSchema,
  candidates: z.array(bookingCandidateTraceSchema),
});
export type BookingTrace = z.infer<typeof bookingTraceSchema>;

// GDD §11 — the GM's active creative objective, rotated by the sim every few weeks.
export const gmObjectiveSchema = z.enum([
  "new_main_eventer",
  "strengthen_tag_division",
  "rebuild_championship",
  "capitalise_on_rising_star",
  "cool_down_overexposed_act",
  "prepare_major_event",
]);
export type GmObjective = z.infer<typeof gmObjectiveSchema>;

export const matchSlotSchema = z.object({
  // Optional only for backwards-compatible parsing of pre-3.8 snapshots;
  // all newly authored slots carry the explicit discriminator.
  kind: z.literal("match").optional(),
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(2),
  storyId: idSchema.optional(),
  programId: idSchema.optional(),
  plannedBeatId: idSchema.optional(),
  position: cardPositionSchema,
  titleId: idSchema.optional(),
  gmIntent: gmObjectiveSchema.optional(),
  plannedFinish: plannedFinishSchema.optional(),
  // PLAN Phase 2: a show's card is booked one tick ahead of airing so
  // players have a decision period to set match intent (spec §6) before it
  // resolves. Intents accumulate here (wrestlerId -> intent) across however
  // many ticks the slot is visible before the show tick consumes it.
  intents: z.record(idSchema, matchIntentSchema).default({}),
});
export type MatchSlot = z.infer<typeof matchSlotSchema>;

/** A non-competitive on-card beat. A solo interview is deliberately valid. */
export const segmentSlotSchema = z.object({
  kind: z.literal("segment"),
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(1),
  storyId: idSchema.optional(),
  programId: idSchema.optional(),
  plannedBeatId: idSchema.optional(),
  position: cardPositionSchema,
  gmIntent: gmObjectiveSchema.optional(),
  plannedOutcome: plannedSegmentOutcomeSchema.optional(),
  titleId: z.never().optional(),
  intents: z.record(idSchema, segmentIntentSchema).default({}),
});
export type SegmentSlot = z.infer<typeof segmentSlotSchema>;

export const cardSlotSchema = z.union([matchSlotSchema, segmentSlotSchema]);
export type CardSlot = z.infer<typeof cardSlotSchema>;

export const showSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  kind: showKindSchema,
  card: z.array(cardSlotSchema).min(1),
  /** Developer/admin-only trace; never project this into player status. */
  bookingTrace: bookingTraceSchema.optional(),
});
export type Show = z.infer<typeof showSchema>;
