import { describe, expect, it } from "vitest";
import { scenarioSchema } from "./scenario.js";

const validScenario = {
  manifest: { id: "test-scenario", name: "Test Scenario", description: "A compact scenario fixture.", formatVersion: 1 },
  promotion: { name: "Test Wrestling", identityBlurb: "A test promotion.", weeklyTvShowName: "Test TV", pleCalendar: ["Test PLE"] },
  roster: [
    {
      wrestler: { id: "alpha", name: "Alpha", skills: { ringPerformance: 60, psychology: 60, promoAbility: 60, characterWork: 60, athleticism: 60, toughness: 60, professionalism: 60, politicalInstinct: 60 }, condition: 90, money: 1000, alignment: "face", role: "regular", gimmick: { concept: "Hero", promoTone: "earnest", traits: ["brave"], presentation: "simple gear", currentDirection: "rising" } },
      popularity: { wrestlerId: "alpha", currentReaction: 50, generalPopularity: 50, starPower: 50, momentum: 0, positiveHeat: 50, negativeHeat: 0, fatigue: 0 },
      stance: "pursue_championships",
    },
    {
      wrestler: { id: "beta", name: "Beta", skills: { ringPerformance: 60, psychology: 60, promoAbility: 60, characterWork: 60, athleticism: 60, toughness: 60, professionalism: 60, politicalInstinct: 60 }, condition: 90, money: 1000, alignment: "heel", role: "regular", gimmick: { concept: "Villain", promoTone: "smug", traits: ["ruthless"], presentation: "dark gear", currentDirection: "rising" } },
      popularity: { wrestlerId: "beta", currentReaction: 50, generalPopularity: 50, starPower: 50, momentum: 0, positiveHeat: 0, negativeHeat: 50, fatigue: 0 },
      stance: "protect_character",
    },
  ],
  titles: [
    { id: "world", name: "World Title", tier: "world", initialHolderId: "alpha" },
    { id: "mid", name: "Midcard Title", tier: "midcard", initialHolderId: "beta" },
  ],
  relationships: [],
  stories: [],
  config: {},
};

describe("scenarioSchema", () => {
  it("validates a complete scenario and applies config defaults", () => {
    const parsed = scenarioSchema.parse(validScenario);
    expect(parsed.config.sliceWeeks).toBe(26);
  });

  it("rejects cross-file references to roster ids that do not exist", () => {
    const invalid = { ...validScenario, titles: [{ ...validScenario.titles[0]!, initialHolderId: "unknown" }, validScenario.titles[1]!] };
    expect(() => scenarioSchema.parse(invalid)).toThrow(/unknown roster id.*unknown/);
  });

  it("requires roster popularity to belong to that roster wrestler", () => {
    const first = validScenario.roster[0]!;
    const invalid = { ...validScenario, roster: [{ ...first, popularity: { ...first.popularity, wrestlerId: "beta" } }, validScenario.roster[1]!] };
    expect(() => scenarioSchema.parse(invalid)).toThrow(/must match the roster wrestler id/);
  });
});
