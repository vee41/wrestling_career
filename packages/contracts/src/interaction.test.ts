import { describe, expect, it } from "vitest";
import { interactionOutcomeSchema, interactionSchema } from "./interaction.js";

describe("interactionSchema", () => {
  it("round-trips a gm-targeted interaction through parse -> serialize -> parse", () => {
    const interaction = {
      id: "interaction-1",
      wrestlerId: "ace-steel",
      target: { kind: "gm" },
      intent: "challenge_booking",
      emphasis: "I deserve to stay in this story.",
    };
    const parsed = interactionSchema.parse(interaction);
    const roundTripped = interactionSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("round-trips a wrestler-targeted interaction", () => {
    const interaction = {
      id: "interaction-2",
      wrestlerId: "dusty-cole",
      target: { kind: "wrestler", wrestlerId: "ace-steel" },
      intent: "propose_alliance",
    };
    const parsed = interactionSchema.parse(interaction);
    expect(parsed.target).toEqual({ kind: "wrestler", wrestlerId: "ace-steel" });
  });

  it("requires wrestlerId when target kind is wrestler", () => {
    expect(() =>
      interactionSchema.parse({
        id: "interaction-3",
        wrestlerId: "dusty-cole",
        target: { kind: "wrestler" },
        intent: "provoke",
      }),
    ).toThrow();
  });

  it("rejects a post-prototype target kind (mentor/agent/sponsor/media/partner)", () => {
    expect(() =>
      interactionSchema.parse({
        id: "interaction-4",
        wrestlerId: "dusty-cole",
        target: { kind: "mentor" },
        intent: "request_feedback",
      }),
    ).toThrow();
  });

  it("rejects an unknown intent token", () => {
    expect(() =>
      interactionSchema.parse({
        id: "interaction-5",
        wrestlerId: "dusty-cole",
        target: { kind: "gm" },
        intent: "cut_a_promo",
      }),
    ).toThrow();
  });

  it("rejects a wrestler-only intent aimed at the gm (spec §3.2)", () => {
    expect(() =>
      interactionSchema.parse({
        id: "interaction-6",
        wrestlerId: "dusty-cole",
        target: { kind: "gm" },
        intent: "provoke",
      }),
    ).toThrow(/not valid for this target kind/);
  });

  it("rejects a gm-only intent aimed at a wrestler (spec §3.3)", () => {
    expect(() =>
      interactionSchema.parse({
        id: "interaction-7",
        wrestlerId: "dusty-cole",
        target: { kind: "wrestler", wrestlerId: "ace-steel" },
        intent: "challenge_booking",
      }),
    ).toThrow(/not valid for this target kind/);
  });

  it("accepts pitch_feud toward either target — the one shared intent", () => {
    for (const target of [{ kind: "gm" }, { kind: "wrestler", wrestlerId: "ace-steel" }]) {
      expect(() =>
        interactionSchema.parse({
          id: "interaction-8",
          wrestlerId: "dusty-cole",
          target,
          intent: "pitch_feud",
        }),
      ).not.toThrow();
    }
  });
});

describe("interactionOutcomeSchema", () => {
  it("accepts every documented outcome token", () => {
    for (const outcome of ["accepted", "rejected", "deferred", "conditional", "countered"]) {
      expect(() => interactionOutcomeSchema.parse(outcome)).not.toThrow();
    }
  });
});
