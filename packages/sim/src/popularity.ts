import type { MatchResult, WorldState } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { clampDelta100, clampScale100, moveToward } from "./clamp.js";
import { findPopularity, requireWrestler } from "./lookups.js";
import { CARD_POSITION_MULTIPLIER } from "./match.js";

const REACTION_MAX_STEP = 15;
const POPULARITY_MAX_STEP = 8;
const REACTION_DECAY_STEP = 5;
const MOMENTUM_DECAY_FACTOR = 0.85;
const IDLE_FATIGUE_RELIEF = 3;
const HEAT_MAX_STEP = 12;
const TWEENER_HEAT_MAX_STEP = 8;
const OVEREXPOSURE_FATIGUE_FLOOR = 50;
const OVEREXPOSURE_PENALTY_FACTOR = 0.3;

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
      const result = matchResults.find((candidate) => candidate.participantWrestlerIds.includes(wrestler.id));
      const slot = result
        ? world.shows.find((show) => show.id === result.showId)?.card.find((candidate) => candidate.id === result.matchSlotId)
        : undefined;
      const positionMultiplier = slot ? CARD_POSITION_MULTIPLIER[slot.position] : 1;
      // GDD §10 overexposure: a wrestler who's been out there too much gets
      // a duller reaction even for the same underlying performance.
      const overexposurePenalty = Math.max(0, popularity.fatigue - OVEREXPOSURE_FATIGUE_FLOOR) * OVEREXPOSURE_PENALTY_FACTOR;
      const reactionTarget = clampScale100(
        perf.performanceScore * 0.6 + perf.crowdResponse * 0.4 - overexposurePenalty,
      );
      popularity.currentReaction = moveToward(popularity.currentReaction, reactionTarget, REACTION_MAX_STEP * positionMultiplier);

      const popularityTarget = clampScale100((popularity.currentReaction + perf.performanceScore) / 2);
      popularity.generalPopularity = moveToward(popularity.generalPopularity, popularityTarget, POPULARITY_MAX_STEP * positionMultiplier);

      const momentumSignal = (perf.performanceScore - 50) * 0.8 + (perf.crowdResponse - 50) * 0.4;
      popularity.momentum = clampDelta100(popularity.momentum * 0.6 + momentumSignal * 0.4 * positionMultiplier);

      // Sustained overexposure must be a fall, not only a muted gain. The
      // penalty is deliberately after the positive match signal, so a tired
      // act can still have a great night but cannot grow indefinitely by
      // appearing on every card.
      if (popularity.fatigue >= 65) {
        popularity.generalPopularity = clampScale100(popularity.generalPopularity - 3);
        popularity.momentum = clampDelta100(popularity.momentum - 5);
      }
    } else {
      popularity.currentReaction = moveToward(popularity.currentReaction, popularity.generalPopularity, REACTION_DECAY_STEP);
      popularity.momentum = clampDelta100(popularity.momentum * MOMENTUM_DECAY_FACTOR);
      popularity.fatigue = clampScale100(popularity.fatigue - IDLE_FATIGUE_RELIEF);
    }

    const recent = world.matchResults
      .filter((result) => result.participantWrestlerIds.includes(wrestler.id))
      .slice(-3);
    if (recent.length === 3 && recent.every((result) => result.winnerWrestlerId !== wrestler.id)) {
      // Three straight losses carry a credibility and momentum cost even if
      // each match was competent; the event log remains the visible history.
      popularity.momentum = clampDelta100(popularity.momentum - 12);
      popularity.generalPopularity = clampScale100(popularity.generalPopularity - 3);
    }
  }
}
