import { z } from "zod";
import { idSchema, tickSchema } from "./common.js";

// The append-only log: the single source for the dirt sheet and personal
// feeds (GDD §17). Payload shape per type is intentionally loose here —
// Phase 2's tick engine owns what actually goes in `data`.
export const worldEventTypeSchema = z.enum([
  "action_rejected",
  "action_performed",
  "interaction_resolved",
  "proposal_created",
  "proposal_resolved",
  "reactive_decision_created",
  "reactive_decision_resolved",
  "stance_changed",
  "show_booked",
  "match_result",
  "segment_result",
  "story_started",
  "story_developed",
  "story_resolved",
  "relationship_changed",
  "popularity_changed",
  "gm_decision",
  "program_plan_created",
  "program_plan_revised",
  "program_candidate_evaluated",
  "injury",
  "rumour",
  "gimmick_changed",
  "title_change",
]);
export type WorldEventType = z.infer<typeof worldEventTypeSchema>;

export const worldEventSchema = z.object({
  id: idSchema,
  tick: tickSchema,
  type: worldEventTypeSchema,
  summary: z.string().min(1),
  wrestlerIds: z.array(idSchema),
  storyId: idSchema.optional(),
  matchId: idSchema.optional(),
  showId: idSchema.optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type WorldEvent = z.infer<typeof worldEventSchema>;
