import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

/** A championship is identified independently of its current holder; its lineage is the title_change event log. */
export const titleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  tier: z.enum(["world", "midcard"]),
  holderId: idSchema.optional(),
  since: tickSchema.optional(),
});
export type Title = z.infer<typeof titleSchema>;
