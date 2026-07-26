import type {
  Action,
  Interaction,
  InteractionIntent,
  InteractionTarget,
  PlayerTurn,
  ProposalResponseToken,
  ReactiveResponseToken,
  SkillName,
  Skills,
  WorldState,
  Wrestler,
} from "@wrestling/contracts";
import { skillNameSchema } from "@wrestling/contracts";
import type { TickContext } from "../context.js";
import { upcomingSlotsFor } from "../booking.js";
import { ACTION_COST } from "../resolve-actions.js";
import { interactionGatePasses } from "../gates.js";
import { countRecentInteractions, patienceMultiplier } from "../patience.js";
import { findPopularity, findRelationship, findStance } from "../lookups.js";
import { pickBestResponse } from "./response-scoring.js";
import { defaultMatchIntent, stanceWeights, type StanceWeights } from "./stance-weights.js";

const SKILL_NAMES = skillNameSchema.options;

function pickWeakestSkill(skills: Skills, rng: TickContext["rng"]): SkillName {
  let min = Infinity;
  for (const name of SKILL_NAMES) if (skills[name] < min) min = skills[name];
  const tied = SKILL_NAMES.filter((name) => skills[name] === min);
  return rng.pick(tied);
}

interface Scored<T> {
  value: T;
  score: number;
}

function argmax<T>(candidates: Scored<T>[], rng: TickContext["rng"]): T {
  let best: T[] = [];
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.score > bestScore) {
      bestScore = c.score;
      best = [c.value];
    } else if (c.score === bestScore) {
      best.push(c.value);
    }
  }
  return rng.pick(best);
}

function decideAction(
  world: WorldState,
  wrestler: Wrestler,
  weights: StanceWeights,
  ctx: TickContext,
): Action {
  const popularity = findPopularity(world, wrestler.id);
  const upcoming = upcomingSlotsFor(world, wrestler.id, ctx.tick);
  const rng = ctx.rng.fork(`${wrestler.id}:action`);

  const candidates: Scored<Action["type"]>[] = [
    {
      value: "recover",
      score:
        weights.health * 0.7 +
        (100 - wrestler.condition) / 150 +
        (popularity.fatigue > 70 ? 0.5 : 0) +
        (wrestler.condition < 45 ? 0.6 : 0),
    },
    { value: "train_skill", score: weights.ambition * 0.4 + weights.quality * 0.3 + 0.2 },
    {
      value: "promote_match",
      score:
        upcoming.length > 0
          ? weights.ambition * 0.3 + weights.quality * 0.2 + 0.15
          : Number.NEGATIVE_INFINITY,
    },
    { value: "develop_character", score: weights.creative * 0.5 + weights.characterProtection * 0.2 },
  ];

  const chosen = argmax(candidates, rng);
  const id = ctx.ids.next("action");

  // Spec §4 / GDD §8: investing money to upgrade an action is an explicit
  // choice. The AI invests only above a stance-driven cash reserve —
  // income-focused wrestlers hoard a deeper cushion before spending.
  const cost = ACTION_COST[chosen] ?? 0;
  const reserve = 50 + weights.income * 300;
  const invest = cost > 0 && wrestler.money >= cost + reserve ? { invest: true } : {};

  switch (chosen) {
    case "recover":
      return { type: "recover", id, wrestlerId: wrestler.id, ...invest };
    case "train_skill":
      return {
        type: "train_skill",
        id,
        wrestlerId: wrestler.id,
        skill: pickWeakestSkill(wrestler.skills, rng),
        ...invest,
      };
    case "promote_match": {
      const slot = rng.pick(upcoming);
      return { type: "promote_match", id, wrestlerId: wrestler.id, matchSlotId: slot.slot.id, ...invest };
    }
    case "develop_character":
      return { type: "develop_character", id, wrestlerId: wrestler.id, adjustment: {}, ...invest };
  }
}

const GM_INTENT_BASE_SCORE: Record<string, (w: StanceWeights) => number> = {
  request_opportunity: (w) => w.ambition * 0.6,
  pitch_feud: (w) => w.ambition * 0.4 + w.quality * 0.3,
  request_promo_time: (w) => w.ambition * 0.3 + w.quality * 0.2,
  request_feedback: (w) => w.creative * 0.4,
  propose_character_change: (w) => w.creative * 0.5,
  challenge_booking: (w) => w.characterProtection * 0.3,
  offer_help: (w) => w.loyalty * 0.4,
  pitch_alliance: (w) => w.loyalty * 0.3 + w.ambition * 0.2,
};

function gmInteractionCandidates(
  world: WorldState,
  wrestler: Wrestler,
  weights: StanceWeights,
  ctx: TickContext,
): Scored<{ target: InteractionTarget; intent: InteractionIntent }>[] {
  const activeStory = world.stories.some(
    (s) =>
      s.participantWrestlerIds.includes(wrestler.id) && (s.phase === "building" || s.phase === "peaking"),
  );
  return Object.entries(GM_INTENT_BASE_SCORE)
    .filter(([intent]) => intent !== "pitch_feud" || !activeStory)
    .map(([intent, baseScore]) => {
      const repeats = countRecentInteractions(world, wrestler.id, intent as InteractionIntent, ctx.tick);
      return {
        value: { target: { kind: "gm" as const }, intent: intent as InteractionIntent },
        score: baseScore(weights) * patienceMultiplier(repeats),
      };
    });
}

