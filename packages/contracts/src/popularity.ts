import { z } from "zod";
import { deltaScale100Schema, idSchema, scale100Schema } from "./common.js";

// GDD §10 — crowd response is deliberately not a single permanent score.
export const popularityBlockSchema = z.object({
  wrestlerId: idSchema,
  currentReaction: scale100Schema,
  generalPopularity: scale100Schema,
  // Earned status anchor. It moves only through durable career milestones;
  // general popularity naturally settles toward it between moments.
  starPower: scale100Schema,
  momentum: deltaScale100Schema,
  positiveHeat: scale100Schema,
  negativeHeat: scale100Schema,
  fatigue: scale100Schema,
});
export type PopularityBlock = z.infer<typeof popularityBlockSchema>;

// GDD §10.3 — reasons attached to player-visible popularity movement.
export const popularityChangeReasonSchema = z.enum([
  "breakout",
  "crowd_ignition",
  "upset",
  "burial",
  "overexposure",
  "slump",
  "status_rise",
  "status_fall",
]);
export type PopularityChangeReason = z.infer<typeof popularityChangeReasonSchema>;
