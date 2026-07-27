import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";
import { popularityChangeReasonSchema } from "./popularity.js";

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
