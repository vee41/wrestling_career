import type {
  ReactiveDecisionType,
  ReactiveResponseToken,
  Story,
  TensionType,
  WorldState,
} from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { findPopularity, findRelationship, humanWrestlers, requireWrestler } from "./lookups.js";
import { upcomingSlotsFor } from "./booking.js";
import type { Rng } from "./rng.js";

// GDD §15 — conditions the dramatic director scans for. The director both
// proposes and (in this prototype, absent a separate GM-approval exchange)
// directly starts the story; that collapse is this phase's simplification.
function activeStoryParticipantIds(world: WorldState): Set<string> {
  const ids = new Set<string>();
  for (const s of world.stories) {
    if (s.phase === "building" || s.phase === "peaking") s.participantWrestlerIds.forEach((id) => ids.add(id));
  }
  return ids;
}

function chooseTension(world: WorldState, a: string, b: string): { tension: TensionType; description: string; stakes: string } {
  if (world.championId === a || world.championId === b) {
    return {
      tension: "title_pursuit",
      description: `${requireWrestler(world, a).name} and ${requireWrestler(world, b).name} are on a collision course over the championship.`,
      stakes: "the championship",
    };
  }
  const rel = findRelationship(world, a, b) ?? findRelationship(world, b, a);
  if (rel && rel.rivalry > 40) {
    return {
      tension: "grudge",
      description: `${requireWrestler(world, a).name} and ${requireWrestler(world, b).name} can't let their history go.`,
      stakes: "bragging rights",
    };
  }
  if (rel && rel.affinity > 30) {
    return {
      tension: "alliance_strain",
      description: `${requireWrestler(world, a).name} and ${requireWrestler(world, b).name}, once allies, both want the same opportunity.`,
      stakes: "the GM's attention",
    };
  }
  return {
    tension: "push_conflict",
    description: `${requireWrestler(world, a).name} and ${requireWrestler(world, b).name} are both chasing the same push.`,
    stakes: "a spot near the top of the card",
  };
}

/** GDD §15: underused popular wrestler, champion lacking a challenger, two wrestlers wanting the same spot. */
export function scanForNewStory(world: WorldState, ctx: TickContext): void {
  const busy = activeStoryParticipantIds(world);
  const candidates = world.wrestlers
    .filter((w) => !busy.has(w.id))
    .map((w) => ({ w, score: findPopularity(world, w.id).generalPopularity + findPopularity(world, w.id).momentum }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length < 2) return;
  const [first, second] = candidates as [(typeof candidates)[number], (typeof candidates)[number]];
  const a = first.w.id;
  const b = second.w.id;

  const alreadyLinked = world.stories.some(
    (s) =>
      s.phase !== "resolved" &&
      s.participantWrestlerIds.includes(a) &&
      s.participantWrestlerIds.includes(b),
  );
  if (alreadyLinked) return;

  const { tension, description, stakes } = chooseTension(world, a, b);
  const rng = ctx.rng.fork("director:new-story");
  const story: Story = {
    id: ctx.ids.next("story"),
    participantWrestlerIds: [a, b],
    tension,
    tensionDescription: description,
    stakes,
    audienceInterest: rng.int(40, 55),
    momentum: rng.int(5, 15),
    coherence: 70,
    phase: "building",
    unresolvedDevelopments: [],
  };
  world.stories.push(story);
  addEvent(world, ctx, {
    type: "story_started",
    summary: description,
    wrestlerIds: [a, b],
    storyId: story.id,
    data: { tension },
  });
}

interface ReactiveCandidate {
  type: ReactiveDecisionType;
  weight: number;
  offeredResponses: ReactiveResponseToken[];
  deadlineTick: number;
  originWrestlerId?: string;
  originStoryId?: string;
  originMatchId?: string;
}

function buildCandidates(world: WorldState, wrestlerId: string, ctx: TickContext): ReactiveCandidate[] {
  const candidates: ReactiveCandidate[] = [];
  const popularity = findPopularity(world, wrestlerId);
  const wrestler = requireWrestler(world, wrestlerId);

  const justBooked = upcomingSlotsFor(world, wrestlerId, ctx.tick).filter((ref) => ref.show.tick === ctx.tick + 1);
  for (const ref of justBooked) {
    candidates.push({
      type: "booking_request",
      weight: 1,
      offeredResponses: ["accept", "refuse", "negotiate"],
      deadlineTick: ref.show.tick,
      originMatchId: ref.slot.id,
      ...(ref.slot.storyId !== undefined ? { originStoryId: ref.slot.storyId } : {}),
    });
  }

  for (const other of world.wrestlers) {
    if (other.id === wrestlerId) continue;
    const rel = findRelationship(world, other.id, wrestlerId);
    if (rel && rel.rivalry > 50) {
      candidates.push({
        type: "public_insult",
        weight: 0.7,
        offeredResponses: ["ignore", "negotiate", "escalate"],
        deadlineTick: ctx.tick + 2,
        originWrestlerId: other.id,
      });
    }
    const forward = findRelationship(world, wrestlerId, other.id);
    if (forward && forward.affinity > 40) {
      candidates.push({
        type: "support_request",
        weight: 0.5,
        offeredResponses: ["accept", "refuse", "ignore"],
        deadlineTick: ctx.tick + 2,
        originWrestlerId: other.id,
      });
    }
  }

  if (wrestler.condition > 50) {
    candidates.push({
      type: "risky_opportunity",
      weight: 0.4,
      offeredResponses: ["accept", "refuse"],
      deadlineTick: ctx.tick + 2,
    });
  }

  if (popularity.negativeHeat > 40) {
    candidates.push({
      type: "rumor_published",
      weight: 0.3,
      offeredResponses: ["ignore", "escalate", "delay"],
      deadlineTick: ctx.tick + 2,
    });
  }

  // GDD §10's flagship turn example — a face whose negative heat has
  // overtaken their positive heat (or the heel mirror) is a crowd already
  // reacting the opposite of their alignment; a tweener is eligible either
  // way since there's no incumbent reaction to contradict.
  const HEAT_CONTRADICTION_MARGIN = 15;
  const heatContradicts =
    wrestler.alignment === "tweener" ||
    (wrestler.alignment === "face" && popularity.negativeHeat > popularity.positiveHeat + HEAT_CONTRADICTION_MARGIN) ||
    (wrestler.alignment === "heel" && popularity.positiveHeat > popularity.negativeHeat + HEAT_CONTRADICTION_MARGIN);
  if (heatContradicts) {
    candidates.push({
      type: "turn_proposal",
      weight: 0.2,
      offeredResponses: ["accept", "refuse", "negotiate"],
      deadlineTick: ctx.tick + 2,
    });
  }

  // Spec §4.2 / GDD §7: a wrestler working through low condition faces a
  // real decision — push through (more strain, more momentum) or sit out.
  if (wrestler.condition < 35) {
    candidates.push({
      type: "injury_decision",
      weight: 0.6,
      offeredResponses: ["accept", "refuse", "cooperate_conditionally"],
      deadlineTick: ctx.tick + 2,
    });
  }

  // A booked, story-linked match is exactly where the GM has a finish worth
  // changing on short notice (spec §5.1).
  const storyLinkedBooking = upcomingSlotsFor(world, wrestlerId, ctx.tick).find((ref) => ref.slot.storyId !== undefined);
  if (storyLinkedBooking) {
    candidates.push({
      type: "finish_changed",
      weight: 0.4,
      offeredResponses: ["accept", "refuse", "negotiate"],
      deadlineTick: storyLinkedBooking.show.tick,
      originMatchId: storyLinkedBooking.slot.id,
      ...(storyLinkedBooking.slot.storyId !== undefined ? { originStoryId: storyLinkedBooking.slot.storyId } : {}),
    });
  }

  return candidates;
}

function weightedPick<T extends { weight: number }>(items: readonly T[], rng: Rng): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1] as T;
}

