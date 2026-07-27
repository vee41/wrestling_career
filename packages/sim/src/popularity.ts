import type { MatchResult, PopularityChangeReason, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampDelta100, clampScale100, moveToward } from "./clamp.js";
import { findPopularity, requireWrestler } from "./lookups.js";
import { weekForTick } from "./booking.js";

const IDLE_FATIGUE_RELIEF = 3;
const HEAT_MAX_STEP = 12;
const TWEENER_HEAT_MAX_STEP = 8;

interface Segment {
  value: number;
  performanceScore: number;
  crowdResponse: number;
  storyAdvancement: number;
}

function segmentFor(world: WorldState, performanceScore: number, crowdResponse: number, storyAdvancement: number, fatigue = 0): Segment {
  const tuning = world.config.popularity;
  return {
    value: performanceScore * tuning.segmentPerformanceWeight + crowdResponse * tuning.segmentCrowdWeight + storyAdvancement * tuning.segmentStoryWeight - Math.max(0, fatigue - tuning.overexposureFatigueFloor) * tuning.overexposurePenaltyFactor,
    performanceScore,
    crowdResponse,
    storyAdvancement,
  };
}

/** The history is intentionally derived from results rather than becoming a new persisted stat. */
function expectedSegment(world: WorldState, wrestlerId: string, currentResultId: string, currentSegment: number): number {
  const prior = world.matchResults
    .filter((result) => result.id !== currentResultId && result.participantWrestlerIds.includes(wrestlerId))
    .slice(-5)
    .map((result) => {
      const performance = result.performances.find((candidate) => candidate.wrestlerId === wrestlerId);
      return performance ? segmentFor(world, performance.performanceScore, result.crowdResponse, result.storyAdvancement).value : undefined;
    })
    .filter((value): value is number => value !== undefined);
  return prior.length === 0 ? currentSegment : prior.reduce((sum, value) => sum + value, 0) / prior.length;
}

function addPopularityEvent(
  world: WorldState,
  ctx: TickContext,
  wrestlerId: string,
  reason: PopularityChangeReason,
  direction: "rise" | "fall",
  summary: string,
  data: Record<string, unknown> = {},
): void {
  addEvent(world, ctx, {
    type: "popularity_changed",
    summary,
    wrestlerIds: [wrestlerId],
    data: { reason, direction, ...data },
  });
}

/** Detects the three-week momentum hold from already-visible event history. */
function heldMomentumForThreeWeeks(world: WorldState, wrestlerId: string, tick: number, direction: "rise" | "fall"): boolean {
  const currentWeek = weekForTick(tick, world.config);
  const qualifyingWeeks = new Set(
    world.events
      .filter((event) => event.type === "popularity_changed" && event.wrestlerIds.includes(wrestlerId))
      .filter((event) => {
        const momentum = event.data.momentum;
        return typeof momentum === "number" && (direction === "rise" ? momentum >= 25 : momentum <= -25);
      })
      .map((event) => weekForTick(event.tick, world.config)),
  );
  return qualifyingWeeks.has(currentWeek - 1) && qualifyingWeeks.has(currentWeek - 2);
}

/**
 * Moves the durable GDD §10.2 anchor and emits the paired player-visible fact.
 * Title resolution uses this export so title status cannot be mistaken for a
 * routine match-performance move.
 */
export function adjustStarPower(
  world: WorldState,
  ctx: TickContext,
  wrestlerId: string,
  delta: number,
  summary: string,
): void {
  if (delta === 0) return;
  const popularity = findPopularity(world, wrestlerId);
  const before = popularity.starPower;
  popularity.starPower = clampScale100(before + delta);
  if (popularity.starPower === before) return;
  const direction = popularity.starPower > before ? "rise" : "fall";
  addPopularityEvent(
    world,
    ctx,
    wrestlerId,
    direction === "rise" ? "status_rise" : "status_fall",
    direction,
    summary,
    { milestone: "status" },
  );
}

/**
 * GDD §10's four-timescale popularity model. A good match only matters when
 * it exceeds what the audience had reason to expect; the earned-status anchor
 * prevents both free workrate climbs and irreversible downward ratchets.
 */
