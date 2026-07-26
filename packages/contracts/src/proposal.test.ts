import { describe, expect, it } from "vitest";
import { proposalResponseSchema, proposalSchema } from "./proposal.js";

const validProposal = {
  id: "proposal-dusty-to-ace-alliance",
  proposerWrestlerId: "dusty-cole",
  recipientWrestlerId: "ace-steel",
  originatingIntent: "propose_alliance",
  payload: "Let's watch each other's backs against Vic's crew.",
  createdAtTick: 3,
  deadlineTick: 5,
  status: "pending",
};

describe("proposalSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = proposalSchema.parse(validProposal);
    const roundTripped = proposalSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("enforces the 2-tick response deadline (spec §3.3)", () => {
    expect(() => proposalSchema.parse({ ...validProposal, deadlineTick: 4 })).toThrow();
    expect(() => proposalSchema.parse({ ...validProposal, deadlineTick: 6 })).toThrow();
  });

  it("rejects a proposal targeting its own proposer", () => {
    expect(() =>
      proposalSchema.parse({ ...validProposal, recipientWrestlerId: validProposal.proposerWrestlerId }),
    ).toThrow();
  });

  it("allows an expired proposal to resolve as ignored", () => {
    expect(() => proposalSchema.parse({ ...validProposal, status: "ignored" })).not.toThrow();
  });
});

describe("proposalResponseSchema", () => {
  it("round-trips a counter response with a payload", () => {
    const response = {
      proposalId: "proposal-dusty-to-ace-alliance",
      response: "counter",
      counterPayload: "Only if it's not public yet.",
    };
    const parsed = proposalResponseSchema.parse(response);
    expect(parsed).toEqual(response);
  });

  it("rejects an unknown response token", () => {
    expect(() =>
      proposalResponseSchema.parse({ proposalId: "proposal-1", response: "maybe" }),
    ).toThrow();
  });
});
