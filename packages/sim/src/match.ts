import type { MatchIntent, MatchResult, MatchSlot, Show, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampScale100 } from "./clamp.js";
import { findStance, findStory, requireWrestler } from "./lookups.js";
import { defaultMatchIntent } from "./ai/stance-weights.js";

// Spec §6.4: "whose intent dominates the ring" is a contest weighted by
// psychology + professionalism (plus condition/experience). `experience` has
// no dedicated stat (GDD §7's eight skills don't include one) — this phase
// approximates it as the wrestler's own overall skill average.
function ringIq(w: Wrestler): number {
  const skills = Object.values(w.skills);
  const experienceProxy = skills.reduce((sum, v) => sum + v, 0) / skills.length;
  return w.skills.psychology * 0.4 + w.skills.professionalism * 0.4 + w.condition * 0.1 + experienceProxy * 0.1;
}

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

const CONFLICT_THRESHOLD = 0.6;

const APPEARANCE_PAY_BASE = 30;
const CROWD_PAY_FACTOR = 0.5;
const INJURY_CONDITION_THRESHOLD = 25;

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
  const participants = slot.participantWrestlerIds.map((id) => requireWrestler(world, id));
  const story = slot.storyId ? findStory(world, slot.storyId) : undefined;
  const rng = ctx.rng.fork(`match:${slot.id}`);
  const intents = participants.map((p) => resolveIntent(world, slot, p.id));
  const assertiveness = intents.map((i) => ASSERTIVENESS[i]);

  let dominantIdx = 0;
  let dominantScore = Number.NEGATIVE_INFINITY;
  participants.forEach((p, i) => {
    const score = ringIq(p) + rng.float(-8, 8);
    if (score > dominantScore) {
      dominantScore = score;
      dominantIdx = i;
    }
  });

  const maxAssert = Math.max(...assertiveness);
  const minAssert = Math.min(...assertiveness);
  const hasConflict = maxAssert - minAssert > CONFLICT_THRESHOLD;

  const rawScores = participants.map((p, i) => {
    const base =
      p.skills.ringPerformance * 0.35 +
      p.skills.psychology * 0.25 +
      p.skills.athleticism * 0.2 +
      p.condition * 0.2;
    const storyBonus = story ? story.momentum * 0.08 : 0;
    const intentBonus = (assertiveness[i] ?? 0) * 8;
    return base + storyBonus + intentBonus + rng.float(-10, 10);
  });

  let winnerIdx = 0;
  rawScores.forEach((s, i) => {
    if (s > (rawScores[winnerIdx] ?? Number.NEGATIVE_INFINITY)) winnerIdx = i;
  });

  const avgProfessionalism = participants.reduce((s, p) => s + p.skills.professionalism, 0) / participants.length;
  const avgPsychology = participants.reduce((s, p) => s + p.skills.psychology, 0) / participants.length;
  const chemistry = clampScale100(avgProfessionalism * 0.6 + avgPsychology * 0.4 + rng.int(-5, 5));

  const avgRaw = rawScores.reduce((s, v) => s + v, 0) / rawScores.length;
  const quality = clampScale100(avgRaw * 0.7 + chemistry * 0.3);
  const crowdResponse = clampScale100(quality * 0.5 + (story ? story.audienceInterest * 0.3 : 10) + rng.int(-8, 8));
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
    p.condition = clampScale100(p.condition - (perf?.physicalCost ?? 0) * 0.5);
    p.money += pay;
    payouts[p.id] = pay;

    // PLAN Phase 2 simplification: injuries are a strain threshold, not a
    // taxonomy — crossing it while taking real physical cost is "an injury".
    if (p.condition < INJURY_CONDITION_THRESHOLD && conditionBefore >= INJURY_CONDITION_THRESHOLD) {
      addEvent(world, ctx, {
        type: "injury",
        summary: `${p.name} is banged up after the match and will need to manage a reduced condition.`,
        wrestlerIds: [p.id],
        matchId: result.id,
        showId: show.id,
        data: { condition: p.condition },
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
    data: { quality, crowdResponse, position: slot.position, payouts },
  });

  return result;
}

export function resolveShow(world: WorldState, show: Show, ctx: TickContext): MatchResult[] {
  return show.card.map((slot) => resolveMatch(world, show, slot, ctx));
}
