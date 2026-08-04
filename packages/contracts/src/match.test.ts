import { describe, expect, it } from "vitest";
import { matchResultSchema, segmentResultSchema } from "./match.js";

const validMatchResult = {
  id: "match-week-3-main-event",
  matchSlotId: "slot-main-event",
  showId: "show-week-3",
  participantWrestlerIds: ["ace-steel", "vic-vendetta"],
  winnerWrestlerId: "vic-vendetta",
  quality: 78,
  crowdResponse: 82,
  chemistry: 74,
  storyId: "story-ace-vs-vic",
  storyAdvancement: 18,
  performances: [
    {
      wrestlerId: "ace-steel",
      performanceScore: 75,
      characterCredibilityDelta: 10,
      physicalCost: 35,
      gmReactionDelta: 8,
      backstageReactionDelta: 5,
    },
    {
      wrestlerId: "vic-vendetta",
      performanceScore: 70,
      characterCredibilityDelta: -5,
      physicalCost: 25,
      gmReactionDelta: 4,
      backstageReactionDelta: -2,
    },
  ],
};

describe("matchResultSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = matchResultSchema.parse(validMatchResult);
    const roundTripped = matchResultSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("allows a losing wrestler's performance to raise their credibility (GDD §14)", () => {
    const loserGainsCredibility = {
      ...validMatchResult,
      performances: [
        { ...validMatchResult.performances[0], characterCredibilityDelta: 25 },
        validMatchResult.performances[1],
      ],
    };
    const parsed = matchResultSchema.parse(loserGainsCredibility);
    const loser = parsed.performances.find((p) => p.wrestlerId !== parsed.winnerWrestlerId);
    expect(loser?.characterCredibilityDelta).toBeGreaterThan(0);
  });

  it("rejects a winner who did not participate", () => {
    expect(() =>
      matchResultSchema.parse({ ...validMatchResult, winnerWrestlerId: "dusty-cole" }),
    ).toThrow();
  });

  it("rejects a performance list that does not match the participant list", () => {
    const missingPerformance = {
      ...validMatchResult,
      performances: [validMatchResult.performances[0]],
    };
    expect(() => matchResultSchema.parse(missingPerformance)).toThrow();
  });

  it("records an auditable planned and actual finish", () => {
    const result = matchResultSchema.parse({
      ...validMatchResult,
      plannedFinish: {
        intendedWinnerWrestlerId: "vic-vendetta", finishFamily: "dirty",
        protectedWrestlerIds: ["ace-steel"], intendedTitleConsequence: "retain",
        intendedStoryEffect: "The champion survives the challenge.", adherenceStrength: "strict",
      },
      actualOutcome: {
        winnerWrestlerId: "vic-vendetta", finishFamily: "dirty", titleConsequence: "retain",
        storyEffect: "The champion survives the challenge.",
      },
      adherence: "adhered",
    });
    expect(result.actualOutcome?.winnerWrestlerId).toBe(result.plannedFinish?.intendedWinnerWrestlerId);
  });

  it("rejects a planned winner outside the match", () => {
    expect(() => matchResultSchema.parse({
      ...validMatchResult,
      plannedFinish: {
        intendedWinnerWrestlerId: "dusty-cole", finishFamily: "clean", protectedWrestlerIds: [],
        intendedTitleConsequence: "none", intendedStoryEffect: "Impossible.", adherenceStrength: "standard",
      },
    })).toThrow();
  });

  it("round-trips a solo segment result without a competitive winner", () => {
    const result = segmentResultSchema.parse({
      id: "segment-1", segmentSlotId: "slot-promo", showId: "show-1",
      participantWrestlerIds: ["ace-steel"], dominantWrestlerId: "ace-steel",
      quality: 72, crowdResponse: 74, storyAdvancement: 18,
      intents: { "ace-steel": "build_sympathy" },
      performances: [{ wrestlerId: "ace-steel", performanceScore: 72, positiveHeatDelta: 10, negativeHeatDelta: 0, storyAdvancement: 8 }],
    });
    expect(segmentResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
});
