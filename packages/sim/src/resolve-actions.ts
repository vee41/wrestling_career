import type { PlayerTurn, SkillName, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampScale100 } from "./clamp.js";
import { findPopularity, findStory, requireWrestler } from "./lookups.js";
import { mergeDefined } from "./merge.js";

// GDD §8: money never occupies a slot — it upgrades the quality of the
// chosen action, but only when the turn explicitly opts in via the action's
// `invest` flag (never automatically, so saving stays a real choice). Flat
// per-action costs are this phase's simplification (the GDD gives sinks,
// not prices). Exported so the AI brain can weigh cost against its reserve.
export const ACTION_COST: Record<string, number> = {
  train_skill: 30,
  recover: 20,
  promote_match: 15,
  develop_character: 25,
};
const QUALITY_BONUS_MULTIPLIER = 1.4;

function spendForQuality(world: WorldState, wrestlerId: string, actionType: string): boolean {
  const wrestler = requireWrestler(world, wrestlerId);
  const cost = ACTION_COST[actionType] ?? 0;
  if (cost === 0 || wrestler.money < cost) return false;
  wrestler.money -= cost;
  return true;
}

// GDD §7 / spec §4.2: repeating train_skill on the same skill plateaus
// unless refreshed by match experience. A wrestler's most recent
// match_result event resets the window — everything trained before their
// last match no longer counts against them.
const TRAINING_PLATEAU_WINDOW_TICKS = 8;

function trainingRepeatCount(world: WorldState, wrestlerId: string, skill: SkillName, currentTick: number): number {
  let resetTick = Number.NEGATIVE_INFINITY;
  for (const e of world.events) {
    if (e.type === "match_result" && e.wrestlerIds.includes(wrestlerId)) {
      resetTick = Math.max(resetTick, e.tick);
    }
  }
  const lowerBound = Math.max(resetTick, currentTick - TRAINING_PLATEAU_WINDOW_TICKS);
  return world.events.filter(
    (e) =>
      e.type === "action_performed" &&
      e.tick > lowerBound &&
      e.tick <= currentTick &&
      e.wrestlerIds[0] === wrestlerId &&
      e.data["actionType"] === "train_skill" &&
      e.data["skill"] === skill,
  ).length;
}

const BASE_TRAINING_GAIN = 4;
const BASE_RECOVER_CONDITION_GAIN = 18;
const BASE_RECOVER_FATIGUE_RELIEF = 16;

export function applyActions(world: WorldState, turns: Map<string, PlayerTurn>, ctx: TickContext): void {
  for (const turn of turns.values()) {
    if (!turn.action) continue;
    applyOneAction(world, turn.action, ctx);
  }
}

function applyOneAction(world: WorldState, action: NonNullable<PlayerTurn["action"]>, ctx: TickContext): void {
  const wrestler = requireWrestler(world, action.wrestlerId);
  const popularity = findPopularity(world, action.wrestlerId);
  const rng = ctx.rng.fork(`action:${action.id}`);
  const upgraded = action.invest === true && spendForQuality(world, action.wrestlerId, action.type);
  const qualityMultiplier = upgraded ? QUALITY_BONUS_MULTIPLIER : 1;

  switch (action.type) {
    case "train_skill": {
      const repeats = trainingRepeatCount(world, wrestler.id, action.skill, ctx.tick);
      const plateauMultiplier = 1 / (1 + repeats * 0.35);
      const gain = BASE_TRAINING_GAIN * plateauMultiplier * qualityMultiplier;
      wrestler.skills[action.skill] = clampScale100(wrestler.skills[action.skill] + gain);
      wrestler.condition = clampScale100(wrestler.condition - rng.int(2, 6));
      addEvent(world, ctx, {
        type: "action_performed",
        summary: `${wrestler.name} trained ${action.skill}.`,
        wrestlerIds: [wrestler.id],
        data: { actionType: "train_skill", skill: action.skill, gain, plateaued: repeats > 0 },
      });
      break;
    }
    case "recover": {
      wrestler.condition = clampScale100(wrestler.condition + BASE_RECOVER_CONDITION_GAIN * qualityMultiplier);
      popularity.fatigue = clampScale100(popularity.fatigue - BASE_RECOVER_FATIGUE_RELIEF * qualityMultiplier);
      addEvent(world, ctx, {
        type: "action_performed",
        summary: `${wrestler.name} focused on recovery.`,
        wrestlerIds: [wrestler.id],
        data: { actionType: "recover" },
      });
      break;
    }
    case "promote_match": {
      const slot = world.shows.flatMap((s) => s.card).find((c) => c.id === action.matchSlotId);
      const story = slot?.storyId ? findStory(world, slot.storyId) : undefined;
      if (story) story.audienceInterest = clampScale100(story.audienceInterest + 6 * qualityMultiplier);
      popularity.currentReaction = clampScale100(popularity.currentReaction + 3 * qualityMultiplier);
      popularity.fatigue = clampScale100(popularity.fatigue + 4);
      addEvent(world, ctx, {
        type: "action_performed",
        summary: `${wrestler.name} promoted an upcoming match.`,
        wrestlerIds: [wrestler.id],
        ...(slot?.storyId !== undefined ? { storyId: slot.storyId } : {}),
        ...(action.matchSlotId !== undefined ? { matchId: action.matchSlotId } : {}),
        data: { actionType: "promote_match" },
      });
      break;
    }
    case "develop_character": {
      wrestler.gimmick = mergeDefined(wrestler.gimmick, action.adjustment);
      popularity.currentReaction = clampScale100(popularity.currentReaction + rng.int(-4, 8));
      addEvent(world, ctx, {
        type: "gimmick_changed",
        summary: `${wrestler.name} adjusted their character presentation.`,
        wrestlerIds: [wrestler.id],
        data: { actionType: "develop_character", adjustment: action.adjustment },
      });
      break;
    }
  }
}
