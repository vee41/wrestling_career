import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";
import { popularityChangeReasonSchema } from "./popularity.js";
import { segmentIntentSchema } from "./intent.js";

// Broad pre-match intentions (GDD §14) live in intent.ts (spec §6) — see
// matchIntentSchema there. This module only covers the match's outcome.

// The GDD §10 popularity-model breakdown for one wrestler's appearance in
// this match, attached by `updatePopularity` after the fact — this is what
// the slice report shows when a match is expanded. `reason` is only set when
// the change was significant enough to also emit a `popularity_changed`
// event (see popularity.ts); smaller moves still carry the raw factors.
export const popularityImpactSchema = z.object({
  delta: deltaScale100Schema,
  before: scale100Schema,
  after: scale100Schema,
  segment: z.number(),
  expectedSegment: z.number(),
  edge: z.number(),
  momentumBefore: deltaScale100Schema,
  momentumAfter: deltaScale100Schema,
  reason: popularityChangeReasonSchema.optional(),
});
export type PopularityImpact = z.infer<typeof popularityImpactSchema>;

export const participantPerformanceSchema = z.object({
  wrestlerId: idSchema,
  performanceScore: scale100Schema,
  characterCredibilityDelta: deltaScale100Schema,
  physicalCost: scale100Schema,
  gmReactionDelta: deltaScale100Schema,
  backstageReactionDelta: deltaScale100Schema,
  popularityImpact: popularityImpactSchema.optional(),
});
export type ParticipantPerformance = z.infer<typeof participantPerformanceSchema>;

export const matchResultSchema = z
  .object({
    id: idSchema,
    matchSlotId: idSchema,
    showId: idSchema,
    participantWrestlerIds: z.array(idSchema).min(2),
    winnerWrestlerId: idSchema,
    quality: scale100Schema,
    crowdResponse: scale100Schema,
    chemistry: scale100Schema,
    storyId: idSchema.optional(),
    storyAdvancement: scale100Schema,
    performances: z.array(participantPerformanceSchema).min(2),
  })
  .refine((m) => m.participantWrestlerIds.includes(m.winnerWrestlerId), {
    message: "winner must be one of the match participants",
    path: ["winnerWrestlerId"],
  })
  .refine(
    (m) => {
      const participants = new Set(m.participantWrestlerIds);
      const performers = new Set(m.performances.map((p) => p.wrestlerId));
      return (
        participants.size === performers.size &&
        [...participants].every((id) => performers.has(id))
      );
    },
    { message: "every participant must have exactly one performance record", path: ["performances"] },
  );
export type MatchResult = z.infer<typeof matchResultSchema>;

export const segmentParticipantPerformanceSchema = z.object({
  wrestlerId: idSchema,
  performanceScore: scale100Schema,
  positiveHeatDelta: deltaScale100Schema,
  negativeHeatDelta: deltaScale100Schema,
  storyAdvancement: scale100Schema,
  popularityImpact: popularityImpactSchema.optional(),
});
export type SegmentParticipantPerformance = z.infer<typeof segmentParticipantPerformanceSchema>;

/** The outcome of a promo, angle, interview, or skit; it has no winner. */
export const segmentResultSchema = z
  .object({
    id: idSchema,
    segmentSlotId: idSchema,
    showId: idSchema,
    participantWrestlerIds: z.array(idSchema).min(1),
    dominantWrestlerId: idSchema,
    quality: scale100Schema,
    crowdResponse: scale100Schema,
    storyId: idSchema.optional(),
    storyAdvancement: scale100Schema,
    intents: z.record(idSchema, segmentIntentSchema),
    performances: z.array(segmentParticipantPerformanceSchema).min(1),
  })
  .refine((segment) => segment.participantWrestlerIds.includes(segment.dominantWrestlerId), {
    message: "dominant wrestler must be one of the segment participants",
    path: ["dominantWrestlerId"],
  })
  .refine((segment) => {
    const participants = new Set(segment.participantWrestlerIds);
    const performers = new Set(segment.performances.map((p) => p.wrestlerId));
    return participants.size === performers.size && [...participants].every((id) => performers.has(id));
  }, { message: "every participant must have exactly one segment performance record", path: ["performances"] });
export type SegmentResult = z.infer<typeof segmentResultSchema>;
