import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";
import { interactionIntentSchema, WRESTLER_INTENTS } from "./interaction.js";

// Spec §3.3 — created when a wrestler-targeted interaction lands on a
// human-controlled wrestler. Default response deadline is 2 ticks after
// delivery; an expired proposal resolves as `ignored`.
export const proposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "countered",
  "ignored",
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalSchema = z
  .object({
    id: idSchema,
    proposerWrestlerId: idSchema,
    recipientWrestlerId: idSchema,
    originatingIntent: interactionIntentSchema,
    payload: z.string().min(1).optional(),
    createdAtTick: tickSchema,
    deadlineTick: tickSchema,
    status: proposalStatusSchema,
  })
  .refine((p) => p.deadlineTick === p.createdAtTick + 2, {
    message: "deadlineTick must be exactly 2 ticks after createdAtTick (spec §3.3)",
    path: ["deadlineTick"],
  })
  .refine((p) => p.proposerWrestlerId !== p.recipientWrestlerId, {
    message: "a proposal cannot target its own proposer",
    path: ["recipientWrestlerId"],
  })
  .refine((p) => WRESTLER_INTENTS.has(p.originatingIntent), {
    message: "a proposal can only originate from a wrestler-targeted intent (spec §3.3)",
    path: ["originatingIntent"],
  });
export type Proposal = z.infer<typeof proposalSchema>;

// Spec §3.3 — the recipient's response. Ignoring (explicitly or by expiry)
// carries a small negative affinity/trust effect on the proposer's side;
// that consequence is applied by the sim (Phase 2), not modeled here.
export const proposalResponseTokenSchema = z.enum(["accept", "reject", "counter", "ignore"]);
export type ProposalResponseToken = z.infer<typeof proposalResponseTokenSchema>;

export const proposalResponseSchema = z.object({
  proposalId: idSchema,
  response: proposalResponseTokenSchema,
  counterPayload: z.string().min(1).optional(),
});
export type ProposalResponse = z.infer<typeof proposalResponseSchema>;
