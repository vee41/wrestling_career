import { describe, expect, it } from "vitest";
import { popularityBlockSchema } from "./popularity.js";

const validPopularity = {
  wrestlerId: "ace-steel",
  currentReaction: 70,
  generalPopularity: 55,
  starPower: 55,
  momentum: 8,
  positiveHeat: 60,
  negativeHeat: 5,
  fatigue: 20,
};

describe("popularityBlockSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = popularityBlockSchema.parse(validPopularity);
    const roundTripped = popularityBlockSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("allows negative momentum (cooling off) down to -100", () => {
    expect(() => popularityBlockSchema.parse({ ...validPopularity, momentum: -100 })).not.toThrow();
  });

  it("rejects momentum outside -100..100", () => {
    expect(() => popularityBlockSchema.parse({ ...validPopularity, momentum: -101 })).toThrow();
  });

  it("is not a single collapsed score: fields vary independently", () => {
    const parsed = popularityBlockSchema.parse({
      ...validPopularity,
      currentReaction: 90,
      generalPopularity: 10,
    });
    expect(parsed.currentReaction).not.toBe(parsed.generalPopularity);
  });

  it("requires the earned-status star-power anchor", () => {
    const { starPower: _starPower, ...withoutStarPower } = validPopularity;
    expect(() => popularityBlockSchema.parse(withoutStarPower)).toThrow();
  });
});
