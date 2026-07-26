import { z } from "zod";
import { idSchema } from "./common.js";
import { gimmickSchema, skillNameSchema } from "./wrestler.js";

// Spec §12 (prototype scope) / §4.1 — the action-slot union. One per
// decision period, spending the wrestler's time and energy. People-facing
// influence moved to interaction.ts (spec §3); per-match approach moved to
// intent.ts (spec §6). Money never occupies this slot (GDD §8) — setting
// `invest: true` explicitly spends money to upgrade the chosen action's
// quality; it is never spent automatically, so saving stays a real choice.

const trainSkillActionSchema = z.object({
  type: z.literal("train_skill"),
  id: idSchema,
  wrestlerId: idSchema,
  skill: skillNameSchema,
  invest: z.boolean().optional(),
});

const recoverActionSchema = z.object({
  type: z.literal("recover"),
  id: idSchema,
  wrestlerId: idSchema,
  invest: z.boolean().optional(),
});

const promoteMatchActionSchema = z.object({
  type: z.literal("promote_match"),
  id: idSchema,
  wrestlerId: idSchema,
  matchSlotId: idSchema,
  invest: z.boolean().optional(),
});

// Renamed from Phase 1's gimmick-adjustment action per spec §4.1.
const developCharacterActionSchema = z.object({
  type: z.literal("develop_character"),
  id: idSchema,
  wrestlerId: idSchema,
  adjustment: gimmickSchema.partial(),
  invest: z.boolean().optional(),
});

export const actionSchema = z.discriminatedUnion("type", [
  trainSkillActionSchema,
  recoverActionSchema,
  promoteMatchActionSchema,
  developCharacterActionSchema,
]);
export type Action = z.infer<typeof actionSchema>;

export type ActionType = Action["type"];
