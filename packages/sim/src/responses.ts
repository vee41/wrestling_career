import type {
  PlayerTurn,
  ReactiveDecision,
  ReactiveResponseToken,
  WorldState,
} from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { applyRelationshipDelta, findPopularity, requireWrestler } from "./lookups.js";
import { clampDelta100, clampScale100 } from "./clamp.js";

/**
 * GDD §4 pipeline step 4: resolve reactive-decision responses and proposal
 * responses, then expire whatever is left past its deadline. Consequences
 * per (type, response) pair are this phase's simplification of spec §5.2
 * ("responses MUST have context-dependent consequences") — the spec lists
 * the token vocabularies but not exact magnitudes.
 */
export function resolveReactiveResponses(
  world: WorldState,
  turns: Map<string, PlayerTurn>,
  ctx: TickContext,
): void {
  const byId = new Map(world.pendingReactiveDecisions.map((d) => [d.id, d]));

  for (const turn of turns.values()) {
    for (const response of turn.reactiveResponses) {
      const decision = byId.get(response.reactiveDecisionId);
      if (!decision || decision.targetWrestlerId !== turn.wrestlerId || decision.status !== "pending") {
        continue;
      }
      applyReactiveConsequence(world, decision, response.response, ctx);
      decision.status = "responded";
      byId.delete(decision.id);
      const wrestler = requireWrestler(world, decision.targetWrestlerId);
      addEvent(world, ctx, {
        type: "reactive_decision_resolved",
        summary: `${wrestler.name} chose to ${response.response.replace(/_/g, " ")} on ${decision.type.replace(/_/g, " ")}.`,
        wrestlerIds: [decision.targetWrestlerId],
        ...(decision.originStoryId !== undefined ? { storyId: decision.originStoryId } : {}),
        ...(decision.originMatchId !== undefined ? { matchId: decision.originMatchId } : {}),
        data: { decisionType: decision.type, response: response.response },
      });
    }
  }

  world.pendingReactiveDecisions = world.pendingReactiveDecisions.filter((d) => d.status === "pending");
}

function applyReactiveConsequence(
  world: WorldState,
  decision: ReactiveDecision,
  response: ReactiveResponseToken,
  ctx: TickContext,
): void {
  const popularity = findPopularity(world, decision.targetWrestlerId);
  const rng = ctx.rng.fork(`reactive:${decision.id}`);
  const cooperative = response === "accept" || response === "cooperate_conditionally";
  const defiant = response === "refuse" || response === "escalate";

  switch (decision.type) {
    case "booking_request":
      // GM asks the wrestler to lose clean.
      popularity.momentum = clampDelta100(popularity.momentum + (cooperative ? -2 : defiant ? 3 : 0));
      break;
    case "turn_proposal": {
      if (cooperative) {
        const wrestler = requireWrestler(world, decision.targetWrestlerId);
        wrestler.alignment =
          wrestler.alignment === "face" ? "heel" : wrestler.alignment === "heel" ? "face" : rng.pick(["face", "heel"]);
        popularity.currentReaction = clampScale100(popularity.currentReaction + rng.int(-10, 15));
      }
      break;
    }
    case "finish_changed":
      popularity.momentum = clampDelta100(popularity.momentum + (defiant ? rng.int(-8, 8) : 0));
      break;
    case "public_insult":
      if (decision.originWrestlerId) {
        if (response === "escalate") {
          applyRelationshipDelta(world, decision.targetWrestlerId, decision.originWrestlerId, {
            rivalry: 10,
            affinity: -8,
          });
          popularity.currentReaction = clampScale100(popularity.currentReaction + rng.int(-5, 10));
        } else if (response === "ignore") {
          applyRelationshipDelta(world, decision.targetWrestlerId, decision.originWrestlerId, {
            resentment: 4,
          });
        }
      }
      break;
    case "rumor_published":
      if (response === "escalate") {
        popularity.currentReaction = clampScale100(popularity.currentReaction + rng.int(-15, 10));
      } else {
        popularity.fatigue = clampScale100(popularity.fatigue + 2);
      }
      break;
    case "injury_decision": {
      const wrestler = requireWrestler(world, decision.targetWrestlerId);
      if (cooperative) {
        wrestler.condition = clampScale100(wrestler.condition - rng.int(5, 15));
        popularity.momentum = clampDelta100(popularity.momentum + 3);
      } else {
        popularity.momentum = clampDelta100(popularity.momentum - 2);
      }
      break;
    }
    case "support_request":
      if (decision.originWrestlerId) {
        if (cooperative) {
          applyRelationshipDelta(world, decision.originWrestlerId, decision.targetWrestlerId, {
            affinity: 6,
            trust: 6,
          });
        } else {
          applyRelationshipDelta(world, decision.originWrestlerId, decision.targetWrestlerId, {
            affinity: -3,
          });
        }
      }
      break;
    case "risky_opportunity": {
      const wrestler = requireWrestler(world, decision.targetWrestlerId);
      if (cooperative) {
        const success = rng.chance(0.55);
        popularity.momentum = clampDelta100(popularity.momentum + (success ? rng.int(8, 18) : -rng.int(2, 10)));
        wrestler.condition = clampScale100(wrestler.condition - rng.int(3, 12));
      }
      break;
    }
    default:
      break;
  }
}

