import { z } from "zod";
import { idSchema, scale100Schema } from "./common.js";

// GDD §7 — the eight skills a wrestler develops.
export const skillNameSchema = z.enum([
  "ringPerformance",
  "psychology",
  "promoAbility",
  "characterWork",
  "athleticism",
  "toughness",
  "professionalism",
  "politicalInstinct",
]);
export type SkillName = z.infer<typeof skillNameSchema>;

export const skillsSchema = z.object({
  ringPerformance: scale100Schema,
  psychology: scale100Schema,
  promoAbility: scale100Schema,
  characterWork: scale100Schema,
  athleticism: scale100Schema,
  toughness: scale100Schema,
  professionalism: scale100Schema,
  politicalInstinct: scale100Schema,
});
export type Skills = z.infer<typeof skillsSchema>;

export const controlledBySchema = z.enum(["human", "ai"]);
export type ControlledBy = z.infer<typeof controlledBySchema>;

export const alignmentSchema = z.enum(["face", "heel", "tweener"]);
export type Alignment = z.infer<typeof alignmentSchema>;

// GDD §9 — lightweight, player-adjustable character block.
export const gimmickSchema = z.object({
  concept: z.string().min(1),
  promoTone: z.string().min(1),
  traits: z.array(z.string().min(1)),
  presentation: z.string().min(1),
  currentDirection: z.string().min(1),
});
export type Gimmick = z.infer<typeof gimmickSchema>;

export const wrestlerSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  controlledBy: controlledBySchema,
  skills: skillsSchema,
  condition: scale100Schema,
  money: z.number().int().nonnegative(),
  alignment: alignmentSchema,
  gimmick: gimmickSchema,
});
export type Wrestler = z.infer<typeof wrestlerSchema>;
