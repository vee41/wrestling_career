import type { Alignment, ExecutionDeviationCause, PlannedSegmentOutcome, SegmentIntent, SegmentResult, SegmentSlot, Show, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampScale100 } from "./clamp.js";
import { dominantParticipant, intentsConflict } from "./dominance.js";
import { defaultSegmentIntent } from "./ai/stance-weights.js";
import { findStance, findStory, requireWrestler } from "./lookups.js";
import { isAvailable } from "./injury.js";

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

type HeatDirection = PlannedSegmentOutcome["intendedHeatDirection"];

function resolveIntent(world: WorldState, slot: SegmentSlot, wrestlerId: string): SegmentIntent {
  return slot.intents[wrestlerId] ?? defaultSegmentIntent(findStance(world, wrestlerId).stance);
}

/**
 * How much crowd heat an intent moves, which way it points, and how much story
 * it advances. The magnitude belongs to the performance; `direction` only says
 * which side the intent plays to — `heatPool` below turns that into love or
 * hostility for this particular character.
 */
const HEAT_INTENT: Record<SegmentIntent, { magnitude: number; direction: HeatDirection; advancement: number }> = {
  build_sympathy: { magnitude: 10, direction: "positive", advancement: 4 },
  show_vulnerability: { magnitude: 8, direction: "positive", advancement: 6 },
  promote_opponent: { magnitude: 2, direction: "positive", advancement: 10 },
  generate_hostility: { magnitude: 10, direction: "negative", advancement: 4 },
  seek_controversy: { magnitude: 8, direction: "negative", advancement: 6 },
  escalate_rivalry: { magnitude: 2, direction: "mixed", advancement: 12 },
  protect_mystery: { magnitude: 0, direction: "neutral", advancement: 2 },
  stay_controlled: { magnitude: 0, direction: "neutral", advancement: 2 },
};

/**
 * Heat direction → which crowd pool an appearance moves, by alignment:
 *
 * | direction  | face             | heel             | tweener        |
 * | ---------- | ---------------- | ---------------- | -------------- |
 * | `positive` | positive heat    | positive heat    | positive heat  |
 * | `negative` | negative heat    | negative heat    | negative heat  |
 * | `mixed`    | positive heat    | negative heat    | split evenly   |
 * | `neutral`  | no heat move     | no heat move     | no heat move   |
 *
 * `positive` and `negative` are stated choices, so they land as played even
 * against alignment — that is how a face who keeps seeking controversy earns
 * the boos the director later reads as a turn. `mixed` states no side, so the
 * character resolves it: a face escalating a rivalry is cheered for it and a
 * heel is booed for it. That row is the common one (`escalate_rivalry` is the
 * default segment intent of two stances, and the planner's `confrontation`
 * beat asks for it), and treating it as hostility for everyone is what left
 * every face in a weekly program accumulating only negative heat.
 */
function heatPool(direction: HeatDirection, alignment: Alignment, magnitude: number): { positive: number; negative: number } {
  const resolved = direction === "mixed" && alignment !== "tweener" ? (alignment === "face" ? "positive" : "negative") : direction;
  switch (resolved) {
    case "positive": return { positive: Math.round(magnitude), negative: 0 };
    case "negative": return { positive: 0, negative: Math.round(magnitude) };
    case "mixed": return { positive: Math.round(magnitude * 0.5), negative: Math.round(magnitude * 0.5) };
    case "neutral": return { positive: 0, negative: 0 };
  }
}

/**
 * A booked beat's `intendedHeatDirection` speaks for the wrestler it books as
 * dominant, and only while the segment actually ran as booked; everyone else —
 * and every deviated segment — reads through the intent that was performed.
 */
function heatDirectionFor(slot: SegmentSlot, wrestlerId: string, intent: SegmentIntent, adhered: boolean): HeatDirection {
  const planned = slot.plannedOutcome;
  return planned !== undefined && adhered && planned.intendedDominantWrestlerId === wrestlerId
    ? planned.intendedHeatDirection
    : HEAT_INTENT[intent].direction;
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
  // Booking excluded anyone who was not cleared, so an unavailable participant
  // here was hurt earlier on tonight's card (see match.ts).
  const hurtTonight = new Set(participants.filter((participant) => !isAvailable(world, participant)).map((participant) => participant.id));
  const execution = segmentExecution(slot, participants, intents, conflict, naturalDominantIndex, hurtTonight);
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
  const adhered = execution.deviationCause === undefined;
  const performances = participants.map((participant, index) => {
    const dominant = index === dominantIndex;
    const intent = intents[index]!;
    const mapping = HEAT_INTENT[intent];
    // An unsuccessful power play does not make a second winner, but lowers
    // how much that wrestler's intended heat shift lands.
    const conflictPenalty = conflict && !dominant && (assertiveness[index] ?? 0) > 0.3 ? 0.5 : 1;
    const heat = heatPool(
      heatDirectionFor(slot, participant.id, intent, adhered),
      participant.alignment,
      mapping.magnitude * (dominant ? 1 : 0.45) * conflictPenalty,
    );
    return {
      wrestlerId: participant.id,
      performanceScore: clampScale100(rawScores[index] ?? 0),
      positiveHeatDelta: heat.positive,
      negativeHeatDelta: heat.negative,
      storyAdvancement: clampScale100(Math.round(mapping.advancement * conflictPenalty)),
    };
  });
  const storyAdvancement = story
    ? clampScale100(Math.round(performances.reduce((sum, performance) => sum + performance.storyAdvancement, 0) / performances.length + quality * 0.15))
    : 0;
  // The direction the segment actually played to, which is also the one the
  // dominant participant's heat was scored against above.
  const airedHeatDirection = heatDirectionFor(slot, participants[dominantIndex]!.id, intents[dominantIndex]!, adhered);
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
        heatDirection: airedHeatDirection,
        storyEffect: adhered ? slot.plannedOutcome.intendedStoryEffect : "Execution disruption requires the program to replan.",
      },
      adherence: adhered ? "adhered" : "deviated",
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
    data: { quality, crowdResponse, position: slot.position, dominantWrestlerId: result.dominantWrestlerId, ...(slot.programId === undefined ? {} : { programId: slot.programId }), ...(slot.plannedBeatId === undefined ? {} : { plannedBeatId: slot.plannedBeatId }), ...(slot.plannedOutcome === undefined ? {} : { plannedOutcome: slot.plannedOutcome, actualOutcome: { dominantWrestlerId: result.dominantWrestlerId, heatDirection: airedHeatDirection }, adherence: adhered ? "adhered" : "deviated", ...(execution.deviationCause === undefined ? {} : { deviationCause: execution.deviationCause }) }) },
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

function segmentExecution(
  slot: SegmentSlot,
  participants: readonly { id: string }[],
  intents: readonly SegmentIntent[],
  conflict: boolean,
  naturalDominantIndex: number,
  hurtTonight: ReadonlySet<string>,
): { dominantIndex: number; deviationCause?: ExecutionDeviationCause } {
  const planned = slot.plannedOutcome;
  if (planned === undefined) return { dominantIndex: naturalDominantIndex };
  const intended = participants.findIndex((participant) => participant.id === planned.intendedDominantWrestlerId);
  if (intended < 0) return { dominantIndex: naturalDominantIndex, deviationCause: "refusal" };
  const alternate = naturalDominantIndex === intended ? (intended + 1) % participants.length : naturalDominantIndex;
  if (hurtTonight.has(participants[intended]?.id ?? "")) return { dominantIndex: alternate, deviationCause: "injury" };
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
