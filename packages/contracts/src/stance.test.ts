import { describe, expect, it } from "vitest";
import { careerStanceSchema, wrestlerStanceSchema } from "./stance.js";

describe("careerStanceSchema", () => {
  it("accepts all 9 canonical stance tokens", () => {
    expect(careerStanceSchema.options).toHaveLength(9);
  });
});

describe("wrestlerStanceSchema", () => {
  it("round-trips a stance without a queued change", () => {
    const stance = { wrestlerId: "ace-steel", stance: "pursue_championships" };
    const parsed = wrestlerStanceSchema.parse(stance);
    const roundTripped = wrestlerStanceSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("round-trips a stance with a queued pendingStance (inertia, spec §7.3)", () => {
    const stance = {
      wrestlerId: "dusty-cole",
      stance: "avoid_conflict",
      pendingStance: "seek_match_quality",
    };
    const parsed = wrestlerStanceSchema.parse(stance);
    expect(parsed.pendingStance).toBe("seek_match_quality");
  });

  it("rejects an unknown stance token", () => {
    expect(() =>
      wrestlerStanceSchema.parse({ wrestlerId: "ace-steel", stance: "chill_out" }),
    ).toThrow();
  });
});
