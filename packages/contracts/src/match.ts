import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";

// Broad pre-match intentions (GDD §14) live in intent.ts (spec §6) — see
// matchIntentSchema there. This module only covers the match's outcome.

export const participantPerformanceSchema = z.object({
  wrestlerId: idSchema,
  performanceScore: scale100Schema,
  characterCredibilityDelta: deltaScale100Schema,
  physicalCost: scale100Schema,
  gmReactionDelta: deltaScale100Schema,
  backstageReactionDelta: deltaScale100Schema,
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
