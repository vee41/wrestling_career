import { describe, expect, it } from "vitest";
import { matchIntentSchema, segmentIntentSchema } from "./intent.js";

describe("matchIntentSchema", () => {
  it("accepts all 9 canonical match intent tokens", () => {
    const tokens = [
      "protect_character",
      "elevate_opponent",
      "chase_quality",
      "work_safely",
      "play_to_crowd",
      "advance_story",
      "take_risks",
      "follow_plan",
      "steal_spotlight",
    ];
    expect(matchIntentSchema.options).toHaveLength(9);
    for (const token of tokens) {
      expect(() => matchIntentSchema.parse(token)).not.toThrow();
    }
  });

  it("rejects the legacy pre-1.5 tokens", () => {
    for (const legacy of ["make_opponent_look_strong", "emphasise_story", "chase_spectacle"]) {
      expect(() => matchIntentSchema.parse(legacy)).toThrow();
    }
  });
});

describe("segmentIntentSchema", () => {
  it("accepts all 8 canonical segment intent tokens", () => {
    expect(segmentIntentSchema.options).toHaveLength(8);
    for (const token of segmentIntentSchema.options) {
      expect(() => segmentIntentSchema.parse(token)).not.toThrow();
    }
  });
});
