import { describe, expect, it } from "vitest";
import { scenarioSchema, worldStateSchema } from "@wrestling/contracts";
import { worldFromScenario } from "./scenario.js";

const scenario = scenarioSchema.parse({
  manifest: { id: "conversion-test", name: "Conversion Test", description: "A conversion fixture.", formatVersion: 1 },
  promotion: { name: "Test Wrestling", identityBlurb: "A test promotion.", weeklyTvShowName: "Test TV", pleCalendar: ["First Test PLE"] },
  roster: [
    { wrestler: { id: "alpha", name: "Alpha", skills: { ringPerformance: 70, psychology: 70, promoAbility: 70, characterWork: 70, athleticism: 70, toughness: 70, professionalism: 70, politicalInstinct: 70 }, condition: 90, money: 1000, alignment: "face", gimmick: { concept: "Hero", promoTone: "earnest", traits: ["brave"], presentation: "simple gear", currentDirection: "rising" } }, popularity: { wrestlerId: "alpha", currentReaction: 60, generalPopularity: 60, starPower: 60, momentum: 2, positiveHeat: 60, negativeHeat: 0, fatigue: 0 }, stance: "pursue_championships" },
    { wrestler: { id: "beta", name: "Beta", skills: { ringPerformance: 60, psychology: 60, promoAbility: 60, characterWork: 60, athleticism: 60, toughness: 60, professionalism: 60, politicalInstinct: 60 }, condition: 90, money: 1000, alignment: "heel", gimmick: { concept: "Villain", promoTone: "smug", traits: ["ruthless"], presentation: "dark gear", currentDirection: "rising" } }, popularity: { wrestlerId: "beta", currentReaction: 50, generalPopularity: 50, starPower: 50, momentum: 0, positiveHeat: 0, negativeHeat: 50, fatigue: 0 }, stance: "protect_character" },
  ],
  titles: [{ id: "world", name: "World Title", tier: "world", initialHolderId: "alpha" }, { id: "mid", name: "Midcard Title", tier: "midcard", initialHolderId: "beta" }],
  relationships: [], stories: [], config: {},
});

describe("worldFromScenario", () => {
  it("creates a schema-valid AI-owned world while preserving scenario seeds", () => {
    const world = worldFromScenario(scenario, "scenario-seed");
    expect(() => worldStateSchema.parse(world)).not.toThrow();
    expect(world.wrestlers.every((wrestler) => wrestler.controlledBy === "ai")).toBe(true);
    expect(world.titles.find((title) => title.tier === "world")?.holderId).toBe("alpha");
    expect(world.stances).toContainEqual({ wrestlerId: "alpha", stance: "pursue_championships" });
    expect(world.promotion.pleCalendar).toEqual(["First Test PLE"]);
  });
});
