import { describe, expect, it } from "vitest";
import { wrestlerSchema } from "./wrestler.js";

const validWrestler = {
  id: "ace-steel",
  name: "Ace Steel",
  controlledBy: "human",
  skills: {
    ringPerformance: 62,
    psychology: 55,
    promoAbility: 48,
    characterWork: 50,
    athleticism: 70,
    toughness: 60,
    professionalism: 65,
    politicalInstinct: 40,
  },
  condition: 82,
  money: 1200,
  alignment: "face",
  gimmick: {
    concept: "Underdog technician",
    promoTone: "earnest",
    traits: ["determined", "humble"],
    presentation: "classic singlet, no frills",
    currentDirection: "chasing a title opportunity",
  },
};

describe("wrestlerSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = wrestlerSchema.parse(validWrestler);
    const roundTripped = wrestlerSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a skill value outside 0-100", () => {
    const invalid = { ...validWrestler, skills: { ...validWrestler.skills, athleticism: 101 } };
    expect(() => wrestlerSchema.parse(invalid)).toThrow();
  });

  it("rejects an unknown alignment", () => {
    const invalid = { ...validWrestler, alignment: "villain" };
    expect(() => wrestlerSchema.parse(invalid)).toThrow();
  });

  it("rejects negative money", () => {
    const invalid = { ...validWrestler, money: -1 };
    expect(() => wrestlerSchema.parse(invalid)).toThrow();
  });
});
