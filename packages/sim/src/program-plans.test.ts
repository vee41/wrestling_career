import { describe, expect, it } from "vitest";
import type { Story } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { createIdFactory } from "./ids.js";
import { rotateGmObjectiveIfDue } from "./gm.js";
import { planPrograms, reviseProgramPlan } from "./program-plans.js";
import { createRng } from "./rng.js";
import { createTestWorld } from "./test-helpers.js";

function ctxAt(tick: number, seed = "program-plan-seed"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function story(id: string, participants: string[], audienceInterest: number): Story {
  return {
    id,
    participantWrestlerIds: participants,
    tension: "grudge",
    tensionDescription: `${id} is a test rivalry.`,
    stakes: "test stakes",
    audienceInterest,
    momentum: 12,
    coherence: 75,
    phase: "building",
    unresolvedDevelopments: [],
  };
}

function plannedWorld() {
  const world = createTestWorld({ wrestlerCount: 6, seed: "program-plan-world" });
  world.stories = [
    story("story-a", ["wrestler-0", "wrestler-1"], 82),
    story("story-b", ["wrestler-2", "wrestler-3"], 70),
    story("story-c", ["wrestler-4", "wrestler-5"], 60),
  ];
  return world;
}

describe("planPrograms", () => {
  it("builds a deterministic bounded portfolio and records selected and rejected candidates", () => {
    const left = plannedWorld();
    const right = plannedWorld();
    planPrograms(left, ctxAt(0, "same"));
    planPrograms(right, ctxAt(0, "same"));

    expect(left.programPlans).toHaveLength(3);
    expect(left.programPlans).toEqual(right.programPlans);
    expect(left.programPlanCandidates).toEqual(right.programPlanCandidates);
    expect(left.programPlans.every((plan) => plan.targetPayoffTick === 11 && plan.revisions.length === 1)).toBe(true);
    expect(left.programPlanCandidates.some((candidate) => candidate.disposition === "selected")).toBe(true);
    expect(left.programPlanCandidates.some((candidate) => candidate.disposition === "rejected")).toBe(true);

    planPrograms(left, ctxAt(1, "same"));
    expect(left.programPlans).toHaveLength(3);
  });

  it("records unavailable and conflicting participants as hard-invalid candidates", () => {
    const unavailable = plannedWorld();
    unavailable.wrestlers.find((wrestler) => wrestler.id === "wrestler-0")!.condition = 20;
    planPrograms(unavailable, ctxAt(0));
    expect(unavailable.programPlans.some((plan) => plan.storyId === "story-a")).toBe(false);
    expect(unavailable.programPlanCandidates
      .filter((candidate) => candidate.storyId === "story-a")
      .every((candidate) => candidate.disposition === "hard_invalid" && candidate.hardInvalidReasons.some((reason) => reason.startsWith("participant_unavailable:"))))
      .toBe(true);

    const conflicting = createTestWorld({ wrestlerCount: 4, seed: "program-plan-conflict" });
    conflicting.stories = [
      story("story-high", ["wrestler-0", "wrestler-1"], 90),
      story("story-low", ["wrestler-1", "wrestler-2"], 50),
    ];
    planPrograms(conflicting, ctxAt(0));
    expect(conflicting.programPlans.map((plan) => plan.storyId)).toEqual(["story-high"]);
    expect(conflicting.programPlanCandidates
      .filter((candidate) => candidate.storyId === "story-low")
      .every((candidate) => candidate.disposition === "hard_invalid" && candidate.hardInvalidReasons.some((reason) => reason.startsWith("participant_conflict:"))))
      .toBe(true);
  });

  it("appends revisions instead of silently overwriting creative intent", () => {
    const world = plannedWorld();
    planPrograms(world, ctxAt(0));
    const plan = world.programPlans[0]!;
    const originalPayoff = plan.intendedPayoff;
    reviseProgramPlan(world, ctxAt(1), plan.id, "crowd_response", {
      creativeObjective: "redeem_act",
      targetPayoffTick: 11,
      intendedPayoff: "Redeem the protagonist at the target PLE.",
      protectedWrestlerIds: [plan.participants[0]!.wrestlerId],
    });
    expect(plan.revisions).toHaveLength(2);
    expect(plan.revisions[1]).toMatchObject({
      reason: "crowd_response",
      previousIntent: { intendedPayoff: originalPayoff },
      newIntent: { intendedPayoff: "Redeem the protagonist at the target PLE." },
    });
    expect(world.events.some((event) => event.type === "program_plan_revised")).toBe(true);
  });
});

describe("GM objective persistence", () => {
  it("holds the objective for a full PLE cycle and never chooses an unsupported tag objective", () => {
    const world = plannedWorld();
    const cycleTicks = world.config.pleIntervalWeeks * (world.config.decisionTicksPerWeek + 1);
    const initial = world.gmObjective;
    rotateGmObjectiveIfDue(world, ctxAt(cycleTicks - 1));
    expect(world.gmObjective).toBe(initial);
    rotateGmObjectiveIfDue(world, ctxAt(cycleTicks));
    expect(world.gmObjective).not.toBe("strengthen_tag_division");
  });
});
