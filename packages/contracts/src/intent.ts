import { z } from "zod";

// Spec §6.1 — canonical match-intent vocabulary. GDD §14 and the rest of
// contracts reference this list; it is not restated elsewhere. See the
// spec's own §6.1 note for the mapping from GDD v0.3's retired token names.
export const matchIntentSchema = z.enum([
  "protect_character",
  "elevate_opponent",
  "chase_quality",
  "work_safely",
  "play_to_crowd",
  "advance_story",
  "take_risks",
  "follow_plan",
  "steal_spotlight",
]);
export type MatchIntent = z.infer<typeof matchIntentSchema>;

// Spec §6.2 — canonical segment-intent vocabulary.
export const segmentIntentSchema = z.enum([
  "build_sympathy",
  "generate_hostility",
  "promote_opponent",
  "escalate_rivalry",
  "show_vulnerability",
  "protect_mystery",
  "seek_controversy",
  "stay_controlled",
]);
export type SegmentIntent = z.infer<typeof segmentIntentSchema>;