export function resolveProposalResponses(
  world: WorldState,
  turns: Map<string, PlayerTurn>,
  ctx: TickContext,
): void {
  const byId = new Map(world.pendingProposals.map((p) => [p.id, p]));

  for (const turn of turns.values()) {
    for (const response of turn.proposalResponses) {
      const proposal = byId.get(response.proposalId);
      if (!proposal || proposal.recipientWrestlerId !== turn.wrestlerId || proposal.status !== "pending") {
        continue;
      }
      const proposer = requireWrestler(world, proposal.proposerWrestlerId);
      const recipient = requireWrestler(world, proposal.recipientWrestlerId);

      switch (response.response) {
        case "accept":
          proposal.status = "accepted";
          applyRelationshipDelta(world, proposal.recipientWrestlerId, proposal.proposerWrestlerId, {
            affinity: 8,
            trust: 6,
            respect: 4,
          });
          applyRelationshipDelta(world, proposal.proposerWrestlerId, proposal.recipientWrestlerId, {
            affinity: 6,
            trust: 4,
          });
          break;
        case "reject":
          proposal.status = "rejected";
          applyRelationshipDelta(world, proposal.proposerWrestlerId, proposal.recipientWrestlerId, {
            affinity: -4,
          });
          break;
        case "counter": {
          proposal.status = "countered";
          // Minor tuning gap: a counter used to just close the original
          // proposal with no way for the original proposer to respond —
          // spin up the actual counter-proposal, roles reversed, so the
          // conversation continues instead of silently dead-ending.
          const counter = {
            id: ctx.ids.next("proposal"),
            proposerWrestlerId: proposal.recipientWrestlerId,
            recipientWrestlerId: proposal.proposerWrestlerId,
            originatingIntent: proposal.originatingIntent,
            ...(response.counterPayload !== undefined ? { payload: response.counterPayload } : {}),
            createdAtTick: ctx.tick,
            deadlineTick: ctx.tick + 2,
            status: "pending" as const,
          };
          world.pendingProposals.push(counter);
          addEvent(world, ctx, {
            type: "proposal_created",
            summary: `${recipient.name} countered ${proposer.name}'s ${proposal.originatingIntent.replace(/_/g, " ")} proposal.`,
            wrestlerIds: [proposal.recipientWrestlerId, proposal.proposerWrestlerId],
            data: { intent: proposal.originatingIntent, proposalId: counter.id },
          });
          break;
        }
        case "ignore":
          proposal.status = "ignored";
          applyRelationshipDelta(world, proposal.proposerWrestlerId, proposal.recipientWrestlerId, {
            affinity: -5,
            trust: -3,
          });
          break;
      }

      addEvent(world, ctx, {
        type: "proposal_resolved",
        summary: `${recipient.name} answered ${proposer.name}'s ${proposal.originatingIntent.replace(/_/g, " ")} proposal: ${proposal.status}.`,
        wrestlerIds: [proposal.proposerWrestlerId, proposal.recipientWrestlerId],
        data: { intent: proposal.originatingIntent, status: proposal.status },
      });
      byId.delete(proposal.id);
    }
  }

  world.pendingProposals = world.pendingProposals.filter((p) => p.status === "pending");
}

/** Spec §3.3: an expired proposal resolves as `ignored`, with the ghosting penalty landing on the proposer's own relationship to the recipient. */
export function expireProposals(world: WorldState, ctx: TickContext): void {
  const expiring = world.pendingProposals.filter((p) => p.deadlineTick <= ctx.tick);
  for (const proposal of expiring) {
    proposal.status = "ignored";
    applyRelationshipDelta(world, proposal.proposerWrestlerId, proposal.recipientWrestlerId, {
      affinity: -5,
      trust: -3,
    });
    addEvent(world, ctx, {
      type: "proposal_resolved",
      summary: `${requireWrestler(world, proposal.recipientWrestlerId).name} let ${requireWrestler(world, proposal.proposerWrestlerId).name}'s proposal expire.`,
      wrestlerIds: [proposal.proposerWrestlerId, proposal.recipientWrestlerId],
      data: { intent: proposal.originatingIntent, status: "ignored" },
    });
  }
  world.pendingProposals = world.pendingProposals.filter((p) => p.deadlineTick > ctx.tick);
}

export function expireReactiveDecisions(world: WorldState, ctx: TickContext): void {
  const expiring = world.pendingReactiveDecisions.filter((d) => d.deadlineTick <= ctx.tick);
  for (const decision of expiring) {
    decision.status = "expired";
    addEvent(world, ctx, {
      type: "reactive_decision_resolved",
      summary: `${requireWrestler(world, decision.targetWrestlerId).name}'s ${decision.type.replace(/_/g, " ")} decision expired unanswered.`,
      wrestlerIds: [decision.targetWrestlerId],
      data: { decisionType: decision.type, response: "expired" },
    });
  }
  world.pendingReactiveDecisions = world.pendingReactiveDecisions.filter((d) => d.deadlineTick > ctx.tick);
}
