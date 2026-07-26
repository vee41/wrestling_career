import { describe, expect, it } from "vitest";
import { generateReactiveDecisions } from "./director.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import type { TickContext } from "./context.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";

function ctxAt(tick: number, seed: string): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

/** Neutralize every other reactive-decision trigger so only the one under test can fire. */
function isolateWrestler(world: ReturnType<typeof createTestWorld>, wrestlerId: string): void {
  const w = world.wrestlers.find((x) => x.id === wrestlerId);
  if (w) w.controlledBy = "human";
  const p = findPopularity(world, wrestlerId);
  p.negativeHeat = 0;
  p.positiveHeat = 0;
  world.relationships = world.relationships.filter(
    (r) => r.fromWrestlerId !== wrestlerId && r.toWrestlerId !== wrestlerId,
  );
}

function generatesEventually(
  build: () => ReturnType<typeof createTestWorld>,
  matches: (world: ReturnType<typeof createTestWorld>) => boolean,
  seedPrefix: string,
): boolean {
  for (let tick = 0; tick < 60; tick++) {
    const world = build();
    generateReactiveDecisions(world, ctxAt(tick, seedPrefix));
    if (matches(world)) return true;
  }
  return false;
}

describe("generateReactiveDecisions — tuning gap #1 (dead reactive types)", () => {
  it("wires injury_decision to a low-condition trigger", () => {
    const found = generatesEventually(
      () => {
        const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "gap1-injury" });
        isolateWrestler(world, "wrestler-0");
        world.wrestlers.find((w) => w.id === "wrestler-0")!.condition = 20;
        return world;
      },
      (world) =>
        world.pendingReactiveDecisions.some((d) => d.type === "injury_decision" && d.targetWrestlerId === "wrestler-0"),
      "gap1-injury",
    );
    expect(found).toBe(true);
  });

  it("wires finish_changed to a story-linked booking", () => {
    const found = generatesEventually(
      () => {
        const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "gap1-finish" });
        isolateWrestler(world, "wrestler-0");
        world.wrestlers.find((w) => w.id === "wrestler-0")!.condition = 90;
        world.stories.push({
          id: "story-1",
          participantWrestlerIds: ["wrestler-0", "wrestler-1"],
          tension: "grudge",
          tensionDescription: "test",
          stakes: "test",
          audienceInterest: 50,
          momentum: 10,
          coherence: 70,
          phase: "peaking",
          unresolvedDevelopments: [],
        });
        // tick+3, not tick+1, so this doesn't also trigger booking_request.
        world.shows.push({
          id: "show-1",
          tick: 3,
          card: [
            {
              id: "slot-1",
              participantWrestlerIds: ["wrestler-0", "wrestler-1"],
              storyId: "story-1",
              intents: {},
            },
          ],
        });
        return world;
      },
      (world) =>
        world.pendingReactiveDecisions.some((d) => d.type === "finish_changed" && d.targetWrestlerId === "wrestler-0"),
      "gap1-finish",
    );
    expect(found).toBe(true);
  });
});

describe("generateReactiveDecisions — tuning gap #2 (heel/face turns)", () => {
  it("proposes a turn for a face whose negative heat has overtaken positive heat", () => {
    const found = generatesEventually(
      () => {
        const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "gap2-face" });
        isolateWrestler(world, "wrestler-0");
        const w = world.wrestlers.find((x) => x.id === "wrestler-0")!;
        w.alignment = "face";
        w.condition = 90;
        const p = findPopularity(world, "wrestler-0");
        p.negativeHeat = 60;
        p.positiveHeat = 10;
        return world;
      },
      (world) =>
        world.pendingReactiveDecisions.some((d) => d.type === "turn_proposal" && d.targetWrestlerId === "wrestler-0"),
      "gap2-face",
    );
    expect(found).toBe(true);
  });

  it("never proposes a turn for a face whose crowd reaction still matches their alignment", () => {
    for (let tick = 0; tick < 60; tick++) {
      const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "gap2-no-contradiction" });
      isolateWrestler(world, "wrestler-0");
      const w = world.wrestlers.find((x) => x.id === "wrestler-0")!;
      w.alignment = "face";
      w.condition = 90;
      const p = findPopularity(world, "wrestler-0");
      p.positiveHeat = 60;
      p.negativeHeat = 10;
      generateReactiveDecisions(world, ctxAt(tick, "gap2-no-contradiction"));
      expect(
        world.pendingReactiveDecisions.some((d) => d.type === "turn_proposal" && d.targetWrestlerId === "wrestler-0"),
      ).toBe(false);
    }
  });
});
