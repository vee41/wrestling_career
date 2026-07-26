import { z } from "zod";
import { idSchema } from "./common.js";
import { gimmickSchema, skillNameSchema } from "./wrestler.js";

// Spec §12 (prototype scope) / §4.1 — the action-slot union. One per
// decision period, spending the wrestler's time and energy. People-facing
// influence moved to interaction.ts (spec §3); per-match approach moved to
// intent.ts (spec §6). Money never occupies this slot (GDD §8) — it
// upgrades the quality of whichever action is chosen.

const trainSkillActionSchema = z.object({
  type: z.literal("train_skill"),
  id: idSchema,
  wrestlerId: idSchema,
  skill: skillNameSchema,
});

const recoverActionSchema = z.object({
  type: z.literal("recover"),
  id: idSchema,
  wrestlerId: idSchema,
});

const promoteMatchActionSchema = z.object({
  type: z.literal("promote_match"),
  id: idSchema,
  wrestlerId: idSchema,
  matchSlotId: idSchema,
});

// Renamed from Phase 1's gimmick-adjustment action per spec §4.1.
const developCharacterActionSchema = z.object({
  type: z.literal("develop_character"),
  id: idSchema,
  wrestlerId: idSchema,
  adjustment: gimmickSchema.partial(),
});

export const actionSchema = z.discriminatedUnion("type", [
  trainSkillActionSchema,
  recoverActionSchema,
  promoteMatchActionSchema,
  developCharacterActionSchema,
]);
export type Action = z.infer<typeof actionSchema>;

export type ActionType = Action["type"];