export function updatePopularity(world: WorldState, ctx: TickContext, matchResults: MatchResult[]): void {
  const appearances = new Map<string, { result: MatchResult; performanceScore: number; physicalCost: number }>();
  const popularityAtStart = new Map(world.popularity.map((popularity) => [popularity.wrestlerId, popularity.generalPopularity]));

  for (const result of matchResults) {
    for (const performance of result.performances) {
      appearances.set(performance.wrestlerId, { result, performanceScore: performance.performanceScore, physicalCost: performance.physicalCost });
    }
  }

  for (const wrestler of world.wrestlers) {
    const popularity = findPopularity(world, wrestler.id);
    const appearance = appearances.get(wrestler.id);

    if (!appearance) {
      // The volatile crowd read settles back toward the stable baseline on
      // quiet ticks (GDD §10's reaction → popularity timescale); the
      // earned-status anchor pulls generalPopularity separately, and gently.
      popularity.currentReaction = moveToward(popularity.currentReaction, popularity.generalPopularity, world.config.popularity.reactionDecayStep);
      popularity.momentum = clampDelta100(popularity.momentum * world.config.popularity.momentumDecayFactor);
      popularity.fatigue = clampScale100(popularity.fatigue - IDLE_FATIGUE_RELIEF);
      popularity.generalPopularity = clampScale100(
        popularity.generalPopularity + Math.max(-1, Math.min(1, Math.round((popularity.starPower - popularity.generalPopularity) * world.config.popularity.idleGravityFactor))),
      );
      continue;
    }

    const { result, performanceScore, physicalCost } = appearance;
    const beforePopularity = popularity.generalPopularity;
    const beforeMomentum = popularity.momentum;
    popularity.fatigue = clampScale100(popularity.fatigue + physicalCost * 0.3);

    if (wrestler.alignment === "face") {
      popularity.positiveHeat = moveToward(popularity.positiveHeat, result.crowdResponse, HEAT_MAX_STEP);
    } else if (wrestler.alignment === "heel") {
      popularity.negativeHeat = moveToward(popularity.negativeHeat, result.crowdResponse, HEAT_MAX_STEP);
    } else {
      popularity.positiveHeat = moveToward(popularity.positiveHeat, result.crowdResponse * 0.6, TWEENER_HEAT_MAX_STEP);
      popularity.negativeHeat = moveToward(popularity.negativeHeat, result.crowdResponse * 0.4, TWEENER_HEAT_MAX_STEP);
    }

    const segment = segmentFor(world, performanceScore, result.crowdResponse, result.storyAdvancement, popularity.fatigue).value;
    const expected = expectedSegment(world, wrestler.id, result.id, segment);
    const opponents = result.participantWrestlerIds.filter((id) => id !== wrestler.id);
    const opponentAveragePopularity = opponents.reduce((sum, id) => sum + (popularityAtStart.get(id) ?? 0), 0) / Math.max(1, opponents.length);
    const won = result.winnerWrestlerId === wrestler.id;
    const edge = won
      ? Math.max(0, opponentAveragePopularity - beforePopularity) * 0.5
      : -Math.max(0, beforePopularity - opponentAveragePopularity) * 0.5 - world.config.popularity.lossEdgeBase;
    const surprise = segment - expected + edge;
    popularity.momentum = clampDelta100(popularity.momentum * world.config.popularity.momentumMemoryFactor + surprise * world.config.popularity.momentumSurpriseFactor);
    popularity.currentReaction = moveToward(popularity.currentReaction, segment, world.config.popularity.reactionMaxStep);

    const gravity = (popularity.starPower - beforePopularity) * world.config.popularity.gravityFactor;
    const headroom = popularity.momentum >= 0 ? 1 - beforePopularity / 100 : beforePopularity / 100;
    const push = popularity.momentum * world.config.popularity.momentumPushFactor * headroom;
    popularity.generalPopularity = clampScale100(beforePopularity + Math.max(-world.config.popularity.popularityMaxStep, Math.min(world.config.popularity.popularityMaxStep, Math.round(gravity + push))));

    let ignition = false;
    if (ctx.rng.fork(`moment:${wrestler.id}`).chance(world.config.popularity.crowdIgnitionChance)) {
      ignition = true;
      popularity.momentum = clampDelta100(popularity.momentum + ctx.rng.fork(`moment-strength:${wrestler.id}`).int(world.config.popularity.crowdIgnitionMomentumMin, world.config.popularity.crowdIgnitionMomentumMax));
      popularity.currentReaction = clampScale100(popularity.currentReaction + 10);
    }

    const show = world.shows.find((candidate) => candidate.id === result.showId);
    const slot = show?.card.find((candidate) => candidate.id === result.matchSlotId);
    if (show?.kind === "ple" && slot?.position === "main_event" && result.crowdResponse >= 70) {
      adjustStarPower(world, ctx, wrestler.id, world.config.popularity.pleMainEventStarPowerGain, `${wrestler.name} leaves the major main event with elevated status.`);
    }
    if (popularity.momentum >= 25 && heldMomentumForThreeWeeks(world, wrestler.id, ctx.tick, "rise")) {
      adjustStarPower(world, ctx, wrestler.id, world.config.popularity.sustainedMomentumStarPowerChange, `${wrestler.name}'s sustained momentum is turning into lasting status.`);
    } else if (popularity.momentum <= -25 && heldMomentumForThreeWeeks(world, wrestler.id, ctx.tick, "fall")) {
      adjustStarPower(world, ctx, wrestler.id, -world.config.popularity.sustainedMomentumStarPowerChange, `${wrestler.name}'s sustained slump is costing lasting status.`);
    }

    const delta = popularity.generalPopularity - beforePopularity;
    const crossedPositive = beforeMomentum < 25 && popularity.momentum >= 25;
    const crossedNegative = beforeMomentum > -25 && popularity.momentum <= -25;
    let reason: PopularityChangeReason | undefined;
    if (ignition || Math.abs(delta) >= 2 || crossedPositive || crossedNegative) {
      if (ignition) reason = "crowd_ignition";
      else if (crossedNegative) reason = "slump";
      else if (popularity.fatigue >= 65 && (delta < 0 || popularity.momentum < beforeMomentum)) reason = "overexposure";
      else if (edge >= 15) reason = "upset";
      else if (edge <= -15) reason = "burial";
      else if (segment - expected >= 15 || delta > 0 || crossedPositive) reason = "breakout";
      else reason = "burial";
      const direction = delta > 0 || (delta === 0 && popularity.momentum >= beforeMomentum) ? "rise" : "fall";
      const summaries: Record<PopularityChangeReason, string> = {
        breakout: `${wrestler.name} is building real audience momentum after an above-expectation showing.`,
        crowd_ignition: `${wrestler.name} unexpectedly ignited the crowd and left with a new buzz.`,
        upset: `${wrestler.name} made a meaningful statement by overcoming stronger opposition.`,
        burial: `${wrestler.name}'s result damaged their standing with the audience.`,
        overexposure: `${wrestler.name}'s heavy workload is beginning to dull the crowd response.`,
        slump: `${wrestler.name}'s slide has become impossible for the audience to ignore.`,
        status_rise: `${wrestler.name}'s status is rising.`,
        status_fall: `${wrestler.name}'s status is falling.`,
      };
      addPopularityEvent(world, ctx, wrestler.id, reason, direction, summaries[reason], { momentum: popularity.momentum });
    }

    // Attaches the calculation breakdown directly to the match record so the
    // slice report can explain "why" without re-deriving the model — `result`
    // here is the same object reference held in `world.matchResults`.
    const performance = result.performances.find((candidate) => candidate.wrestlerId === wrestler.id);
    if (performance) {
      performance.popularityImpact = {
        delta,
        before: beforePopularity,
        after: popularity.generalPopularity,
        segment,
        expectedSegment: expected,
        edge,
        momentumBefore: beforeMomentum,
        momentumAfter: popularity.momentum,
        ...(reason ? { reason } : {}),
      };
    }
  }
}
