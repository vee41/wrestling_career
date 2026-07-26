import { describe, expect, it } from "vitest";
import { reactiveDecisionSchema, reactiveResponseSchema } from "./reactive.js";

const validDecision = {
  id: "reactive-vic-post-match-attack",
  type: "wrestler_proposal",
  targetWrestlerId: "ace-steel",
  originWrestlerId: "vic-vendetta",
  originStoryId: "story-ace-vs-vic",
  originMatchId: "match-week-3-main-event",
  offeredResponses: ["accept", "refuse", "negotiate"],
  deadlineTick: 4,
  status: "pending",
};

describe("reactiveDecisionSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = reactiveDecisionSchema.parse(validDecision);
    const roundTripped = reactiveDecisionSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("allows a decision with no origin refs (e.g. a rumor with no single source)", () => {
    const { originStoryId: _s, originMatchId: _m, originWrestlerId: _w, ...minimal } = validDecision;
    expect(() => reactiveDecisionSchema.parse(minimal)).not.toThrow();
  });

  it("requires at least one offered response", () => {
    expect(() => reactiveDecisionSchema.parse({ ...validDecision, offeredResponses: [] })).toThrow();
  });

  it("rejects an unknown decision type", () => {
    expect(() => reactiveDecisionSchema.parse({ ...validDecision, type: "sponsor_request" })).toThrow();
  });

  it("rejects an unknown offered response token", () => {
    expect(() =>
      reactiveDecisionSchema.parse({ ...validDecision, offeredResponses: ["shrug"] }),
    ).toThrow();
  });
});

describe("reactiveResponseSchema", () => {
  it("round-trips a response", () => {
    const response = { reactiveDecisionId: "reactive-vic-post-match-attack", response: "negotiate" };
    const parsed = reactiveResponseSchema.parse(response);
    expect(parsed).toEqual(response);
  });
});
