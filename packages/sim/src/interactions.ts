import type {
  Interaction,
  InteractionIntent,
  InteractionOutcome,
  PlayerTurn,
  Story,
  WorldState,
  Wrestler,
} from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import {
  applyRelationshipDelta,
  findPopularity,
  findRelationship,
  findStance,
  findWrestler,
  requireWrestler,
} from "./lookups.js";
import { clamp01, clampDelta100, clampScale100 } from "./clamp.js";
import { countRecentInteractions, patienceMultiplier, recentPerformanceReaction } from "./patience.js";
import { replanForPlayerPitch } from "./program-plans.js";
import { stanceWeights } from "./ai/stance-weights.js";

// Spec §3.3: "many intents create a proposal" when the target is human.
// provoke/undermine are adversarial — there is nothing to consent to — and
// build_trust is a unilateral gesture, not an ask; all three apply directly
// regardless of the target's humanity. Everything else is an ask that
// deserves a real response, so it goes through a Proposal.
const DIRECT_WRESTLER_INTENTS: ReadonlySet<InteractionIntent> = new Set<InteractionIntent>([
  "build_trust",
  "provoke",
  "undermine",
]);

const GM_OBJECTIVE_INTENT_FIT: Partial<Record<string, Partial<Record<InteractionIntent, number>>>> = {
  new_main_eventer: { request_opportunity: 0.1, request_promo_time: 0.05 },
  rebuild_championship: { challenge_booking: 0.1, pitch_feud: 0.05 },
  capitalise_on_rising_star: { request_opportunity: 0.15 },
  cool_down_overexposed_act: { request_promo_time: -0.1, request_opportunity: -0.05 },
  prepare_major_event: { pitch_feud: 0.1, pitch_alliance: 0.05 },
};

function gmAcceptanceProbability(
  world: WorldState,
  wrestlerId: string,
  intent: InteractionIntent,
  ctx: TickContext,
): number {
  const wrestler = requireWrestler(world, wrestlerId);
  const popularity = findPopularity(world, wrestlerId);
  const repeats = countRecentInteractions(world, wrestlerId, intent, ctx.tick);
  const { gmReaction, backstageReaction } = recentPerformanceReaction(world, wrestlerId, ctx.tick);
  const base =
    0.35 +
    (popularity.generalPopularity / 100) * 0.3 +
    (wrestler.skills.professionalism / 100) * 0.2 +
    (gmReaction + backstageReaction) * 0.001;
  const objectiveBonus = GM_OBJECTIVE_INTENT_FIT[world.gmObjective]?.[intent] ?? 0;
  return clamp01(base * patienceMultiplier(repeats) + objectiveBonus);
}

function resolveGmInteraction(
  world: WorldState,
  wrestlerId: string,
  intent: InteractionIntent,
  ctx: TickContext,
): InteractionOutcome {
  const probability = gmAcceptanceProbability(world, wrestlerId, intent, ctx);
  const rng = ctx.rng.fork(`gm-interaction:${wrestlerId}:${intent}`);
  const roll = rng.next();
  if (roll < probability) return "accepted";
  if (roll < probability + 0.15) return "conditional";
  if (roll < probability + 0.25) return "deferred";
  if (roll < probability + 0.32) return "countered";
  return "rejected";
}

function applyDirectWrestlerIntent(
  world: WorldState,
  proposerId: string,
  targetId: string,
  intent: InteractionIntent,
): void {
  switch (intent) {
    case "build_trust":
      applyRelationshipDelta(world, targetId, proposerId, { trust: 8, affinity: 4 });
      break;
    case "provoke":
      applyRelationshipDelta(world, targetId, proposerId, { affinity: -6, rivalry: 10, resentment: 5 });
      break;
    case "undermine":
      applyRelationshipDelta(world, targetId, proposerId, { trust: -10, resentment: 12, rivalry: 6 });
      break;
    default:
      break;
  }
}

function aiProposalAcceptanceProbability(world: WorldState, proposerId: string, targetId: string): number {
  const stance = findStance(world, targetId).stance;
  const weights = stanceWeights(stance);
  const rel = findRelationship(world, targetId, proposerId);
  const relScore = rel ? (rel.affinity + rel.trust) / 200 : 0;
  return clamp01(0.3 + weights.loyalty * 0.3 + relScore * 0.4);
}

/**
 * Resolves every collected turn's interaction slot: GM-targeted interactions
 * resolve immediately; wrestler-targeted direct intents (build_trust,
 * provoke, undermine) apply immediately; the remaining wrestler-targeted
 * "ask" intents resolve immediately against an AI recipient or become a
 * Proposal (spec §3.3) against a human recipient.
 */
export function resolveInteractions(
  world: WorldState,
  turns: Map<string, PlayerTurn>,
  ctx: TickContext,
): void {
  for (const turn of turns.values()) {
    if (!turn.interaction) continue;
    resolveOneInteraction(world, turn.interaction, ctx);
  }
}

// Tuning gap #4: an accepted GM pitch must be able to cause the things it
// exists to cause (GDD §13) — reignite an existing story with the named
// subject, or start a fresh one if there isn't one yet.
const FEUD_STORY_INTEREST_BOOST = 12;
const FEUD_STORY_MOMENTUM_BOOST = 15;

