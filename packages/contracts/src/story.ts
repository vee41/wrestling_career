import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema, tickSchema } from "./common.js";

// GDD §13/§15 gives examples, not a fixed list, of story tensions. This
// enum is our own simplification rather than something lifted verbatim
// from the GDD.
export const tensionTypeSchema = z.enum([
  "push_conflict",
  "alliance_strain",
  "title_pursuit",
  "betrayal",
  "authority_defiance",
  "grudge",
  "redemption",
]);
export type TensionType = z.infer<typeof tensionTypeSchema>;

export const storyPhaseSchema = z.enum(["building", "peaking", "cooling", "resolved"]);
export type StoryPhase = z.infer<typeof storyPhaseSchema>;

export const storySchema = z.object({
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(2),
  tension: tensionTypeSchema,
  tensionDescription: z.string().min(1),
  stakes: z.string().min(1),
  audienceInterest: scale100Schema,
  momentum: deltaScale100Schema,
  coherence: scale100Schema,
  phase: storyPhaseSchema,
  /**
   * When the story entered `cooling`, so the phase has an exit: it either
   * re-heats on a booking that works or resolves quietly once the window in
   * `booking.coolingResolveWeeks` passes. Absent in every other phase.
   */
  coolingSinceTick: tickSchema.optional(),
  unresolvedDevelopments: z.array(z.string().min(1)),
});
export type Story = z.infer<typeof storySchema>;
