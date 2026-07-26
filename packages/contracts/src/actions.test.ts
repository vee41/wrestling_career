import { describe, expect, it } from "vitest";
import { actionSchema } from "./actions.js";

describe("actionSchema", () => {
  it("round-trips a train_skill action through parse -> serialize -> parse", () => {
    const action = {
      type: "train_skill",
      id: "action-1",
      wrestlerId: "ace-steel",
      skill: "athleticism",
    };
    const parsed = actionSchema.parse(action);
    const roundTripped = actionSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("parses every action-slot variant", () => {
    const actions = [
      { type: "train_skill", id: "a-1", wrestlerId: "ace-steel", skill: "psychology" },
      { type: "recover", id: "a-2", wrestlerId: "ace-steel" },
      { type: "promote_match", id: "a-3", wrestlerId: "ace-steel", matchSlotId: "slot-main-event" },
      {
        type: "develop_character",
        id: "a-4",
        wrestlerId: "ace-steel",
        adjustment: { promoTone: "cocky" },
      },
    ];
    for (const action of actions) {
      const parsed = actionSchema.parse(action);
      expect(parsed.type).toBe(action.type);
    }
  });

  it("rejects a train_skill action with an unknown skill name", () => {
    expect(() =>
      actionSchema.parse({ type: "train_skill", id: "a-5", wrestlerId: "ace-steel", skill: "charisma" }),
    ).toThrow();
  });

  it("rejects the legacy pitch_feud action type (moved to interactions in Phase 1.5)", () => {
    expect(() =>
      actionSchema.parse({
        type: "pitch_feud",
        id: "a-6",
        wrestlerId: "ace-steel",
        targetWrestlerId: "vic-vendetta",
        pitch: "let's feud",
      }),
    ).toThrow();
  });

  it("rejects the legacy adjust_gimmick action type (renamed to develop_character)", () => {
    expect(() =>
      actionSchema.parse({
        type: "adjust_gimmick",
        id: "a-7",
        wrestlerId: "ace-steel",
        adjustment: { promoTone: "cocky" },
      }),
    ).toThrow();
  });

  it("rejects an unknown action type", () => {
    expect(() => actionSchema.parse({ type: "cut_a_promo", id: "a-8", wrestlerId: "ace-steel" })).toThrow();
  });
});
