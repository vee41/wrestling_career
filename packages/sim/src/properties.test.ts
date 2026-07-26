import { describe, expect, it } from "vitest";
import { runTick } from "./tick.js";
import { createTestWorld } from "./test-helpers.js";

describe("determinism", () => {
  it("same world + turns + seed always produces the same result", () => {
    const world = createTestWorld({ wrestlerCount: 12, humanCount: 2 });
    const a = runTick(world, [], "determinism-seed");
    const b = runTick(world, [], "determinism-seed");
    expect(a.world).toEqual(b.world);
    expect(a.events).toEqual(b.events);
    expect(a.narrativeJobs).toEqual(b.narrativeJobs);
  });

  it("a different seed produces a different result", () => {
    const world = createTestWorld({ wrestlerCount: 12, humanCount: 2 });
    const a = runTick(world, [], "seed-a");
    const b = runTick(world, [], "seed-b");
    expect(a.world).not.toEqual(b.world);
  });
});

describe("DL-7: absence is supported", () => {
  it("a human who submits no turn still gets a reactive decision resolved via stance fallback", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 1 });
    world.pendingReactiveDecisions.push({
      id: "reactive-absent",
      type: "booking_request",
      targetWrestlerId: "wrestler-0",
      offeredResponses: ["accept", "refuse", "negotiate"],
      deadlineTick: 50,
      status: "pending",
    });

    const { world: after } = runTick(world, [], "absent-player");

    const stillPending = after.pendingReactiveDecisions.find((d) => d.id === "reactive-absent");
    expect(stillPending).toBeUndefined();
  });

  it("an absent human still performs an action and an interaction each tick, same as an AI wrestler", () => {
    const world = createTestWorld({ wrestlerCount: 3, humanCount: 1 });
    const { events } = runTick(world, [], "absent-player-2");
    const own = events.filter((e) => e.wrestlerIds.includes("wrestler-0"));
    expect(own.length).toBeGreaterThan(0);
  });

  it("a career survives many consecutive ticks of total absence without the world becoming invalid", () => {
    let world = createTestWorld({ wrestlerCount: 5, humanCount: 1 });
    for (let i = 0; i < 15; i++) {
      world = runTick(world, [], `absent-season:${i}`).world;
    }
    const wrestler = world.wrestlers.find((w) => w.id === "wrestler-0");
    expect(wrestler).toBeDefined();
    expect(wrestler?.condition).toBeGreaterThanOrEqual(0);
  });
});
