import { z } from "zod";
import { idSchema } from "./common.js";
import { interactionSchema } from "./interaction.js";
import { actionSchema } from "./actions.js";
import { reactiveResponseSchema } from "./reactive.js";
import { proposalResponseSchema } from "./proposal.js";
import { matchIntentSchema, segmentIntentSchema } from "./intent.js";
import { careerStanceSchema } from "./stance.js";

// Spec §2 — the complete set of a player's inputs for one decision period.
// At most one interaction and one action (both optional — an empty slot
// simply expires); reactive/proposal responses and intents are unbounded
// per tick since they answer whatever the simulation generated.
export const playerTurnSchema = z
  .object({
    wrestlerId: idSchema,
    interaction: interactionSchema.optional(),
    action: actionSchema.optional(),
    reactiveResponses: z.array(reactiveResponseSchema).default([]),
    proposalResponses: z.array(proposalResponseSchema).default([]),
    matchIntents: z.record(idSchema, matchIntentSchema).default({}),
    segmentIntents: z.record(idSchema, segmentIntentSchema).default({}),
    stanceChange: careerStanceSchema.optional(),
  })
  .refine((t) => t.interaction === undefined || t.interaction.wrestlerId === t.wrestlerId, {
    message: "interaction.wrestlerId must match the turn's wrestlerId",
    path: ["interaction", "wrestlerId"],
  })
  .refine((t) => t.action === undefined || t.action.wrestlerId === t.wrestlerId, {
    message: "action.wrestlerId must match the turn's wrestlerId",
    path: ["action", "wrestlerId"],
  });
export type PlayerTurn = z.infer<typeof playerTurnSchema>;
