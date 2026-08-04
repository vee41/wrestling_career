import type { ExecutionDeviationCause, SegmentIntent, SegmentResult, SegmentSlot, Show, WorldState } from "@wrestling/contracts";
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
const INJURY_CONDITION_THRESHOLD = 40;

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
  const naturalDominantIndex = dominantParticipant(participants, rng);
  const conflict = intentsConflict(assertiveness);
  const execution = segmentExecution(slot, participants, intents, conflict, naturalDominantIndex);
  const dominantIndex = execution.dominantIndex;
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
    ...(slot.programId === undefined ? {} : { programId: slot.programId }),
    ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }),
    ...(slot.plannedOutcome === undefined ? {} : {
      plannedOutcome: slot.plannedOutcome,
      actualOutcome: {
        dominantWrestlerId: participants[dominantIndex]!.id,
        heatDirection: execution.deviationCause === undefined ? slot.plannedOutcome.intendedHeatDirection : heatDirection(intents[dominantIndex]!),
        storyEffect: execution.deviationCause === undefined ? slot.plannedOutcome.intendedStoryEffect : "Execution disruption requires the program to replan.",
      },
      adherence: execution.deviationCause === undefined ? "adhered" : "deviated",
      ...(execution.deviationCause === undefined ? {} : { deviationCause: execution.deviationCause }),
    }),
    intents: Object.fromEntries(participants.map((participant, index) => [participant.id, intents[index]!])),
    performances,
  };
  world.segmentResults.push(result);
  addEvent(world, ctx, {
    type: "segment_result",
    summary: `${participants[dominantIndex]!.name} carried a ${slot.storyId ? "story" : "non-match"} segment${story ? ` for "${story.tensionDescription}"` : ""}.`,
    wrestlerIds: result.participantWrestlerIds, ...(story ? { storyId: story.id } : {}), matchId: result.id, showId: show.id,
    data: { quality, crowdResponse, position: slot.position, dominantWrestlerId: result.dominantWrestlerId, ...(slot.programId === undefined ? {} : { programId: slot.programId }), ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }), ...(slot.plannedOutcome === undefined ? {} : { plannedOutcome: slot.plannedOutcome, actualOutcome: { dominantWrestlerId: result.dominantWrestlerId, heatDirection: execution.deviationCause === undefined ? slot.plannedOutcome.intendedHeatDirection : heatDirection(intents[dominantIndex]!) }, adherence: execution.deviationCause === undefined ? "adhered" : "deviated", ...(execution.deviationCause === undefined ? {} : { deviationCause: execution.deviationCause }) }) },
  });
  if (execution.deviationCause !== undefined) {
    addEvent(world, ctx, {
      type: "execution_deviation",
      summary: `The planned segment outcome changed because of ${execution.deviationCause.replace(/_/g, " ")}.`,
      wrestlerIds: result.participantWrestlerIds, ...(story ? { storyId: story.id } : {}), matchId: result.id, showId: show.id,
      data: { plannedOutcome: slot.plannedOutcome, actualDominantWrestlerId: result.dominantWrestlerId, deviationCause: execution.deviationCause, ...(slot.programId === undefined ? {} : { programId: slot.programId }) },
    });
  }
  return result;
}

function heatDirection(intent: SegmentIntent): "positive" | "negative" | "mixed" | "neutral" {
  if (intent === "build_sympathy" || intent === "show_vulnerability" || intent === "promote_opponent") return "positive";
  if (intent === "generate_hostility" || intent === "seek_controversy") return "negative";
  if (intent === "escalate_rivalry") return "mixed";
  return "neutral";
}

function segmentExecution(
  slot: SegmentSlot,
  participants: readonly { id: string; condition: number }[],
  intents: readonly SegmentIntent[],
  conflict: boolean,
  naturalDominantIndex: number,
): { dominantIndex: number; deviationCause?: ExecutionDeviationCause } {
  const planned = slot.plannedOutcome;
  if (planned === undefined) return { dominantIndex: naturalDominantIndex };
  const intended = participants.findIndex((participant) => participant.id === planned.intendedDominantWrestlerId);
  if (intended < 0) return { dominantIndex: naturalDominantIndex, deviationCause: "refusal" };
  const alternate = naturalDominantIndex === intended ? (intended + 1) % participants.length : naturalDominantIndex;
  if ((participants[intended]?.condition ?? 0) < INJURY_CONDITION_THRESHOLD) return { dominantIndex: alternate, deviationCause: "injury" };
  const refusal = intents.findIndex((intent, index) => index !== intended && intent === "protect_mystery");
  if (refusal >= 0) return { dominantIndex: refusal, deviationCause: "refusal" };
  if (conflict && naturalDominantIndex !== intended && intents[naturalDominantIndex] === "seek_controversy") {
    return { dominantIndex: naturalDominantIndex, deviationCause: "dominant_conflicting_intent" };
  }
  return { dominantIndex: intended };
}

export function resolveSegments(world: WorldState, show: Show, ctx: TickContext): SegmentResult[] {
  return show.card.filter((slot): slot is SegmentSlot => slot.kind === "segment").map((slot) => resolveSegment(world, show, slot, ctx));
}
