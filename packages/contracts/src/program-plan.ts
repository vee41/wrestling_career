import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

/** Private creative roles are deliberately separate from public wrestler roles. */
export const programParticipantRoleSchema = z.enum(["protagonist", "antagonist", "supporting"]);
export type ProgramParticipantRole = z.infer<typeof programParticipantRoleSchema>;

export const programParticipantSchema = z.object({
  wrestlerId: idSchema,
  role: programParticipantRoleSchema,
});
export type ProgramParticipant = z.infer<typeof programParticipantSchema>;

export const programCreativeObjectiveSchema = z.enum([
  "elevate_act",
  "establish_challenger",
  "retain_championship",
  "change_championship",
  "turn_character",
  "redeem_act",
  "settle_grudge",
]);
export type ProgramCreativeObjective = z.infer<typeof programCreativeObjectiveSchema>;

export const programPlanStatusSchema = z.enum(["proposed", "active", "payoff_ready", "resolved", "abandoned"]);
export type ProgramPlanStatus = z.infer<typeof programPlanStatusSchema>;

export const programRevisionReasonSchema = z.enum([
  "initial_plan",
  "participant_unavailable",
  "player_pitch",
  "player_response",
  "title_change",
  "execution_deviation",
  "crowd_response",
  "repetition",
  "payoff_capacity",
  "director_catalyst",
  "manual",
]);
export type ProgramRevisionReason = z.infer<typeof programRevisionReasonSchema>;

/** The intent snapshot that makes a revision auditable without parsing prose. */
export const programIntentSnapshotSchema = z.object({
  creativeObjective: programCreativeObjectiveSchema,
  stakesTitleId: idSchema.optional(),
  targetPayoffTick: tickSchema,
  intendedPayoff: z.string().min(1),
  protectedWrestlerIds: z.array(idSchema),
});
export type ProgramIntentSnapshot = z.infer<typeof programIntentSnapshotSchema>;

export const programPlanRevisionSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  reason: programRevisionReasonSchema,
  previousIntent: programIntentSnapshotSchema.optional(),
  newIntent: programIntentSnapshotSchema,
});
export type ProgramPlanRevision = z.infer<typeof programPlanRevisionSchema>;

export const programPlanSchema = z.object({
  id: idSchema,
  storyId: idSchema,
  stakesTitleId: idSchema.optional(),
  participants: z.array(programParticipantSchema).min(2),
  premise: z.string().min(1),
  creativeObjective: programCreativeObjectiveSchema,
  priority: z.number().int().min(1).max(5),
  startTick: tickSchema,
  targetPayoffTick: tickSchema,
  targetShowId: idSchema.optional(),
  intendedPayoff: z.string().min(1),
  protectedWrestlerIds: z.array(idSchema),
  escalation: z.number().int().min(0).max(3),
  status: programPlanStatusSchema,
  plannedBeatIds: z.array(idSchema),
  completedBeatIds: z.array(idSchema),
  directMatchCooldownTicks: z.number().int().min(0),
  directMatchRepetitionBudget: z.number().int().min(0),
  revisions: z.array(programPlanRevisionSchema).min(1),
}).superRefine((plan, ctx) => {
  if (plan.targetPayoffTick < plan.startTick) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetPayoffTick must not precede startTick", path: ["targetPayoffTick"] });
  }
  const participantIds = plan.participants.map((participant) => participant.wrestlerId);
  if (new Set(participantIds).size !== participantIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "program participants must be unique", path: ["participants"] });
  }
  plan.protectedWrestlerIds.forEach((id, index) => {
    if (!participantIds.includes(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "protected participant must belong to the program", path: ["protectedWrestlerIds", index] });
    }
  });
});
export type ProgramPlan = z.infer<typeof programPlanSchema>;

export const programPlanCandidateDispositionSchema = z.enum(["selected", "rejected", "hard_invalid"]);
export type ProgramPlanCandidateDisposition = z.infer<typeof programPlanCandidateDispositionSchema>;

/** A permanent, private scoring trace for one candidate considered by the planner. */
export const programPlanCandidateSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  storyId: idSchema,
  participantWrestlerIds: z.array(idSchema).min(2),
  creativeObjective: programCreativeObjectiveSchema,
  scoreComponents: z.record(z.string(), z.number()),
  totalScore: z.number(),
  disposition: programPlanCandidateDispositionSchema,
  hardInvalidReasons: z.array(z.string().min(1)),
  selectedPlanId: idSchema.optional(),
}).superRefine((candidate, ctx) => {
  if (candidate.disposition === "hard_invalid" && candidate.hardInvalidReasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "hard-invalid candidates require a reason", path: ["hardInvalidReasons"] });
  }
  if (candidate.disposition !== "hard_invalid" && candidate.hardInvalidReasons.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only hard-invalid candidates may carry invalid reasons", path: ["hardInvalidReasons"] });
  }
  if (candidate.disposition === "selected" && candidate.selectedPlanId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected candidates require selectedPlanId", path: ["selectedPlanId"] });
  }
});
export type ProgramPlanCandidate = z.infer<typeof programPlanCandidateSchema>;
