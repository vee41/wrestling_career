import type { ExecutionDeviationCause, FinishFamily, MatchIntent, MatchResult, MatchSlot, Show, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampScale100 } from "./clamp.js";
import { findStance, findStory, requireWrestler } from "./lookups.js";
import { defaultMatchIntent } from "./ai/stance-weights.js";
import { dominantParticipant, intentsConflict } from "./dominance.js";
import { absenceWeeks, clearanceTick, injurySeverity, isAvailable } from "./injury.js";

// Spec §6.4: "whose intent dominates the ring" is a contest weighted by
// psychology + professionalism (plus condition/experience). `experience` has
// no dedicated stat (GDD §7's eight skills don't include one) — this phase
// approximates it as the wrestler's own overall skill average.
// How hard an intent pushes the match away from a cooperative, planned flow.
// Two participants whose intents are far apart on this axis (e.g.
// `steal_spotlight` vs `follow_plan`) are "conflicting" per spec §6.4.
const ASSERTIVENESS: Record<MatchIntent, number> = {
  follow_plan: -0.5,
  work_safely: -0.2,
  elevate_opponent: -0.3,
  protect_character: 0.3,
  advance_story: 0.2,
  play_to_crowd: 0.4,
  chase_quality: 0.5,
  take_risks: 0.7,
  steal_spotlight: 0.9,
};

const APPEARANCE_PAY_BASE = 30;
const CROWD_PAY_FACTOR = 0.5;

export const CARD_POSITION_MULTIPLIER = {
  main_event: 1.3,
  upper: 1.15,
  mid: 1,
  opener: 0.8,
} as const;

function resolveIntent(world: WorldState, slot: MatchSlot, wrestlerId: string): MatchIntent {
  return slot.intents[wrestlerId] ?? defaultMatchIntent(findStance(world, wrestlerId).stance);
}

