import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";

// GDD §12 — a directed pair; affinity/respect/trust can run negative (dislike,
// disdain, distrust), while rivalry/resentment/influence are magnitudes.
export const relationshipSchema = z
  .object({
    fromWrestlerId: idSchema,
    toWrestlerId: idSchema,
    affinity: deltaScale100Schema,
    respect: deltaScale100Schema,
    trust: deltaScale100Schema,
    rivalry: scale100Schema,
    resentment: scale100Schema,
    influence: scale100Schema,
  })
  .refine((r) => r.fromWrestlerId !== r.toWrestlerId, {
    message: "a relationship must connect two different wrestlers",
    path: ["toWrestlerId"],
  });
export type Relationship = z.infer<typeof relationshipSchema>;
