import { describe, expect, it } from "vitest";
import { relationshipSchema } from "./relationship.js";

const validRelationship = {
  fromWrestlerId: "ace-steel",
  toWrestlerId: "vic-vendetta",
  affinity: -40,
  respect: 20,
  trust: -10,
  rivalry: 80,
  resentment: 30,
  influence: 15,
};

describe("relationshipSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = relationshipSchema.parse(validRelationship);
    const roundTripped = relationshipSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a relationship where a wrestler is related to themself", () => {
    const invalid = { ...validRelationship, toWrestlerId: validRelationship.fromWrestlerId };
    expect(() => relationshipSchema.parse(invalid)).toThrow();
  });

  it("rejects rivalry outside 0-100 (it is a magnitude, not signed)", () => {
    expect(() => relationshipSchema.parse({ ...validRelationship, rivalry: -1 })).toThrow();
  });
});