export function resolveMatch(world: WorldState, show: Show, slot: MatchSlot, ctx: TickContext): MatchResult {
  const tuning = world.config.match;
  const participants = slot.participantWrestlerIds.map((id) => requireWrestler(world, id));
  const story = slot.storyId ? findStory(world, slot.storyId) : undefined;
  const rng = ctx.rng.fork(`match:${slot.id}`);
  const intents = participants.map((p) => resolveIntent(world, slot, p.id));
  const assertiveness = intents.map((i) => ASSERTIVENESS[i]);

  const dominantIdx = dominantParticipant(participants, rng);
  const hasConflict = intentsConflict(assertiveness);

  const rawScores = participants.map((p, i) => {
    const base =
      p.skills.ringPerformance * tuning.ringPerformanceWeight +
      p.skills.psychology * tuning.psychologyWeight +
      p.skills.athleticism * tuning.athleticismWeight +
      p.condition * tuning.conditionWeight;
    const storyBonus = story ? story.momentum * tuning.storyMomentumFactor : 0;
    const intentBonus = (assertiveness[i] ?? 0) * tuning.intentAssertivenessFactor;
    return base + storyBonus + intentBonus + rng.float(-tuning.performanceVariance, tuning.performanceVariance);
  });

  let performanceWinnerIdx = 0;
  rawScores.forEach((s, i) => {
    if (s > (rawScores[performanceWinnerIdx] ?? Number.NEGATIVE_INFINITY)) performanceWinnerIdx = i;
  });
  // Booking already excluded anyone who was not cleared, so the only way a
  // participant is unavailable *now* is an injury earlier on tonight's card.
  const hurtTonight = new Set(participants.filter((p) => !isAvailable(world, p)).map((p) => p.id));
  const execution = matchExecution(slot, participants, intents, hasConflict, dominantIdx, performanceWinnerIdx, hurtTonight, rng);
  const winnerIdx = execution.winnerIdx;

  const avgProfessionalism = participants.reduce((s, p) => s + p.skills.professionalism, 0) / participants.length;
  const avgPsychology = participants.reduce((s, p) => s + p.skills.psychology, 0) / participants.length;
  const chemistry = clampScale100(avgProfessionalism * 0.6 + avgPsychology * 0.4 + rng.int(-5, 5));

  const avgRaw = rawScores.reduce((s, v) => s + v, 0) / rawScores.length;
  const quality = clampScale100(avgRaw * tuning.qualityRawScoreWeight + chemistry * tuning.qualityChemistryWeight);
  const crowdResponse = clampScale100(quality * tuning.crowdQualityWeight + (story ? story.audienceInterest * tuning.crowdStoryInterestWeight : tuning.crowdNoStoryBase) + rng.int(-tuning.crowdVariance, tuning.crowdVariance));
  const storyAdvancement = story ? clampScale100(quality * 0.3 + Math.abs(story.momentum) * 0.1 + rng.int(0, 15)) : 0;

  const performances = participants.map((p, i) => {
    const dominant = i === dominantIdx;
    const wentOffScriptAndLost = hasConflict && !dominant && (assertiveness[i] ?? 0) > 0;
    const wentOffScriptAndWon = hasConflict && dominant && (assertiveness[i] ?? 0) > 0;

    let characterCredibilityDelta = Math.round((rawScores[i] ?? 0) - avgRaw) / 4;
    if (wentOffScriptAndWon) characterCredibilityDelta += 8;
    if (wentOffScriptAndLost) characterCredibilityDelta -= 10;
    characterCredibilityDelta = Math.max(-100, Math.min(100, Math.round(characterCredibilityDelta)));

    const physicalCost = clampScale100(20 + (assertiveness[i] ?? 0) * 15 + rng.int(-5, 10));

    let gmReactionDelta = Math.round(((rawScores[i] ?? 0) - 50) / 5);
    if (dominant) gmReactionDelta += 3;
    if (wentOffScriptAndLost) gmReactionDelta -= 3;
    gmReactionDelta = Math.max(-100, Math.min(100, gmReactionDelta));

    let backstageReactionDelta = 0;
    if (intents[i] === "follow_plan" || intents[i] === "protect_character") backstageReactionDelta += 4;
    if (wentOffScriptAndLost) backstageReactionDelta -= 8;
    if (wentOffScriptAndWon) backstageReactionDelta -= 2;
    backstageReactionDelta = Math.max(-100, Math.min(100, backstageReactionDelta));

    return {
      wrestlerId: p.id,
      performanceScore: clampScale100(rawScores[i] ?? 0),
      characterCredibilityDelta,
      physicalCost,
      gmReactionDelta,
      backstageReactionDelta,
    };
  });

  // A protected loser may still lose the match, but not the credibility the
  // program is deliberately preserving for a later beat/payoff.
  for (const performance of performances) {
    if (slot.plannedFinish?.protectedWrestlerIds.includes(performance.wrestlerId) && performance.wrestlerId !== participants[winnerIdx]?.id) {
      performance.characterCredibilityDelta = Math.max(performance.characterCredibilityDelta, -2);
    }
  }

  const winner = participants[winnerIdx];
  if (!winner) throw new Error(`match slot "${slot.id}" has no participants`);

  const result: MatchResult = {
    id: ctx.ids.next("match"),
    matchSlotId: slot.id,
    showId: show.id,
    participantWrestlerIds: participants.map((p) => p.id),
    winnerWrestlerId: winner.id,
    quality,
    crowdResponse,
    chemistry,
    ...(story ? { storyId: story.id } : {}),
    ...(slot.programId === undefined ? {} : { programId: slot.programId }),
    ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }),
    ...(slot.plannedFinish === undefined ? {} : {
      plannedFinish: slot.plannedFinish,
      actualOutcome: {
        winnerWrestlerId: winner.id,
        finishFamily: execution.finishFamily,
        titleConsequence: titleConsequence(world, slot, winner.id, execution.finishFamily, execution.deviationCause),
        storyEffect: execution.deviationCause === undefined ? slot.plannedFinish.intendedStoryEffect : "Execution disruption requires the program to replan.",
      },
      adherence: execution.deviationCause === undefined ? "adhered" : "deviated",
      ...(execution.deviationCause === undefined ? {} : { deviationCause: execution.deviationCause }),
    }),
    storyAdvancement,
    performances,
  };

  world.matchResults.push(result);
  // GDD §8: money is earned through appearances — every participant gets
  // appearance pay, with a bonus scaled by how hot the crowd was. This is
  // the earn side of the economy; the spend side is the explicit `invest`
  // flag on actions (resolve-actions.ts).
  const pay = Math.round((APPEARANCE_PAY_BASE + crowdResponse * CROWD_PAY_FACTOR) * CARD_POSITION_MULTIPLIER[slot.position]);
  const payouts: Record<string, number> = {};
  for (const p of participants) {
    const perf = performances.find((r) => r.wrestlerId === p.id);
    const conditionBefore = p.condition;
    // A full match still costs a wrestler, but the prior 0.5 multiplier
    // made almost every regular TV act unbookable before the slice's midpoint.
    p.condition = clampScale100(p.condition - (perf?.physicalCost ?? 0) * 0.35);
    p.money += pay;
    payouts[p.id] = pay;

    // Injuries stay a strain threshold rather than a taxonomy, and there is now
    // exactly one: the match drove this wrestler under the line at which they
    // can be booked. Nobody works a match from below it any more, so the old
    // "already critical" second clause was unreachable. What the injury *costs*
    // is the absence, and how far under the line it left them decides that.
    const health = world.config.health;
    if (p.condition < health.bookableCondition && conditionBefore >= health.bookableCondition) {
      const severity = injurySeverity(world.config, p.condition, perf?.physicalCost ?? 0);
      const weeks = absenceWeeks(world.config, severity);
      const clearance = clearanceTick(ctx.tick, weeks, world.config);
      // Absences never shorten: a second injury during an existing one extends
      // the layoff rather than resetting the clock to the lighter of the two.
      p.unavailableUntilTick = Math.max(p.unavailableUntilTick ?? 0, clearance);
      addEvent(world, ctx, {
        type: "injury",
        summary: `${p.name} is hurt after the match — a ${severity} injury that costs ${weeks === 1 ? "a week" : `${weeks} weeks`} out of the ring.`,
        wrestlerIds: [p.id],
        matchId: result.id,
        showId: show.id,
        data: { condition: p.condition, severity, absenceWeeks: weeks, unavailableUntilTick: p.unavailableUntilTick },
      });
    }
  }

  addEvent(world, ctx, {
    type: "match_result",
    summary: `${winner.name} defeated ${participants
      .filter((p) => p.id !== winner.id)
      .map((p) => p.name)
      .join(" and ")}.`,
    wrestlerIds: participants.map((p) => p.id),
    ...(story ? { storyId: story.id } : {}),
    matchId: result.id,
    showId: show.id,
    data: { quality, crowdResponse, position: slot.position, payouts, ...(slot.programId === undefined ? {} : { programId: slot.programId }), ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }), ...(slot.plannedFinish === undefined ? {} : { plannedFinish: slot.plannedFinish, actualOutcome: { winnerWrestlerId: winner.id, finishFamily: execution.finishFamily }, adherence: execution.deviationCause === undefined ? "adhered" : "deviated", ...(execution.deviationCause === undefined ? {} : { deviationCause: execution.deviationCause }) }) },
  });

  if (execution.deviationCause !== undefined) {
    addEvent(world, ctx, {
      type: "execution_deviation",
      summary: `The planned finish for this match changed because of ${execution.deviationCause.replace(/_/g, " ")}.`,
      wrestlerIds: participants.map((p) => p.id),
      ...(story ? { storyId: story.id } : {}), matchId: result.id, showId: show.id,
      data: { plannedFinish: slot.plannedFinish, actualWinnerWrestlerId: winner.id, deviationCause: execution.deviationCause, ...(slot.programId === undefined ? {} : { programId: slot.programId }) },
    });
  }

  return result;
}