const MAX_PENDING_PER_WRESTLER = 2;
const GENERATION_CHANCE = 0.35;

/**
 * Spec §5.3: "zero to two important reactive decisions" per player per
 * period. Spec §5.4: participants sharing a match must get complementary,
 * not contradictory, prompts — implemented here by mirroring a
 * booking_request/booking-tied decision to the other human participant
 * instead of rolling it independently.
 */
export function generateReactiveDecisions(world: WorldState, ctx: TickContext): void {
  const rng = ctx.rng.fork("director:reactive");
  const alreadyHandledMatches = new Set<string>();

  for (const wrestler of humanWrestlers(world)) {
    const pendingCount = world.pendingReactiveDecisions.filter((d) => d.targetWrestlerId === wrestler.id).length;
    if (pendingCount >= MAX_PENDING_PER_WRESTLER) continue;
    if (!rng.chance(GENERATION_CHANCE)) continue;

    const candidates = buildCandidates(world, wrestler.id, ctx);
    if (candidates.length === 0) continue;
    const chosen = weightedPick(candidates, rng);

    createReactiveDecision(world, ctx, wrestler.id, chosen);

    if (chosen.type === "booking_request" && chosen.originMatchId && !alreadyHandledMatches.has(chosen.originMatchId)) {
      alreadyHandledMatches.add(chosen.originMatchId);
      const slot = world.shows.flatMap((s) => s.card).find((c) => c.id === chosen.originMatchId);
      const otherHumans = (slot?.participantWrestlerIds ?? []).filter(
        (id) => id !== wrestler.id && requireWrestler(world, id).controlledBy === "human",
      );
      for (const otherId of otherHumans) {
        const otherPending = world.pendingReactiveDecisions.filter((d) => d.targetWrestlerId === otherId).length;
        if (otherPending >= MAX_PENDING_PER_WRESTLER) continue;
        createReactiveDecision(world, ctx, otherId, chosen);
      }
    }
  }
}

function createReactiveDecision(
  world: WorldState,
  ctx: TickContext,
  targetWrestlerId: string,
  candidate: ReactiveCandidate,
): void {
  const decision = {
    id: ctx.ids.next("reactive"),
    type: candidate.type,
    targetWrestlerId,
    offeredResponses: candidate.offeredResponses,
    deadlineTick: candidate.deadlineTick,
    status: "pending" as const,
    ...(candidate.originStoryId !== undefined ? { originStoryId: candidate.originStoryId } : {}),
    ...(candidate.originMatchId !== undefined ? { originMatchId: candidate.originMatchId } : {}),
    ...(candidate.originWrestlerId !== undefined ? { originWrestlerId: candidate.originWrestlerId } : {}),
  };
  world.pendingReactiveDecisions.push(decision);
  addEvent(world, ctx, {
    type: "reactive_decision_created",
    summary: `${requireWrestler(world, targetWrestlerId).name} faces a ${candidate.type.replace(/_/g, " ")} decision.`,
    wrestlerIds: [targetWrestlerId],
    ...(candidate.originStoryId !== undefined ? { storyId: candidate.originStoryId } : {}),
    ...(candidate.originMatchId !== undefined ? { matchId: candidate.originMatchId } : {}),
    data: { decisionType: candidate.type },
  });
}
