import { describe, expect, it } from "vitest";
import type { Show } from "@wrestling/contracts";
import { resolveSegments } from "./segment.js";
import { createTestWorld } from "./test-helpers.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import type { TickContext } from "./context.js";
import { updatePopularity } from "./popularity.js";
import { advanceStories } from "./stories.js";
import { bookShow } from "./gm.js";

function ctx(): TickContext {
  return { tick: 0, rng: createRng("segment-test"), ids: createIdFactory(0), events: [] };
}

describe("segments", () => {
  it("maps sympathy and hostility intents to their respective heat deltas", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    const show: Show = { id: "show-segment", tick: 0, kind: "tv", card: [{
      kind: "segment", id: "promo", participantWrestlerIds: ["wrestler-0", "wrestler-1"], position: "mid",
      intents: { "wrestler-0": "build_sympathy", "wrestler-1": "generate_hostility" },
    }] };
    world.shows.push(show);
    const [result] = resolveSegments(world, show, ctx());
    expect(result?.performances.find((performance) => performance.wrestlerId === "wrestler-0")?.positiveHeatDelta).toBeGreaterThan(0);
    expect(result?.performances.find((performance) => performance.wrestlerId === "wrestler-1")?.negativeHeatDelta).toBeGreaterThan(0);
    expect(world.wrestlers.every((wrestler) => wrestler.condition >= 70)).toBe(true);
  });

  it("counts a segment as an appearance for popularity and story advancement", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0 });
    world.stories.push({ id: "story", participantWrestlerIds: ["wrestler-0", "wrestler-1"], tension: "grudge", tensionDescription: "A simmering grudge", stakes: "pride", audienceInterest: 45, momentum: 0, coherence: 60, phase: "building", unresolvedDevelopments: [] });
    const show: Show = { id: "show-story-segment", tick: 0, kind: "tv", card: [{
      kind: "segment", id: "angle", participantWrestlerIds: ["wrestler-0", "wrestler-1"], storyId: "story", position: "mid",
      intents: { "wrestler-0": "escalate_rivalry", "wrestler-1": "promote_opponent" },
    }] };
    world.shows.push(show);
    const context = ctx();
    const [result] = resolveSegments(world, show, context);
    world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.fatigue = 50;
    const before = world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.currentReaction;
    updatePopularity(world, context, [], [result!]);
    advanceStories(world, context, [], [result!]);
    expect(world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.currentReaction).not.toBe(before);
    expect(world.popularity.find((popularity) => popularity.wrestlerId === "wrestler-0")!.fatigue).toBe(50);
    expect(world.stories[0]!.audienceInterest).toBeGreaterThan(45);
  });

  it("uses a segment for an eligible TV building story when scenario tuning selects it", () => {
    const world = createTestWorld({ wrestlerCount: 8, humanCount: 0 });
    world.config.booking.segmentChance = 1;
    world.stories.push({ id: "story-booking", participantWrestlerIds: ["wrestler-0", "wrestler-2"], tension: "grudge", tensionDescription: "An on-air dispute", stakes: "pride", audienceInterest: 50, momentum: 0, coherence: 60, phase: "building", unresolvedDevelopments: [] });
    const show = bookShow(world, ctx(), 2);
    expect(show.card.some((slot) => slot.kind === "segment" && slot.storyId === "story-booking")).toBe(true);
  });
});
