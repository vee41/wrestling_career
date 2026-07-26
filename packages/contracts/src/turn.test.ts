import { describe, expect, it } from "vitest";
import { playerTurnSchema } from "./turn.js";

describe("playerTurnSchema", () => {
  it("round-trips a full turn (interaction + action + intents + stance change)", () => {
    const turn = {
      wrestlerId: "ace-steel",
      interaction: {
        id: "interaction-1",
        wrestlerId: "ace-steel",
        target: { kind: "gm" },
        intent: "challenge_booking",
      },
      action: {
        type: "promote_match",
        id: "action-1",
        wrestlerId: "ace-steel",
        matchSlotId: "slot-main-event",
      },
      reactiveResponses: [{ reactiveDecisionId: "reactive-1", response: "negotiate" }],
      proposalResponses: [],
      matchIntents: { "slot-main-event": "advance_story" },
      segmentIntents: {},
      stanceChange: "chase_popularity",
    };
    const parsed = playerTurnSchema.parse(turn);
    const roundTripped = playerTurnSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("allows an empty turn (both slots unused; still simulated)", () => {
    const parsed = playerTurnSchema.parse({ wrestlerId: "dusty-cole" });
    expect(parsed.reactiveResponses).toEqual([]);
    expect(parsed.matchIntents).toEqual({});
  });

  it("rejects a turn whose interaction belongs to a different wrestler", () => {
    expect(() =>
      playerTurnSchema.parse({
        wrestlerId: "ace-steel",
        interaction: {
          id: "interaction-2",
          wrestlerId: "dusty-cole",
          target: { kind: "gm" },
          intent: "request_feedback",
        },
      }),
    ).toThrow();
  });

  it("rejects a turn whose action belongs to a different wrestler", () => {
    expect(() =>
      playerTurnSchema.parse({
        wrestlerId: "ace-steel",
        action: { type: "recover", id: "action-2", wrestlerId: "dusty-cole" },
      }),
    ).toThrow();
  });
});
