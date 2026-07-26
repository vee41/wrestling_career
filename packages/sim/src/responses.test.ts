import { describe, expect, it } from "vitest";
import type { PlayerTurn, Proposal, ReactiveDecision } from "@wrestling/contracts";
import { expireProposals, expireReactiveDecisions, resolveProposalResponses, resolveReactiveResponses } from "./responses.js";
import { createTestWorld } from "./test-helpers.js";
import { findRelationship } from "./lookups.js";
import type { TickContext } from "./context.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";

function ctxAt(tick: number): TickContext {
  return { tick, rng: createRng(`responses-test:${tick}`), ids: createIdFactory(tick), events: [] };
}

describe("proposal expiry (spec §3.3)", () => {
  it("resolves an overdue pending proposal as ignored and penalizes the proposer's relationship", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    const proposal: Proposal = {
      id: "prop-1",
      proposerWrestlerId: "wrestler-0",
      recipientWrestlerId: "wrestler-1",
      originatingIntent: "propose_alliance",
      createdAtTick: 1,
      deadlineTick: 3,
      status: "pending",
    };
    world.pendingProposals.push(proposal);

    expireProposals(world, ctxAt(3));

    expect(world.pendingProposals).toHaveLength(0);
    const rel = findRelationship(world, "wrestler-0", "wrestler-1");
    expect(rel?.affinity).toBeLessThan(0);
  });

  it("leaves a proposal pending before its deadline", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    const proposal: Proposal = {
      id: "prop-2",
      proposerWrestlerId: "wrestler-0",
      recipientWrestlerId: "wrestler-1",
      originatingIntent: "propose_alliance",
      createdAtTick: 1,
      deadlineTick: 3,
      status: "pending",
    };
    world.pendingProposals.push(proposal);
    expireProposals(world, ctxAt(2));
    expect(world.pendingProposals).toHaveLength(1);
  });

  it("an accepted response improves both sides' relationship and clears the pending list", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    world.pendingProposals.push({
      id: "prop-3",
      proposerWrestlerId: "wrestler-0",
      recipientWrestlerId: "wrestler-1",
      originatingIntent: "propose_alliance",
      createdAtTick: 1,
      deadlineTick: 3,
      status: "pending",
    });
    const turns = new Map<string, PlayerTurn>([
      [
        "wrestler-1",
        {
          wrestlerId: "wrestler-1",
          reactiveResponses: [],
          proposalResponses: [{ proposalId: "prop-3", response: "accept" }],
          matchIntents: {},
          segmentIntents: {},
        },
      ],
    ]);
    resolveProposalResponses(world, turns, ctxAt(2));
    expect(world.pendingProposals).toHaveLength(0);
    expect(findRelationship(world, "wrestler-1", "wrestler-0")?.affinity).toBeGreaterThan(0);
    expect(findRelationship(world, "wrestler-0", "wrestler-1")?.affinity).toBeGreaterThan(0);
  });

  it("countering a proposal spins up a new proposal with roles reversed (minor tuning gap)", () => {
    const world = createTestWorld({ wrestlerCount: 2 });
    world.pendingProposals.push({
      id: "prop-4",
      proposerWrestlerId: "wrestler-0",
      recipientWrestlerId: "wrestler-1",
      originatingIntent: "propose_alliance",
      createdAtTick: 1,
      deadlineTick: 3,
      status: "pending",
    });
    const turns = new Map<string, PlayerTurn>([
      [
        "wrestler-1",
        {
          wrestlerId: "wrestler-1",
          reactiveResponses: [],
          proposalResponses: [{ proposalId: "prop-4", response: "counter", counterPayload: "only if you back me too" }],
          matchIntents: {},
          segmentIntents: {},
        },
      ],
    ]);

    resolveProposalResponses(world, turns, ctxAt(2));

    expect(world.pendingProposals).toHaveLength(1);
    const counter = world.pendingProposals[0];
    expect(counter?.proposerWrestlerId).toBe("wrestler-1");
    expect(counter?.recipientWrestlerId).toBe("wrestler-0");
    expect(counter?.originatingIntent).toBe("propose_alliance");
    expect(counter?.payload).toBe("only if you back me too");
    expect(counter?.status).toBe("pending");
  });
});

describe("reactive decision expiry and resolution (spec §5)", () => {
  it("expires an overdue pending reactive decision", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    const decision: ReactiveDecision = {
      id: "reactive-1",
      type: "booking_request",
      targetWrestlerId: "wrestler-0",
      offeredResponses: ["accept", "refuse"],
      deadlineTick: 2,
      status: "pending",
    };
    world.pendingReactiveDecisions.push(decision);
    expireReactiveDecisions(world, ctxAt(2));
    expect(world.pendingReactiveDecisions).toHaveLength(0);
  });

  it("resolves a response and removes the decision from the pending list", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    world.pendingReactiveDecisions.push({
      id: "reactive-2",
      type: "booking_request",
      targetWrestlerId: "wrestler-0",
      offeredResponses: ["accept", "refuse"],
      deadlineTick: 5,
      status: "pending",
    });
    const turns = new Map<string, PlayerTurn>([
      [
        "wrestler-0",
        {
          wrestlerId: "wrestler-0",
          reactiveResponses: [{ reactiveDecisionId: "reactive-2", response: "accept" }],
          proposalResponses: [],
          matchIntents: {},
          segmentIntents: {},
        },
      ],
    ]);
    resolveReactiveResponses(world, turns, ctxAt(1));
    expect(world.pendingReactiveDecisions).toHaveLength(0);
  });
});
