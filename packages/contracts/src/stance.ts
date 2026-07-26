import { z } from "zod";
import { idSchema } from "./common.js";

// Spec §7.1 — all 9 stances. `protect_character` deliberately also exists
// as a match intent (intent.ts): when a booked player sets no explicit
// intent, their stance supplies the default.
export const careerStanceSchema = z.enum([
  "prioritize_health",
  "chase_popularity",
  "cooperate_with_creative",
  "protect_character",
  "support_allies",
  "pursue_championships",
  "maximize_income",
  "seek_match_quality",
  "avoid_conflict",
]);
export type CareerStance = z.infer<typeof careerStanceSchema>;

// Spec §7.3 — a queued stance change takes effect on the following tick,
// never the current one; `pendingStance` holds that queued value until then.
export const wrestlerStanceSchema = z.object({
  wrestlerId: idSchema,
  stance: careerStanceSchema,
  pendingStance: careerStanceSchema.optional(),
});
export type WrestlerStance = z.infer<typeof wrestlerStanceSchema>;
