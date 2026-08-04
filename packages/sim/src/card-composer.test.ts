import { describe, expect, it } from "vitest";
import type { Story } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { createIdFactory } from "./ids.js";
import { planPrograms } from "./program-plans.js";
import { createRng } from "./rng.js";
import { createTestWorld } from "./test-helpers.js";
import type { TickContext } from "./context.js";

function context(tick: number): TickContext {
  return { tick, rng: createRng(`composer:${tick}`), ids: createIdFactory(tick), events: [] };
}

function worldWithHotProgram() {
  const world = createTestWorld({ wrestlerCount: 10, humanCount: 0, seed: "composer-world" });
  const story: Story = {
    id: "hot-program", participantWrestlerIds: ["wrestler-0", "wrestler-1"], tension: "grudge",
    tensionDescription: "A personal score to settle", stakes: "pride", audienceInterest: 95,
    momentum: 30, coherence: 80, phase: "building", unresolvedDevelopments: [],
  };
  world.stories = [story];
  planPrograms(world, context(0));
  return world;
}

describe("weekly card composer", () => {
  it("records selected and rejected candidates with decomposed scores", () => {
    const world = worldWithHotProgram();
    const original = world.plannedBeats[0]!;
    // Two independent due beats compete for a one-slot card: the lower
    // priority candidate stays valid, but is explicitly rejected on capacity.
    const alternatePlan = structuredClone(world.programPlans[0]!);
    alternatePlan.id = "alternate-program";
    alternatePlan.priority = 1;
    alternatePlan.participants = [{ wrestlerId: "wrestler-2", role: "protagonist" }, { wrestlerId: "wrestler-3", role: "antagonist" }];
    alternatePlan.plannedBeatIds = ["alternate-due-beat"];
    world.programPlans.push(alternatePlan);
    world.plannedBeats.push({ ...structuredClone(original), id: "alternate-due-beat", programId: alternatePlan.id, requiredParticipantWrestlerIds: ["wrestler-2", "wrestler-3"], intendedStoryEffect: "Alternative escalation." });
    world.config.tvCardSize = { min: 1, max: 1 };

    const show = bookShow(world, context(1), 2);
    const trace = show.bookingTrace!;
    expect(trace.candidates.some((candidate) => candidate.disposition === "selected")).toBe(true);
    expect(trace.candidates.some((candidate) => candidate.disposition === "rejected" && candidate.plannedBeatId !== undefined)).toBe(true);
    expect(trace.candidates.filter((candidate) => candidate.disposition === "selected").every((candidate) => candidate.slotId && Object.keys(candidate.scoreComponents).length > 0)).toBe(true);
  });

  it("puts the hottest justified attraction in the main event and a strong attraction in the opener", () => {
    const world = worldWithHotProgram();
    const show = bookShow(world, context(1), 2);
    const main = show.card.find((slot) => slot.position === "main_event")!;
    const opener = show.card.find((slot) => slot.position === "opener")!;
    expect(main.programId).toBe(world.programPlans[0]!.id);
    expect(opener.participantWrestlerIds.length).toBeGreaterThan(0);
    expect(show.card.flatMap((slot) => slot.participantWrestlerIds)).toEqual(expect.arrayContaining(main.participantWrestlerIds));
  });

  it("hard-rejects an unavailable planned participant and never books them", () => {
    const world = worldWithHotProgram();
    world.wrestlers.find((wrestler) => wrestler.id === "wrestler-0")!.condition = 20;
    const show = bookShow(world, context(1), 2);
    expect(show.card.flatMap((slot) => slot.participantWrestlerIds)).not.toContain("wrestler-0");
    expect(show.bookingTrace!.candidates.some((candidate) =>
      candidate.disposition === "hard_invalid" && candidate.hardInvalidReasons.includes("availability_or_condition"),
    )).toBe(true);
  });

  it("is deterministic, including its private audit trace", () => {
    const left = worldWithHotProgram();
    const right = structuredClone(left);
    expect(bookShow(left, context(1), 2)).toEqual(bookShow(right, context(1), 2));
  });
});