function seedOrBoostFeud(world: WorldState, ctx: TickContext, proposer: Wrestler, subject: Wrestler): void {
  const existing = world.stories.find(
    (s) =>
      s.phase !== "resolved" &&
      s.participantWrestlerIds.includes(proposer.id) &&
      s.participantWrestlerIds.includes(subject.id),
  );
  if (existing) {
    existing.momentum = clampDelta100(existing.momentum + FEUD_STORY_MOMENTUM_BOOST);
    existing.audienceInterest = clampScale100(existing.audienceInterest + FEUD_STORY_INTEREST_BOOST);
    addEvent(world, ctx, {
      type: "story_developed",
      summary: `${proposer.name}'s pitch to the GM reignited the story with ${subject.name}.`,
      wrestlerIds: [proposer.id, subject.id],
      storyId: existing.id,
      data: {},
    });
    return;
  }

  const story: Story = {
    id: ctx.ids.next("story"),
    participantWrestlerIds: [proposer.id, subject.id],
    tension: "push_conflict",
    tensionDescription: `${proposer.name} pitched the GM a feud with ${subject.name}.`,
    stakes: "a spot on the card",
    audienceInterest: 45,
    momentum: 15,
    coherence: 65,
    phase: "building",
    unresolvedDevelopments: [],
  };
  world.stories.push(story);
  addEvent(world, ctx, {
    type: "story_started",
    summary: story.tensionDescription,
    wrestlerIds: [proposer.id, subject.id],
    storyId: story.id,
    data: { tension: story.tension },
  });
}

function resolveOneInteraction(world: WorldState, interaction: Interaction, ctx: TickContext): void {
  const proposer = requireWrestler(world, interaction.wrestlerId);

  if (interaction.target.kind === "gm") {
    const outcome = resolveGmInteraction(world, proposer.id, interaction.intent, ctx);
    if (outcome === "accepted") {
      const popularity = findPopularity(world, proposer.id);
      // request_opportunity's whole point is a better shot at the next
      // card — a materially bigger bump than a generic accepted ask, since
      // bookingScore (gm.ts) weighs momentum directly.
      const momentumBump = interaction.intent === "request_opportunity" ? 12 : 4;
      popularity.momentum = clampDelta100(popularity.momentum + momentumBump);

      if (interaction.intent === "pitch_feud" && interaction.subjectWrestlerId) {
        const subject = findWrestler(world, interaction.subjectWrestlerId);
        if (subject) {
          // A pitch about wrestlers nobody is building stays on the
          // story-seeding path; one that touches a live program revises it.
          seedOrBoostFeud(world, ctx, proposer, subject);
          replanForPlayerPitch(world, ctx, proposer.id, subject.id);
        }
      }
    }
    addEvent(world, ctx, {
      type: "interaction_resolved",
      summary: `${proposer.name} asked the GM to ${interaction.intent.replace(/_/g, " ")} — ${outcome}.`,
      wrestlerIds: [proposer.id],
      data: { intent: interaction.intent, target: "gm", outcome },
    });
    return;
  }

  const targetId = interaction.target.wrestlerId;
  const target = requireWrestler(world, targetId);

  if (DIRECT_WRESTLER_INTENTS.has(interaction.intent)) {
    applyDirectWrestlerIntent(world, proposer.id, targetId, interaction.intent);
    addEvent(world, ctx, {
      type: "interaction_resolved",
      summary: `${proposer.name} directed ${interaction.intent.replace(/_/g, " ")} at ${target.name}.`,
      wrestlerIds: [proposer.id, targetId],
      data: { intent: interaction.intent, target: targetId, outcome: "accepted" },
    });
    return;
  }

  if (target.controlledBy === "ai") {
    const probability = aiProposalAcceptanceProbability(world, proposer.id, targetId);
    const rng = ctx.rng.fork(`ai-proposal:${proposer.id}:${targetId}:${interaction.intent}`);
    const outcome: InteractionOutcome = rng.chance(probability) ? "accepted" : "rejected";
    if (outcome === "accepted") {
      applyRelationshipDelta(world, targetId, proposer.id, { affinity: 5, trust: 5 });
    } else {
      applyRelationshipDelta(world, targetId, proposer.id, { affinity: -2 });
    }
    addEvent(world, ctx, {
      type: "interaction_resolved",
      summary: `${proposer.name} asked ${target.name} to ${interaction.intent.replace(/_/g, " ")} — ${outcome}.`,
      wrestlerIds: [proposer.id, targetId],
      data: { intent: interaction.intent, target: targetId, outcome },
    });
    return;
  }

  // Human recipient: defer to a Proposal (spec §3.3).
  const proposal = {
    id: ctx.ids.next("proposal"),
    proposerWrestlerId: proposer.id,
    recipientWrestlerId: targetId,
    originatingIntent: interaction.intent,
    createdAtTick: ctx.tick,
    deadlineTick: ctx.tick + 2,
    status: "pending" as const,
  };
  world.pendingProposals.push(proposal);
  addEvent(world, ctx, {
    type: "proposal_created",
    summary: `${proposer.name} proposed ${interaction.intent.replace(/_/g, " ")} to ${target.name}.`,
    wrestlerIds: [proposer.id, targetId],
    data: { intent: interaction.intent, proposalId: proposal.id },
  });
  addEvent(world, ctx, {
    type: "interaction_resolved",
    summary: `${proposer.name}'s ${interaction.intent.replace(/_/g, " ")} toward ${target.name} awaits a response.`,
    wrestlerIds: [proposer.id, targetId],
    data: { intent: interaction.intent, target: targetId, outcome: "deferred" },
  });
}
