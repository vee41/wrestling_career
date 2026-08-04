import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";
import { matchIntentSchema, segmentIntentSchema } from "./intent.js";

export const showKindSchema = z.enum(["tv", "ple"]);
export type ShowKind = z.infer<typeof showKindSchema>;

export const cardPositionSchema = z.enum(["main_event", "upper", "mid", "opener"]);
export type CardPosition = z.infer<typeof cardPositionSchema>;

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
  // Optional only for backwards-compatible parsing of pre-3.8 snapshots;
  // all newly authored slots carry the explicit discriminator.
  kind: z.literal("match").optional(),
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(2),
  storyId: idSchema.optional(),
  position: cardPositionSchema,
  titleId: idSchema.optional(),
  gmIntent: gmObjectiveSchema.optional(),
  // PLAN Phase 2: a show's card is booked one tick ahead of airing so
  // players have a decision period to set match intent (spec §6) before it
  // resolves. Intents accumulate here (wrestlerId -> intent) across however
  // many ticks the slot is visible before the show tick consumes it.
  intents: z.record(idSchema, matchIntentSchema).default({}),
});
export type MatchSlot = z.infer<typeof matchSlotSchema>;

/** A non-competitive on-card beat. A solo interview is deliberately valid. */
export const segmentSlotSchema = z.object({
  kind: z.literal("segment"),
  id: idSchema,
  participantWrestlerIds: z.array(idSchema).min(1),
  storyId: idSchema.optional(),
  position: cardPositionSchema,
  gmIntent: gmObjectiveSchema.optional(),
  titleId: z.never().optional(),
  intents: z.record(idSchema, segmentIntentSchema).default({}),
});
export type SegmentSlot = z.infer<typeof segmentSlotSchema>;

export const cardSlotSchema = z.union([matchSlotSchema, segmentSlotSchema]);
export type CardSlot = z.infer<typeof cardSlotSchema>;

export const showSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  kind: showKindSchema,
  card: z.array(cardSlotSchema).min(1),
});
export type Show = z.infer<typeof showSchema>;
