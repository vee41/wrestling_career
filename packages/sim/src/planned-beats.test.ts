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
  it("moves a four-week grudge program through its archetype into a PLE payoff", () => {
    const world = worldWithProgram();
    const plan = world.programPlans[0]!;
    // A grudge is not argued in promos for a month: it is ambushed, then
    // fought once on television with the score left open (Phase 3.12.6).
    expect(world.plannedBeats.filter((beat) => beat.programId === plan.id).map((beat) => beat.type))
      .toEqual(["promo_interview", "attack_save_interference", "direct_rivalry_match", "ple_payoff"]);

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
    expect(beats.slice(0, 2).every((beat) => beat.compatibleSlotKind === "segment")).toBe(true);
    // The rivalry match is spent once on television and once at the payoff —
    // no more, because `directMatchRepetitionBudget` rations it.
    expect(beats.filter((beat) => beat.spendsDirectMatchup).map((beat) => beat.type))
      .toEqual(["direct_rivalry_match", "ple_payoff"]);
    // Momentum trades: whoever loses the blowoff takes the television fall, so
    // no one wrestler is booked to stand tall through the entire program.
    const dominants = new Set([
      ...beats.flatMap((beat) => beat.plannedSegmentOutcome === undefined ? [] : [beat.plannedSegmentOutcome.intendedDominantWrestlerId]),
      ...world.matchResults.flatMap((result) => result.plannedFinish === undefined ? [] : [result.plannedFinish.intendedWinnerWrestlerId]),
    ]);
    expect(dominants.size).toBeGreaterThan(1);
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
    const substitute = world.plannedBeats.find((beat) => beat.programId === plan.id && beat.id !== original.id && beat.intendedStoryEffect.includes("replacing"))!;
    expect(substitute).toBeDefined();
    expect(plan.revisions.at(-1)?.response).toBe("substitute_beat");
    expect(show.card.some((slot) => slot.plannedBeatId === original.id)).toBe(false);

    // The stand-in only books the wrestler who can appear, so its planned
    // outcome cannot keep naming the absent one — that resolved as a refusal
    // deviation against someone who was never in the segment.
    expect(substitute.requiredParticipantWrestlerIds).toEqual(["wrestler-1"]);
    expect(substitute.plannedSegmentOutcome?.intendedDominantWrestlerId).toBe("wrestler-1");
    expect(substitute.plannedSegmentOutcome?.protectedWrestlerIds).not.toContain("wrestler-0");
    // ...and the rest of the chain now waits on the stand-in rather than on a
    // beat that can never resolve.
    const complication = world.plannedBeats.find((beat) => beat.programId === plan.id && beat.escalationLevel === 1)!;
    expect(complication.preconditions.requiredResolvedBeatIds).toEqual([substitute.id]);
  });

  it("splices a beat whose window closed out of the chain instead of blocking it", () => {
    const world = worldWithProgram();
    const plan = world.programPlans[0]!;
    const beats = world.plannedBeats.filter((beat) => beat.programId === plan.id);
    const establish = beats.find((beat) => beat.escalationLevel === 0)!;
    const complicate = beats.find((beat) => beat.escalationLevel === 1)!;
    // Close the establish beat's window without ever airing it.
    establish.latestTick = 2;

    const show = bookShow(world, context(4), 5);
    expect(establish.status).toBe("skipped");
    expect(complicate.preconditions.requiredResolvedBeatIds).toEqual([]);
    expect(show.card.some((slot) => slot.plannedBeatId === complicate.id)).toBe(true);
    expect(world.events.some((event) => event.type === "planned_beat_skipped")).toBe(true);
  });
});
