import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";

// GDD §10 — crowd response is deliberately not a single permanent score.
export const popularityBlockSchema = z.object({
  wrestlerId: idSchema,
  currentReaction: scale100Schema,
  generalPopularity: scale100Schema,
  momentum: deltaScale100Schema,
  positiveHeat: scale100Schema,
  negativeHeat: scale100Schema,
  fatigue: scale100Schema,
});
export type PopularityBlock = z.infer<typeof popularityBlockSchema>;
