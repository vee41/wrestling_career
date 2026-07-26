import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

// GDD §15/§16 — kinds of prose the LLM layer is asked to produce.
export const narrativeJobTypeSchema = z.enum([
  "show_recap",
  "personal_summary",
  "gm_message",
  "rival_response",
  "promo",
  "dirt_sheet_article",
  "rumour",
]);
export type NarrativeJobType = z.infer<typeof narrativeJobTypeSchema>;

export const narrativeCharacterSchema = z.object({
  id: idSchema,
  voice: z.array(z.string().min(1)),
});
export type NarrativeCharacter = z.infer<typeof narrativeCharacterSchema>;

export const narrativeConstraintsSchema = z.object({
  maxWords: z.number().int().positive(),
  inventFacts: z.boolean(),
});
export type NarrativeConstraints = z.infer<typeof narrativeConstraintsSchema>;

export const narrativeJobStatusSchema = z.enum(["pending", "done", "failed"]);
export type NarrativeJobStatus = z.infer<typeof narrativeJobStatusSchema>;

// GDD §16 — the exact job shape sent to a narrative provider.
export const narrativeJobSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  jobType: narrativeJobTypeSchema,
  facts: z.array(z.string().min(1)).min(1),
  characters: z.array(narrativeCharacterSchema),
  constraints: narrativeConstraintsSchema,
  status: narrativeJobStatusSchema.default("pending"),
});
export type NarrativeJob = z.infer<typeof narrativeJobSchema>;

// GDD §16 — the validated response a narrative provider must return.
export const narrativeResultSchema = z.object({
  jobId: idSchema,
  headline: z.string().min(1),
  body: z.string().min(1),
  mentionedCharacterIds: z.array(idSchema),
});
export type NarrativeResult = z.infer<typeof narrativeResultSchema>;
