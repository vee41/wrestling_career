import { describe, expect, it } from "vitest";
import { worldStateSchema, type PlannedBeat, type ProgramPlan, type Story, type WorldState } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { advanceProgramPlanLifecycle, planPrograms } from "./program-plans.js";
import { advanceStories } from "./stories.js";
import { bookShow } from "./gm.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { resolveCard } from "./card.js";
import { runTick } from "./tick.js";
import { worldFromScenario } from "./scenario.js";

function ctxAt(tick: number, seed = "lifecycle"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function beatsOf(world: WorldState, plan: ProgramPlan): PlannedBeat[] {
  return world.plannedBeats.filter((beat) => beat.programId === plan.id);
}

/** TV shows that actually aired after a plan started — the beats it could have run. */
function buildShowsSince(world: WorldState, startTick: number): number {
  return world.shows.filter((show) => show.kind === "tv" && show.tick > startTick && show.tick < world.tick).length;
}

function liveWorld(weeks: number, seed = "lifecycle-1"): WorldState {
  let world = worldFromScenario(loadDefaultScenario(), seed);
  const ticks = weeks * (world.config.decisionTicksPerWeek + 1);
  for (let tick = 0; tick < ticks; tick++) world = runTick(world, [], world.seed).world;
  return world;
}

function isOpen(plan: ProgramPlan): boolean {
  return plan.status === "active" || plan.status === "payoff_ready";
}

function story(id: string, participants: string[], overrides: Partial<Story> = {}): Story {
  return {
    id, participantWrestlerIds: participants, tension: "grudge",
    tensionDescription: `${id} is a test rivalry.`, stakes: "test stakes",
    audienceInterest: 80, momentum: 12, coherence: 75, phase: "building",
    unresolvedDevelopments: [], ...overrides,
  };
}

function plannedWorld(): WorldState {
  const world = createTestWorld({ wrestlerCount: 6, humanCount: 0, seed: "lifecycle-world" });
  world.stories = [story("story-a", ["wrestler-0", "wrestler-1"])];
  planPrograms(world, ctxAt(0));
  return world;
}

/**
 * Phase 3.12.3's acceptance tests. Isolated beat fixtures passed for three
 * phases while the composed loop stranded whole programs — every beat skipped,
 * the payoff never reachable, and the plan left `active` with its payoff tick
 * long in the past — so the lifecycle is asserted against real `runTick` runs.
 */
describe("program plan lifecycle over a live tick loop", () => {
  it("advances seeded programs through escalating beats instead of thinning to nothing", () => {
    const world = liveWorld(4);
    const resolvedTypes = new Set(world.plannedBeats.filter((beat) => beat.status === "resolved").map((beat) => beat.type));
    expect(resolvedTypes.size).toBeGreaterThanOrEqual(3);

    for (const plan of world.programPlans) {
      const beats = beatsOf(world, plan);
      const resolved = beats.filter((beat) => beat.status === "resolved");
      const opportunities = buildShowsSince(world, plan.startTick);
      // The prerequisite chain has to unblock week over week: a program given
      // two or more television shows must have run at least two of its beats.
      expect(resolved.length, `plan ${plan.id} resolved beats`).toBeGreaterThanOrEqual(Math.min(2, opportunities));
      expect(
        beats.some((beat) => beat.status === "provisional" || beat.status === "scheduled" || beat.status === "resolved"),
        `plan ${plan.id} still has a live beat`,
      ).toBe(true);
    }

    const escalating = world.programPlans.filter((plan) => new Set(beatsOf(world, plan)
      .filter((beat) => beat.status === "resolved").map((beat) => beat.type)).size >= 3);
    expect(escalating.length).toBeGreaterThanOrEqual(2);
  });

  it("never leaves a program plan active past its own payoff tick", () => {
    for (const weeks of [4, 8]) {
      const world = liveWorld(weeks, `lifecycle-${weeks}`);
      const zombies = world.programPlans.filter((plan) => isOpen(plan) && plan.targetPayoffTick < world.tick);
      expect(zombies.map((plan) => `${plan.id}@${plan.targetPayoffTick}`), `week ${weeks}`).toEqual([]);
      expect(() => worldStateSchema.parse(world)).not.toThrow();
    }
  });

  it("ends programs and their stories through one payoff authority", () => {
    const world = liveWorld(8);
    const ended = world.programPlans.filter((plan) => plan.status === "resolved" || plan.status === "abandoned");
    expect(ended.length).toBeGreaterThanOrEqual(4);

    for (const plan of world.programPlans.filter((plan) => plan.status === "resolved")) {
      expect(beatsOf(world, plan).some((beat) => beat.type === "ple_payoff" && beat.status === "resolved")).toBe(true);
      const story = world.stories.find((candidate) => candidate.id === plan.storyId)!;
      expect(story.phase, `story ${story.id}`).toBe("resolved");
      // One resolved fact set: the payoff beat is the authority, so the legacy
      // blowoff pass must not resolve the same story a second time.
      expect(world.events.filter((event) => event.type === "story_resolved" && event.storyId === story.id)).toHaveLength(1);
    }

    // Nothing is left claiming a card slot it never appeared on.
    expect(world.plannedBeats.filter((beat) => beat.status === "scheduled" && beat.scheduledShowId === undefined)).toEqual([]);
  });
});

describe("plans must terminate", () => {
  it("extends a missed payoff exactly once, then abandons the program", () => {
    const world = plannedWorld();
    const plan = world.programPlans[0]!;
    const firstTarget = plan.targetPayoffTick;

    advanceProgramPlanLifecycle(world, ctxAt(firstTarget));
    expect(plan.status).toBe("active");
    expect(plan.targetPayoffTick).toBeGreaterThan(firstTarget);
    expect(plan.revisions.at(-1)).toMatchObject({ reason: "payoff_missed", response: "extend" });
    // The extension has to move the beats too, or the plan is only auditably
    // alive while staying unbookable.
    expect(beatsOf(world, plan).some((beat) => beat.status === "provisional" && beat.latestTick >= plan.targetPayoffTick)).toBe(true);

    advanceProgramPlanLifecycle(world, ctxAt(plan.targetPayoffTick));
    expect(plan.status).toBe("abandoned");
    const last = plan.revisions.at(-1)!;
    expect(last).toMatchObject({ reason: "payoff_missed", response: "abandon" });
    expect(last.previousIntent?.intendedPayoff).not.toBe(last.newIntent.intendedPayoff);
    expect(world.stories[0]?.phase).toBe("cooling");
    expect(beatsOf(world, plan).every((beat) => beat.status !== "provisional" && beat.status !== "scheduled")).toBe(true);
  });

  it("marks a plan payoff_ready once its last build beat resolves", () => {
    const world = plannedWorld();
    const plan = world.programPlans[0]!;
    for (const beat of beatsOf(world, plan).filter((candidate) => candidate.type !== "ple_payoff")) {
      const airsAt = beat.earliestTick;
      const show = bookShow(world, ctxAt(airsAt - 1), airsAt);
      resolveCard(world, show, ctxAt(airsAt));
    }
    expect(plan.status).toBe("payoff_ready");
  });
});

describe("story cooling has an exit", () => {
  it("resolves a cooling story quietly and releases its participants", () => {
    const world = createTestWorld({ wrestlerCount: 4, humanCount: 0, seed: "cooling" });
    world.stories = [story("story-cold", ["wrestler-0", "wrestler-1"], { phase: "cooling", momentum: -20, audienceInterest: 30 })];
    const deadline = world.config.booking.coolingResolveWeeks * (world.config.decisionTicksPerWeek + 1);
    for (let tick = 0; tick <= deadline; tick++) advanceStories(world, ctxAt(tick, "cooling"), [], []);
    expect(world.stories[0]?.phase).toBe("resolved");
    expect(world.events.some((event) => event.type === "story_resolved" && event.data["quiet"] === true)).toBe(true);
  });

  it("re-heats a cooling story that is booked again and works", () => {
    const world = createTestWorld({ wrestlerCount: 4, humanCount: 0, seed: "reheat" });
    world.stories = [story("story-cold", ["wrestler-0", "wrestler-1"], { phase: "cooling", momentum: -10, audienceInterest: 40 })];
    advanceStories(world, ctxAt(1, "reheat"), [], [{
      id: "segment-reheat", segmentSlotId: "slot-reheat", showId: "show-reheat",
      participantWrestlerIds: ["wrestler-0", "wrestler-1"], dominantWrestlerId: "wrestler-0",
      quality: 70, crowdResponse: 70, storyId: "story-cold", storyAdvancement: 40,
      intents: { "wrestler-0": "escalate_rivalry", "wrestler-1": "escalate_rivalry" },
      performances: [
        { wrestlerId: "wrestler-0", performanceScore: 70, positiveHeatDelta: 2, negativeHeatDelta: 0, storyAdvancement: 12 },
        { wrestlerId: "wrestler-1", performanceScore: 65, positiveHeatDelta: 0, negativeHeatDelta: 1, storyAdvancement: 5 },
      ],
    }]);
    expect(world.stories[0]?.phase).toBe("building");
  });
});

describe("one payoff authority", () => {
  it("never books the legacy peaking blowoff for a story that has an active plan", () => {
    const world = createTestWorld({ wrestlerCount: 10, humanCount: 0, seed: "authority" });
    world.stories = [
      story("story-planned", ["wrestler-0", "wrestler-1"], { phase: "peaking", audienceInterest: 90 }),
      story("story-unplanned", ["wrestler-2", "wrestler-3"], { phase: "peaking", audienceInterest: 85 }),
    ];
    planPrograms(world, ctxAt(0));
    const planned = world.programPlans.find((plan) => plan.storyId === "story-planned")!;
    // Strand the payoff beat so only the legacy pass could deliver this story.
    for (const beat of beatsOf(world, planned)) beat.status = "skipped";
    world.programPlans = world.programPlans.filter((plan) => plan.storyId === "story-planned");

    const ple = bookShow(world, ctxAt(10, "authority"), 11);
    expect(ple.card.some((slot) => slot.storyId === "story-planned")).toBe(false);
    expect(ple.card.some((slot) => slot.storyId === "story-unplanned")).toBe(true);
  });
});
