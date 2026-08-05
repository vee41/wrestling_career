import type { CardPosition, MatchResult, PopularityChangeReason, SegmentResult, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampDelta100, clampScale100, moveToward } from "./clamp.js";
import { findPopularity, requireWrestler } from "./lookups.js";
import { weekForTick, weeksSinceLastAppearance } from "./booking.js";

const IDLE_FATIGUE_RELIEF = 3;
const HEAT_MAX_STEP = 12;
const TWEENER_HEAT_MAX_STEP = 8;

// Card position scales a match's surprise signal without weakening the bounded,
// anchored popularity model. It intentionally differs from the pay
// multiplier: an opener is still a meaningful appearance, just a smaller
// stage for an upset or a damaging loss.
const CARD_POSITION_POPULARITY_WEIGHT: Record<CardPosition, number> = {
  main_event: 1.2,
  upper: 1.1,
  mid: 1,
  opener: 0.9,
};

interface Segment {
  value: number;
  performanceScore: number;
  crowdResponse: number;
  storyAdvancement: number;
}

function segmentFor(
  world: WorldState,
  performanceScore: number,
  crowdResponse: number,
  storyAdvancement: number,
  cadenceModifier = 0,
): Segment {
  const tuning = world.config.popularity;
  return {
    value: performanceScore * tuning.segmentPerformanceWeight + crowdResponse * tuning.segmentCrowdWeight + storyAdvancement * tuning.segmentStoryWeight + cadenceModifier,
    performanceScore,
    crowdResponse,
    storyAdvancement,
  };
}

/** Scarcity and overexposure are one role-defined cadence axis (GDD §10.5). */
function cadenceModifier(
  world: WorldState,
  wrestlerId: string,
  resultId: string,
  tick: number,
  fatigue: number,
): number {
  const wrestler = requireWrestler(world, wrestlerId);
  const role = world.config.roles[wrestler.role];
  const weeksOut = weeksSinceLastAppearance(world, wrestlerId, tick, resultId);
  const gapRatio = (weeksOut ?? role.idealGapWeeks) / role.idealGapWeeks;
  const tuning = world.config.popularity;

  if (gapRatio > 1) {
    const starPower = findPopularity(world, wrestlerId).starPower;
    const starHeadroom = 100 - tuning.scarcityStarPowerFloor;
    const starScale = starHeadroom === 0
      ? (starPower === 100 ? 1 : 0)
      : Math.max(0, Math.min(1, (starPower - tuning.scarcityStarPowerFloor) / starHeadroom));
    return Math.min(tuning.scarcityCrowdBonusMax, (gapRatio - 1) * tuning.scarcityCrowdBonusMax) * role.scarcityMagnitude * starScale;
  }
  if (gapRatio < 1) {
    return -Math.max(0, fatigue - tuning.overexposureFatigueFloor) * tuning.overexposurePenaltyFactor * role.overexposureSensitivity * (1 - gapRatio);
  }
  return 0;
}

/** The history is intentionally derived from results rather than becoming a new persisted stat. */
function expectedSegment(world: WorldState, wrestlerId: string, currentResultId: string, currentSegment: number): number {
  const prior = [...world.matchResults, ...world.segmentResults]
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
  // A genuinely earned status milestone is immediately legible to the
  // audience. This only closes an existing gap up to the new earned-status
  // floor; it never grants the extra hot-streak band, which remains earned
  // through subsequent performances.
  if (direction === "rise") {
    popularity.generalPopularity = Math.max(popularity.generalPopularity, popularity.starPower);
  }
  addPopularityEvent(
    world,
    ctx,
    wrestlerId,
    direction === "rise" ? "status_rise" : "status_fall",
    direction,
    summary,
    { milestone: "status", delta: popularity.starPower - before, before, after: popularity.starPower },
  );
}

/**
 * GDD §10's four-timescale popularity model. A good match only matters when
 * it exceeds what the audience had reason to expect; the earned-status anchor
 * prevents both free workrate climbs and irreversible downward ratchets.
 */