const WRESTLER_INTENT_SCORES: Array<{
  intent: InteractionIntent;
  score: (
    w: StanceWeights,
    rel: { affinity: number; respect: number; trust: number; rivalry: number; resentment: number },
    popDelta: number,
  ) => number;
}> = [
  {
    intent: "provoke",
    score: (w, rel) => w.riskTolerance * 0.5 + (rel.rivalry / 100) * 0.4 - w.conflictAversion * 0.5,
  },
  {
    intent: "undermine",
    score: (w, rel) =>
      w.riskTolerance * 0.4 + (rel.resentment / 100) * 0.5 - w.conflictAversion * 0.6 - w.loyalty * 0.3,
  },
  {
    intent: "repair_relationship",
    score: (w, rel) => w.conflictAversion * 0.3 + w.loyalty * 0.3 + Math.max(0, -rel.affinity) / 100,
  },
  {
    intent: "build_trust",
    score: (w, rel) => w.loyalty * 0.4 + Math.max(0, rel.affinity) / 100,
  },
  {
    intent: "offer_elevation",
    score: (w, _rel, popDelta) => w.loyalty * 0.5 + Math.max(0, popDelta) / 100,
  },
  {
    intent: "request_support",
    score: (w, rel) => w.ambition * 0.4 + Math.max(0, rel.trust) / 100 * 0.3,
  },
  {
    intent: "propose_alliance",
    score: (w, rel) => w.loyalty * 0.3 + w.ambition * 0.2 + Math.max(0, rel.affinity) / 100 * 0.2,
  },
  {
    intent: "coordinate_pitch",
    score: (w) => w.creative * 0.3 + w.ambition * 0.2,
  },
  {
    intent: "pitch_feud",
    score: (w, rel) => w.ambition * 0.3 + w.quality * 0.2 + (rel.rivalry / 100) * 0.2,
  },
];

function wrestlerInteractionCandidates(
  world: WorldState,
  wrestler: Wrestler,
  weights: StanceWeights,
): Scored<{ target: InteractionTarget; intent: InteractionIntent }>[] {
  const selfPop = findPopularity(world, wrestler.id).generalPopularity;
  const candidates: Scored<{ target: InteractionTarget; intent: InteractionIntent }>[] = [];
  for (const other of world.wrestlers) {
    if (other.id === wrestler.id) continue;
    const rel = findRelationship(world, wrestler.id, other.id) ?? {
      affinity: 0,
      respect: 0,
      trust: 0,
      rivalry: 0,
      resentment: 0,
      influence: 0,
    };
    const popDelta = selfPop - findPopularity(world, other.id).generalPopularity;
    for (const entry of WRESTLER_INTENT_SCORES) {
      if (!interactionGatePasses(entry.intent, rel)) continue;
      candidates.push({
        value: { target: { kind: "wrestler", wrestlerId: other.id }, intent: entry.intent },
        score: entry.score(weights, rel, popDelta),
      });
    }
  }
  return candidates;
}

function decideInteraction(
  world: WorldState,
  wrestler: Wrestler,
  weights: StanceWeights,
  ctx: TickContext,
): Interaction {
  const rng = ctx.rng.fork(`${wrestler.id}:interaction`);
  const candidates = [
    ...gmInteractionCandidates(world, wrestler, weights, ctx),
    ...wrestlerInteractionCandidates(world, wrestler, weights),
  ];
  const chosen = argmax(candidates, rng);
  return {
    id: ctx.ids.next("interaction"),
    wrestlerId: wrestler.id,
    target: chosen.target,
    intent: chosen.intent,
  };
}

export function decideFallbackTurn(world: WorldState, wrestler: Wrestler, ctx: TickContext): PlayerTurn {
  const stance = findStance(world, wrestler.id).stance;
  const weights = stanceWeights(stance);
  const rng = ctx.rng.fork(`${wrestler.id}:responses`);

  const reactiveResponses = world.pendingReactiveDecisions
    .filter((d) => d.targetWrestlerId === wrestler.id && d.status === "pending")
    .map((d) => ({
      reactiveDecisionId: d.id,
      response: pickBestResponse<ReactiveResponseToken>(d.offeredResponses, weights, rng),
    }));

  const proposalResponses = world.pendingProposals
    .filter((p) => p.recipientWrestlerId === wrestler.id && p.status === "pending")
    .map((p) => ({
      proposalId: p.id,
      response: pickBestResponse<ProposalResponseToken>(
        ["accept", "reject", "counter", "ignore"],
        weights,
        rng,
      ),
    }));

  const matchIntents: Record<string, ReturnType<typeof defaultMatchIntent>> = {};
  for (const { slot } of upcomingSlotsFor(world, wrestler.id, ctx.tick)) {
    if (!slot.intents[wrestler.id]) matchIntents[slot.id] = defaultMatchIntent(stance);
  }

  return {
    wrestlerId: wrestler.id,
    interaction: decideInteraction(world, wrestler, weights, ctx),
    action: decideAction(world, wrestler, weights, ctx),
    reactiveResponses,
    proposalResponses,
    matchIntents,
    segmentIntents: {},
  };
}
