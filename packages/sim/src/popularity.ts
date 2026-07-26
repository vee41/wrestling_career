import type { MatchResult, WorldState } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { clampDelta100, clampScale100, moveToward } from "./clamp.js";
import { findPopularity, requireWrestler } from "./lookups.js";

const REACTION_MAX_STEP = 15;
const POPULARITY_MAX_STEP = 8;
const REACTION_DECAY_STEP = 5;
const MOMENTUM_DECAY_FACTOR = 0.85;
const IDLE_FATIGUE_RELIEF = 3;
const HEAT_MAX_STEP = 12;
const TWEENER_HEAT_MAX_STEP = 8;

/**
 * GDD §10: crowd response moves gradually (capped per-tick deltas), never a
 * single permanent score. Deliberately keyed off each participant's own
 * performanceScore/crowdResponse, never `winnerWrestlerId` — GDD §14's hard
 * requirement is that a losing wrestler can still gain popularity when their
 * performance or story role warrants it.
 */
export function updatePopularity(world: WorldState, _ctx: TickContext, matchResults: MatchResult[]): void {
  const perfByWrestler = new Map<string, { performanceScore: number; crowdResponse: number }>();

  for (const result of matchResults) {
    for (const perf of result.performances) {
      perfByWrestler.set(perf.wrestlerId, {
        performanceScore: perf.performanceScore,
        crowdResponse: result.crowdResponse,
      });
      const wrestler = requireWrestler(world, perf.wrestlerId);
      const popularity = findPopularity(world, perf.wrestlerId);
      popularity.fatigue = clampScale100(popularity.fatigue + perf.physicalCost * 0.3);
      if (wrestler.alignment === "face") {
        popularity.positiveHeat = moveToward(popularity.positiveHeat, result.crowdResponse, HEAT_MAX_STEP);
      } else if (wrestler.alignment === "heel") {
        popularity.negativeHeat = moveToward(popularity.negativeHeat, result.crowdResponse, HEAT_MAX_STEP);
      } else {
        popularity.positiveHeat = moveToward(
          popularity.positiveHeat,
          result.crowdResponse * 0.6,
          TWEENER_HEAT_MAX_STEP,
        );
        popularity.negativeHeat = moveToward(
          popularity.negativeHeat,
          result.crowdResponse * 0.4,
          TWEENER_HEAT_MAX_STEP,
        );
      }
    }
  }

  for (const wrestler of world.wrestlers) {
    const popularity = findPopularity(world, wrestler.id);
    const perf = perfByWrestler.get(wrestler.id);

    if (perf) {
      const reactionTarget = clampScale100(perf.performanceScore * 0.6 + perf.crowdResponse * 0.4);
      popularity.currentReaction = moveToward(popularity.currentReaction, reactionTarget, REACTION_MAX_STEP);

      const popularityTarget = clampScale100((popularity.currentReaction + perf.performanceScore) / 2);
      popularity.generalPopularity = moveToward(popularity.generalPopularity, popularityTarget, POPULARITY_MAX_STEP);

      const momentumSignal = (perf.performanceScore - 50) * 0.8 + (perf.crowdResponse - 50) * 0.4;
      popularity.momentum = clampDelta100(popularity.momentum * 0.6 + momentumSignal * 0.4);
    } else {
      popularity.currentReaction = moveToward(popularity.currentReaction, popularity.generalPopularity, REACTION_DECAY_STEP);
      popularity.momentum = clampDelta100(popularity.momentum * MOMENTUM_DECAY_FACTOR);
      popularity.fatigue = clampScale100(popularity.fatigue - IDLE_FATIGUE_RELIEF);
    }
  }
}