export function updatePopularity(world: WorldState, ctx: TickContext, matchResults: MatchResult[], segmentResults: SegmentResult[] = []): void {
  const appearances = new Map<string, { result: MatchResult | SegmentResult; performanceScore: number; physicalCost: number; positiveHeatDelta?: number; negativeHeatDelta?: number }>();
  const popularityAtStart = new Map(world.popularity.map((popularity) => [popularity.wrestlerId, popularity.generalPopularity]));

  for (const result of matchResults) {
    for (const performance of result.performances) {
      appearances.set(performance.wrestlerId, { result, performanceScore: performance.performanceScore, physicalCost: performance.physicalCost });
    }
  }
  for (const result of segmentResults) {
    for (const performance of result.performances) {
      appearances.set(performance.wrestlerId, {
        result, performanceScore: performance.performanceScore, physicalCost: 0,
        positiveHeatDelta: performance.positiveHeatDelta, negativeHeatDelta: performance.negativeHeatDelta,
      });
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
      const role = world.config.roles[wrestler.role];
      const weeksOut = weeksSinceLastAppearance(world, wrestler.id, ctx.tick) ?? 0;
      const relevancePenalty = role.relevanceDecay && weeksOut > world.config.popularity.relevanceGraceWeeks
        ? Math.min(world.config.popularity.relevanceDecayCap, (weeksOut - world.config.popularity.relevanceGraceWeeks) * world.config.popularity.relevanceDecayRatePerWeek)
        : 0;
      const effectiveAnchor = Math.max(world.config.popularity.relevanceHardFloor, popularity.starPower - relevancePenalty);
      popularity.generalPopularity = clampScale100(
        popularity.generalPopularity + Math.max(-1, Math.min(1, Math.round((effectiveAnchor - popularity.generalPopularity) * world.config.popularity.idleGravityFactor))),
      );
      continue;
    }

    const { result, performanceScore, physicalCost } = appearance;
    const isMatch = "matchSlotId" in result;
    // Resolve the booked position before calculating the segment. Historical
    // expectations below use the same lookup, so a main-event performance is
    // compared against the right-sized stage rather than a hidden default.
    const show = world.shows.find((candidate) => candidate.id === result.showId);
    const slot = show?.card.find((candidate) => candidate.id === (isMatch ? result.matchSlotId : result.segmentSlotId));
    const position = slot?.position ?? "mid";
    const beforePopularity = popularity.generalPopularity;
    const beforeMomentum = popularity.momentum;
    popularity.fatigue = clampScale100(popularity.fatigue + physicalCost * 0.3);

    if (appearance.positiveHeatDelta !== undefined || appearance.negativeHeatDelta !== undefined) {
      popularity.positiveHeat = clampScale100(popularity.positiveHeat + (appearance.positiveHeatDelta ?? 0));
      popularity.negativeHeat = clampScale100(popularity.negativeHeat + (appearance.negativeHeatDelta ?? 0));
    } else if (wrestler.alignment === "face") {
      popularity.positiveHeat = moveToward(popularity.positiveHeat, result.crowdResponse, HEAT_MAX_STEP);
    } else if (wrestler.alignment === "heel") {
      popularity.negativeHeat = moveToward(popularity.negativeHeat, result.crowdResponse, HEAT_MAX_STEP);
    } else {
      popularity.positiveHeat = moveToward(popularity.positiveHeat, result.crowdResponse * 0.6, TWEENER_HEAT_MAX_STEP);
      popularity.negativeHeat = moveToward(popularity.negativeHeat, result.crowdResponse * 0.4, TWEENER_HEAT_MAX_STEP);
    }

    const segment = segmentFor(
      world,
      performanceScore,
      result.crowdResponse,
      result.storyAdvancement,
      cadenceModifier(world, wrestler.id, result.id, ctx.tick, popularity.fatigue),
    ).value;
    const expected = expectedSegment(world, wrestler.id, result.id, segment);
    const opponents = result.participantWrestlerIds.filter((id) => id !== wrestler.id);
    const opponentAveragePopularity = opponents.reduce((sum, id) => sum + (popularityAtStart.get(id) ?? 0), 0) / Math.max(1, opponents.length);
    const won = isMatch && result.winnerWrestlerId === wrestler.id;
    // A segment has no winner, so the match edge would read every promo
    // participant — including a solo interview — as a clean loss to a lesser
    // opponent. An appearance is scored on its own facts instead: carrying the
    // exchange over a bigger name is a modest gain, and being the one who got
    // talked to costs nothing.
    const edge = isMatch
      ? (won
        ? Math.max(0, opponentAveragePopularity - beforePopularity) * 0.5
        : -Math.max(0, beforePopularity - opponentAveragePopularity) * 0.5 - world.config.popularity.lossEdgeBase)
      : (result.dominantWrestlerId === wrestler.id
        ? Math.max(0, opponentAveragePopularity - beforePopularity) * world.config.popularity.segmentDominantEdgeFactor
        : world.config.popularity.segmentNonDominantEdge);
    // A higher card position makes the same above- or below-expectation
    // outcome more consequential. The popularity cap remains unchanged, so
    // this strengthens the signal rather than widening every appearance's
    // maximum swing.
    const positionWeightedEdge = edge * CARD_POSITION_POPULARITY_WEIGHT[position];
    const surprise = (segment - expected + edge) * CARD_POSITION_POPULARITY_WEIGHT[position];
    popularity.momentum = clampDelta100(popularity.momentum * world.config.popularity.momentumMemoryFactor + surprise * world.config.popularity.momentumSurpriseFactor);
    popularity.currentReaction = moveToward(popularity.currentReaction, segment, world.config.popularity.reactionMaxStep);

    const gravity = (popularity.starPower - beforePopularity) * world.config.popularity.gravityFactor;
    // A hot crowd response can temporarily outrun a wrestler's established
    // status, but it cannot turn an ordinary win streak into permanent top
    // of card popularity. The band is scenario-owned so a promotion can tune
    // how much short-term buzz it permits above earned status.
    const popularityCeiling = Math.min(100, popularity.starPower + world.config.popularity.popularityBand);
    const headroom = popularity.momentum >= 0
      ? Math.max(0, Math.min(1, (popularityCeiling - beforePopularity) / world.config.popularity.popularityBand))
      : beforePopularity / 100;
    const push = popularity.momentum * world.config.popularity.momentumPushFactor * headroom;
    // A card position influences both the immediate surprise and the amount
    // of that momentum that becomes durable popularity. The shared cap still
    // bounds every appearance, preserving the anchored model's stability.
    const positionWeightedPush = push * CARD_POSITION_POPULARITY_WEIGHT[position];
    popularity.generalPopularity = clampScale100(beforePopularity + Math.max(-world.config.popularity.popularityMaxStep, Math.min(world.config.popularity.popularityMaxStep, Math.round(gravity + positionWeightedPush))));

    let ignition = false;
    if (ctx.rng.fork(`moment:${wrestler.id}`).chance(world.config.popularity.crowdIgnitionChance)) {
      ignition = true;
      popularity.momentum = clampDelta100(popularity.momentum + ctx.rng.fork(`moment-strength:${wrestler.id}`).int(world.config.popularity.crowdIgnitionMomentumMin, world.config.popularity.crowdIgnitionMomentumMax));
      popularity.currentReaction = clampScale100(popularity.currentReaction + 10);
    }

    if (isMatch && show?.kind === "ple" && slot?.position === "main_event" && result.crowdResponse >= 70) {
      adjustStarPower(world, ctx, wrestler.id, world.config.popularity.pleMainEventStarPowerGain, `${wrestler.name} leaves the major main event with elevated status.`);
    }
    if (won && opponents.some((opponentId) => {
      const opponentRole = requireWrestler(world, opponentId).role;
      return opponentRole === "legend" || opponentRole === "part_timer";
    })) {
      adjustStarPower(world, ctx, wrestler.id, world.config.popularity.rubStarPowerGain, `${wrestler.name} gained lasting status by defeating a rare-appearance star.`);
    }
    // Sustained positive momentum is deliberately temporary: durable status
    // must be earned through a title, major main event, or rare-opponent rub.
    // A sustained slump still damages status, because falling remains an
    // active career outcome rather than merely a reversal of a hot streak.
    if (popularity.momentum <= -25 && heldMomentumForThreeWeeks(world, wrestler.id, ctx.tick, "fall")) {
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
      else if (positionWeightedEdge >= 15) reason = "upset";
      else if (positionWeightedEdge <= -15) reason = "burial";
      else if (segment - expected >= 15 || delta > 0 || crossedPositive) reason = "breakout";
      // An appearance with no competitive result cannot be a burial — nobody
      // was beaten. With no signal above, a routine promo is quiet drift and
      // reports nothing, exactly like an unremarkable match night.
      else if (isMatch) reason = "burial";
    }
    if (reason !== undefined) {
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
      addPopularityEvent(world, ctx, wrestler.id, reason, direction, summaries[reason], { momentum: popularity.momentum, delta, before: beforePopularity, after: popularity.generalPopularity });
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
        edge: positionWeightedEdge,
        momentumBefore: beforeMomentum,
        momentumAfter: popularity.momentum,
        ...(reason ? { reason } : {}),
      };
    }
  }
}
