import { describe, expect, it } from "vitest";
import { programPlanSchema } from "./program-plan.js";
import { worldStateSchema } from "./world.js";
import { exampleWorldState } from "./fixtures.js";

const validPlan = {
  id: "program-ace-vic",
  storyId: "story-ace-vs-vic",
  participants: [
    { wrestlerId: "ace-steel", role: "protagonist" },
    { wrestlerId: "vic-vendetta", role: "antagonist" },
  ],
  premise: "Ace and Vic are on a collision course.",
  creativeObjective: "establish_challenger",
  priority: 4,
  startTick: 3,
  targetPayoffTick: 11,
  intendedPayoff: "Settle the number-one contendership.",
  protectedWrestlerIds: ["ace-steel"],
  escalation: 1,
  status: "active",
  plannedBeatIds: [],
  completedBeatIds: [],
  directMatchCooldownTicks: 3,
  directMatchRepetitionBudget: 1,
  revisions: [{
    id: "revision-1",
    tick: 3,
    reason: "initial_plan",
    newIntent: {
      creativeObjective: "establish_challenger",
      targetPayoffTick: 11,
      intendedPayoff: "Settle the number-one contendership.",
      protectedWrestlerIds: ["ace-steel"],
    },
  }],
};

describe("ProgramPlan contracts", () => {
  it("round-trips a private plan and its structured initial revision", () => {
    const parsed = programPlanSchema.parse(validPlan);
    expect(programPlanSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects a payoff before the plan starts and protected outsiders", () => {
    expect(() => programPlanSchema.parse({ ...validPlan, targetPayoffTick: 2 })).toThrow(/must not precede/);
    expect(() => programPlanSchema.parse({ ...validPlan, protectedWrestlerIds: ["dusty-cole"] })).toThrow(/must belong/);
  });

  it("enforces world references and one active plan per story", () => {
    expect(() => worldStateSchema.parse({
      ...exampleWorldState,
      programPlans: [{ ...validPlan, storyId: "missing-story" }],
    })).toThrow(/unknown story id/);
    expect(() => worldStateSchema.parse({
      ...exampleWorldState,
      programPlans: [validPlan, { ...validPlan, id: "program-duplicate" }],
    })).toThrow(/one active program plan/);
  });
});
