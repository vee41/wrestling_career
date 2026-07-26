import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

// Spec §5.1 — prototype-scope reactive event types. Sponsor/mentor offers
// are explicitly post-prototype (spec §3.4/§5.1) and left out, same as the
// post-prototype interaction targets in interaction.ts.
export const reactiveDecisionTypeSchema = z.enum([
  "booking_request",
  "wrestler_proposal",
  "turn_proposal",
  "finish_changed",
  "public_insult",
  "rumor_published",
  "injury_decision",
  "support_request",
  "risky_opportunity",
]);
export type ReactiveDecisionType = z.infer<typeof reactiveDecisionTypeSchema>;

// Spec §5.2 — the full response vocabulary. A given decision only offers a
// subset (reactiveDecisionSchema.offeredResponses).
export const reactiveResponseTokenSchema = z.enum([
  "accept",
  "refuse",
  "negotiate",
  "ignore",
  "delay",
  "escalate",
  "cooperate_conditionally",
]);
export type ReactiveResponseToken = z.infer<typeof reactiveResponseTokenSchema>;

export const reactiveDecisionStatusSchema = z.enum(["pending", "responded", "expired"]);
export type ReactiveDecisionStatus = z.infer<typeof reactiveDecisionStatusSchema>;

export const reactiveDecisionSchema = z.object({
  id: idSchema,
  type: reactiveDecisionTypeSchema,
  targetWrestlerId: idSchema,
  originStoryId: idSchema.optional(),
  originMatchId: idSchema.optional(),
  originWrestlerId: idSchema.optional(),
  offeredResponses: z.array(reactiveResponseTokenSchema).min(1),
  deadlineTick: tickSchema,
  status: reactiveDecisionStatusSchema,
});
export type ReactiveDecision = z.infer<typeof reactiveDecisionSchema>;

export const reactiveResponseSchema = z.object({
  reactiveDecisionId: idSchema,
  response: reactiveResponseTokenSchema,
});
export type ReactiveResponse = z.infer<typeof reactiveResponseSchema>;
