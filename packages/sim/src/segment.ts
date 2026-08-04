import type { SegmentIntent, SegmentResult, SegmentSlot, Show, WorldState, Wrestler } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampScale100 } from "./clamp.js";
import { dominantParticipant, intentsConflict } from "./dominance.js";
import { defaultSegmentIntent } from "./ai/stance-weights.js";
import { findStance, findStory, requireWrestler } from "./lookups.js";

const ASSERTIVENESS: Record<SegmentIntent, number> = {
  stay_controlled: -0.5,
  protect_mystery: -0.3,
  promote_opponent: -0.2,
  build_sympathy: 0.1,
  show_vulnerability: 0.15,
  escalate_rivalry: 0.4,
  generate_hostility: 0.55,
  seek_controversy: 0.8,
};

function resolveIntent(world: WorldState, slot: SegmentSlot, wrestlerId: string): SegmentIntent {
  return slot.intents[wrestlerId] ?? defaultSegmentIntent(findStance(world, wrestlerId).stance);
}

function heatForIntent(intent: SegmentIntent, dominance: boolean): { positive: number; negative: number; advancement: number } {
  const carried = dominance ? 1 : 0.45;
  switch (intent) {
    case "build_sympathy": return { positive: Math.round(10 * carried), negative: 0, advancement: 4 };
    case "show_vulnerability": return { positive: Math.round(8 * carried), negative: 0, advancement: 6 };
    case "generate_hostility": return { positive: 0, negative: Math.round(10 * carried), advancement: 4 };
    case "seek_controversy": return { positive: 0, negative: Math.round(8 * carried), advancement: 6 };
    case "promote_opponent": return { positive: Math.round(2 * carried), negative: 0, advancement: 10 };
    case "escalate_rivalry": return { positive: 0, negative: Math.round(2 * carried), advancement: 12 };
    case "protect_mystery":
    case "stay_controlled": return { positive: 0, negative: 0, advancement: 2 };
  }
}

/** Resolve a promo/angle without assigning a competitive winner or physical cost. */
export function resolveSegment(world: WorldState, show: Show, slot: SegmentSlot, ctx: TickContext): SegmentResult {
  const participants = slot.participantWrestlerIds.map((id) => requireWrestler(world, id));
  const story = slot.storyId ? findStory(world, slot.storyId) : undefined;
  const rng = ctx.rng.fork(`segment:${slot.id}`);
  const intents = participants.map((participant) => resolveIntent(world, slot, participant.id));
  const assertiveness = intents.map((intent) => ASSERTIVENESS[intent]);
  const dominantIndex = dominantParticipant(participants, rng);
  const conflict = intentsConflict(assertiveness);
  const rawScores = participants.map((participant, index) => (
    participant.skills.promoAbility * 0.45 +
    participant.skills.characterWork * 0.3 +
    participant.skills.psychology * 0.2 +
    participant.condition * 0.05 +
    (assertiveness[index] ?? 0) * 8 +
    (story?.momentum ?? 0) * 0.06 +
    rng.float(-8, 8)
  ));
  const average = rawScores.reduce((sum, score) => sum + score, 0) / rawScores.length;
  const quality = clampScale100(average);
  const crowdResponse = clampScale100(quality * 0.6 + (story ? story.audienceInterest * 0.35 : 12) + rng.int(-6, 6));
  const performances = participants.map((participant, index) => {
    const dominant = index === dominantIndex;
    const mapping = heatForIntent(intents[index]!, dominant);
    // An unsuccessful power play does not make a second winner, but lowers
    // how much that wrestler's intended heat shift lands.
    const conflictPenalty = conflict && !dominant && (assertiveness[index] ?? 0) > 0.3 ? 0.5 : 1;
    return {
      wrestlerId: participant.id,
      performanceScore: clampScale100(rawScores[index] ?? 0),
      positiveHeatDelta: Math.round(mapping.positive * conflictPenalty),
      negativeHeatDelta: Math.round(mapping.negative * conflictPenalty),
      storyAdvancement: clampScale100(Math.round(mapping.advancement * conflictPenalty)),
    };
  });
  const storyAdvancement = story
    ? clampScale100(Math.round(performances.reduce((sum, performance) => sum + performance.storyAdvancement, 0) / performances.length + quality * 0.15))
    : 0;
  const result: SegmentResult = {
    id: ctx.ids.next("segment"), segmentSlotId: slot.id, showId: show.id,
    participantWrestlerIds: participants.map((participant) => participant.id),
    dominantWrestlerId: participants[dominantIndex]!.id, quality, crowdResponse,
    ...(story ? { storyId: story.id } : {}), storyAdvancement,
    intents: Object.fromEntries(participants.map((participant, index) => [participant.id, intents[index]!])),
    performances,
  };
  world.segmentResults.push(result);
  addEvent(world, ctx, {
    type: "segment_result",
    summary: `${participants[dominantIndex]!.name} carried a ${slot.storyId ? "story" : "non-match"} segment${story ? ` for "${story.tensionDescription}"` : ""}.`,
    wrestlerIds: result.participantWrestlerIds, ...(story ? { storyId: story.id } : {}), matchId: result.id, showId: show.id,
    data: { quality, crowdResponse, position: slot.position, dominantWrestlerId: result.dominantWrestlerId },
  });
  return result;
}

export function resolveSegments(world: WorldState, show: Show, ctx: TickContext): SegmentResult[] {
  return show.card.filter((slot): slot is SegmentSlot => slot.kind === "segment").map((slot) => resolveSegment(world, show, slot, ctx));
}
