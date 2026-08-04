import { describe, expect, it } from "vitest";
import type { Story } from "@wrestling/contracts";
import { resolveCard } from "./card.js";
import { createIdFactory } from "./ids.js";
import { bookShow } from "./gm.js";
import { planPrograms } from "./program-plans.js";
import { createRng } from "./rng.js";
import { createTestWorld } from "./test-helpers.js";
import type { TickContext } from "./context.js";

function context(tick: number): TickContext {
  return { tick, rng: createRng(`planned-beat:${tick}`), ids: createIdFactory(tick), events: [] };
}

function worldWithProgram() {
  const world = createTestWorld({ wrestlerCount: 8, humanCount: 0, seed: "planned-beat-world" });
  const rivalry: Story = {
    id: "program-story", participantWrestlerIds: ["wrestler-0", "wrestler-1"],
    tension: "grudge", tensionDescription: "A test grudge", stakes: "pride",
    audienceInterest: 90, momentum: 15, coherence: 80, phase: "building", unresolvedDevelopments: [],
  };
  world.stories = [rivalry];
  planPrograms(world, context(0));
  return world;
}

describe("planned beats", () => {
  it("moves a four-week program through three non-match beats into a PLE payoff", () => {
    const world = worldWithProgram();
    const plan = world.programPlans[0]!;
    expect(world.plannedBeats.filter((beat) => beat.programId === plan.id).map((beat) => beat.type))
      .toEqual(["promo_interview", "confrontation", "go_home_angle", "ple_payoff"]);

    for (const [bookingTick, showTick] of [[1, 2], [4, 5], [7, 8], [10, 11]] as const) {
      const show = bookShow(world, context(bookingTick), showTick);
      const plannedSlot = show.card.find((slot) => slot.programId === plan.id);
      expect(plannedSlot).toBeDefined();
      if (plannedSlot?.kind === "segment") expect(plannedSlot.plannedOutcome?.intendedStoryEffect).toBeTruthy();
      if (plannedSlot?.kind === "match") expect(plannedSlot.plannedFinish?.intendedWinnerWrestlerId).toBeTruthy();
      resolveCard(world, show, context(showTick));
    }

    const beats = world.plannedBeats.filter((beat) => beat.programId === plan.id);
    expect(beats.every((beat) => beat.status === "resolved")).toBe(true);
    expect(beats.slice(0, 3).every((beat) => beat.compatibleSlotKind === "segment")).toBe(true);
    expect(beats.at(-1)?.spendsDirectMatchup).toBe(true);
    expect(plan.completedBeatIds).toEqual(beats.map((beat) => beat.id));
    expect(plan.status).toBe("resolved");
    expect(world.events.filter((event) => event.type === "planned_beat_resolved")).toHaveLength(4);
  });

  it("follows planned segment focus and records an injury deviation with a replan", () => {
    const world = worldWithProgram();
    const plan = world.programPlans[0]!;
    const show = bookShow(world, context(1), 2);
    const planned = show.card.find((slot) => slot.programId === plan.id && slot.kind === "segment");
    expect(planned?.kind).toBe("segment");
    if (planned?.kind !== "segment") return;
    const normal = resolveCard(world, show, context(2)).segmentResults.find((result) => result.segmentSlotId === planned.id)!;
    expect(normal.adherence).toBe("adhered");
    expect(normal.dominantWrestlerId).toBe(planned.plannedOutcome?.intendedDominantWrestlerId);

    const disrupted = worldWithProgram();
    const disruptedShow = bookShow(disrupted, context(1), 2);
    const disruptedSlot = disruptedShow.card.find((slot) => slot.programId === disrupted.programPlans[0]!.id && slot.kind === "segment");
    if (disruptedSlot?.kind !== "segment") return;
    const focal = disruptedSlot.plannedOutcome!.intendedDominantWrestlerId;
    disrupted.wrestlers.find((wrestler) => wrestler.id === focal)!.condition = 20;
    const result = resolveCard(disrupted, disruptedShow, context(2)).segmentResults.find((entry) => entry.segmentSlotId === disruptedSlot.id)!;
    expect(result.deviationCause).toBe("injury");
    expect(disrupted.programPlans[0]!.revisions.at(-1)?.reason).toBe("execution_deviation");
  });

  it("invalidates an unavailable beat and records an explicit substitute revision", () => {
    const world = worldWithProgram();
    world.wrestlers.find((wrestler) => wrestler.id === "wrestler-0")!.condition = 20;
    const show = bookShow(world, context(1), 2);
    const plan = world.programPlans[0]!;
    const original = world.plannedBeats.find((beat) => beat.programId === plan.id && beat.type === "promo_interview")!;
    expect(original.status).toBe("invalidated");
    expect(world.plannedBeats.some((beat) => beat.programId === plan.id && beat.id !== original.id && beat.intendedStoryEffect.includes("replacing"))).toBe(true);
    expect(plan.revisions.at(-1)?.response).toBe("substitute_beat");
    expect(show.card.some((slot) => slot.plannedBeatId === original.id)).toBe(false);
  });
});
