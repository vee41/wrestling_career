import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

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
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(2),
  storyId: idSchema.optional(),
  gmIntent: gmObjectiveSchema.optional(),
});
export type MatchSlot = z.infer<typeof matchSlotSchema>;

export const showSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  card: z.array(matchSlotSchema).min(1),
});
export type Show = z.infer<typeof showSchema>;
