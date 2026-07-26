import { z } from "zod";
import { idSchema } from "./common.js";

// Spec §3.1 — prototype targets only. Mentor/agent/sponsor/media/partner are
// explicitly post-prototype (spec §3.4, GDD §3) and are deliberately left
// out; this union is where they'd be added later.
export const interactionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gm") }),
  z.object({ kind: z.literal("wrestler"), wrestlerId: idSchema }),
]);
export type InteractionTarget = z.infer<typeof interactionTargetSchema>;

// Spec §3.2 (GM intents) ∪ §3.3 (wrestler intents), flattened into one
// token set — `pitch_feud` appears in both and is listed once.
export const interactionIntentSchema = z.enum([
  "request_opportunity",
  "pitch_feud",
  "pitch_alliance",
  "challenge_booking",
  "request_promo_time",
  "propose_character_change",
  "request_feedback",
  "offer_help",
  "propose_alliance",
  "build_trust",
  "request_support",
  "offer_elevation",
  "provoke",
  "repair_relationship",
  "undermine",
  "coordinate_pitch",
]);
export type InteractionIntent = z.infer<typeof interactionIntentSchema>;

// The spec partitions the flattened token set by target: §3.2 intents are
// valid only toward the GM, §3.3 only toward a wrestler. `pitch_feud` is
// the one token in both.
export const GM_INTENTS: ReadonlySet<InteractionIntent> = new Set<InteractionIntent>([
  "request_opportunity",
  "pitch_feud",
  "pitch_alliance",
  "challenge_booking",
  "request_promo_time",
  "propose_character_change",
  "request_feedback",
  "offer_help",
]);

export const WRESTLER_INTENTS: ReadonlySet<InteractionIntent> = new Set<InteractionIntent>([
  "pitch_feud",
  "propose_alliance",
  "build_trust",
  "request_support",
  "offer_elevation",
  "provoke",
  "repair_relationship",
  "undermine",
  "coordinate_pitch",
]);

export const interactionSchema = z
  .object({
    id: idSchema,
    wrestlerId: idSchema,
    target: interactionTargetSchema,
    intent: interactionIntentSchema,
    emphasis: z.string().min(1).optional(),
  })
  .refine((i) => (i.target.kind === "gm" ? GM_INTENTS : WRESTLER_INTENTS).has(i.intent), {
    message: "intent is not valid for this target kind (spec §3.2–§3.3)",
    path: ["intent"],
  });
export type Interaction = z.infer<typeof interactionSchema>;

// Spec §3.2 — how the GM (or a human target, via a Proposal) responds.
export const interactionOutcomeSchema = z.enum([
  "accepted",
  "rejected",
  "deferred",
  "conditional",
  "countered",
]);
export type InteractionOutcome = z.infer<typeof interactionOutcomeSchema>;