function titleConsequence(
  world: WorldState,
  slot: MatchSlot,
  winnerId: string,
  finishFamily: FinishFamily,
  deviationCause: ExecutionDeviationCause | undefined,
): "change" | "retain" | "none" {
  // The planned consequence, not an incidental in-ring score, controls title
  // lineage. A disrupted no-contest never creates a phantom title change.
  if (finishFamily === "no_contest") return "none";
  const holder = slot.titleId === undefined ? undefined : world.titles.find((title) => title.id === slot.titleId)?.holderId;
  if (slot.plannedFinish !== undefined) {
    if (deviationCause === undefined) return slot.plannedFinish.intendedTitleConsequence;
    // Phase 3.12.5: a finish that did not go as booked cannot move a belt. The
    // champion walks out still champion and the planner decides on the replan
    // whether the challenger has earned another shot — a title change is a
    // creative decision, never the side effect of somebody getting hurt.
    return holder === undefined ? "none" : "retain";
  }
  return holder === undefined ? "none" : holder === winnerId ? "retain" : "change";
}

function matchExecution(
  slot: MatchSlot,
  participants: readonly { id: string }[],
  intents: readonly MatchIntent[],
  hasConflict: boolean,
  dominantIdx: number,
  performanceWinnerIdx: number,
  hurtTonight: ReadonlySet<string>,
  rng: { chance(probability: number): boolean },
): { winnerIdx: number; finishFamily: FinishFamily; deviationCause?: ExecutionDeviationCause } {
  const planned = slot.plannedFinish;
  if (planned === undefined) return { winnerIdx: performanceWinnerIdx, finishFamily: "clean" };
  const intendedIdx = participants.findIndex((participant) => participant.id === planned.intendedWinnerWrestlerId);
  if (intendedIdx < 0) return { winnerIdx: performanceWinnerIdx, finishFamily: planned.finishFamily, deviationCause: "refusal" };
  const alternate = performanceWinnerIdx === intendedIdx ? (intendedIdx + 1) % participants.length : performanceWinnerIdx;
  // An injury deviation now means the planned winner actually got hurt tonight,
  // not merely that they are worn down — which is what makes it rare and loud.
  if (hurtTonight.has(participants[intendedIdx]?.id ?? "")) {
    return { winnerIdx: alternate, finishFamily: planned.finishFamily, deviationCause: "injury" };
  }
  const refusalIdx = intents.findIndex((intent, index) => index !== intendedIdx && intent === "protect_character");
  if (refusalIdx >= 0) return { winnerIdx: refusalIdx, finishFamily: planned.finishFamily, deviationCause: "refusal" };
  if (hasConflict && dominantIdx !== intendedIdx && intents[dominantIdx] === "steal_spotlight") {
    return { winnerIdx: dominantIdx, finishFamily: planned.finishFamily, deviationCause: "dominant_conflicting_intent" };
  }
  if (planned.finishFamily === "interference" && planned.adherenceStrength !== "strict" && rng.chance(0.15)) {
    return { winnerIdx: intendedIdx, finishFamily: "clean", deviationCause: "failed_interference" };
  }
  return { winnerIdx: intendedIdx, finishFamily: planned.finishFamily };
}

export function resolveShow(world: WorldState, show: Show, ctx: TickContext): MatchResult[] {
  return show.card.filter((slot): slot is MatchSlot => slot.kind !== "segment").map((slot) => resolveMatch(world, show, slot, ctx));
}
