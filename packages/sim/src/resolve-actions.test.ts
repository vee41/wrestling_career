import { describe, expect, it } from "vitest";
import { runTick } from "./tick.js";
import { createTestWorld } from "./test-helpers.js";
import type { PlayerTurn } from "@wrestling/contracts";

function trainTurn(wrestlerId: string, tickLabel: number): PlayerTurn {
  return {
    wrestlerId,
    action: { type: "train_skill", id: `train-${tickLabel}`, wrestlerId, skill: "ringPerformance" },
    reactiveResponses: [],
    proposalResponses: [],
    matchIntents: {},
    segmentIntents: {},
  };
}

describe("training plateau (spec §4.2)", () => {
  it("gives sublinear gains across consecutive ticks of training the same skill", () => {
    let world = createTestWorld({ wrestlerCount: 2, humanCount: 2 });
    // Give the wrestler money so quality upgrades don't confound the plateau
    // signal, and pin their skill away from the 100 ceiling.
    const w = world.wrestlers.find((x) => x.id === "wrestler-0");
    if (!w) throw new Error("missing wrestler-0");
    w.skills.ringPerformance = 30;
    w.money = 0;
    w.condition = 100;

    // Only ticks 0 and 1 are guaranteed decision ticks (WEEK_LENGTH_TICKS=3,
    // the first show tick is tick 2) — staying inside that window keeps this
    // test isolated from the GM's booking, which would otherwise reset the
    // plateau the moment this wrestler is booked into a match.
    const gains: number[] = [];
    for (let i = 0; i < 2; i++) {
      const before = world.wrestlers.find((x) => x.id === "wrestler-0")?.skills.ringPerformance ?? 0;
      const result = runTick(world, [trainTurn("wrestler-0", i)], `plateau:${i}`);
      const after = result.world.wrestlers.find((x) => x.id === "wrestler-0")?.skills.ringPerformance ?? 0;
      gains.push(after - before);
      world = result.world;
    }

    // Diminishing returns: the second consecutive tick of training the same
    // skill must gain strictly less than the first.
    expect(gains[1]).toBeLessThan(gains[0] as number);
  });

  it("resets the plateau after the wrestler competes in a match", () => {
    let world = createTestWorld({ wrestlerCount: 2, humanCount: 2 });
    const w = world.wrestlers.find((x) => x.id === "wrestler-0");
    if (!w) throw new Error("missing wrestler-0");
    w.skills.ringPerformance = 30;
    w.money = 0;

    // Plateau it out over several ticks.
    for (let i = 0; i < 5; i++) {
      world = runTick(world, [trainTurn("wrestler-0", i)], `reset-pretrain:${i}`).world;
    }
    const beforeMatch = world.wrestlers.find((x) => x.id === "wrestler-0")?.skills.ringPerformance ?? 0;

    // Inject a match_result event crediting wrestler-0 to simulate "having
    // just competed" — resetting the plateau window per GDD §7.
    world.events.push({
      id: "synthetic-match",
      tick: world.tick,
      type: "match_result",
      summary: "synthetic match for plateau-reset test",
      wrestlerIds: ["wrestler-0"],
      data: {},
    });

    const plateauedResult = runTick(world, [trainTurn("wrestler-0", 100)], "reset-plateaued-check");
    const plateauedGain =
      (plateauedResult.world.wrestlers.find((x) => x.id === "wrestler-0")?.skills.ringPerformance ?? 0) - beforeMatch;

    // Compare against what a *fresh* wrestler (no training history) gains.
    const freshWorld = createTestWorld({ wrestlerCount: 2, humanCount: 2 });
    const freshW = freshWorld.wrestlers.find((x) => x.id === "wrestler-0");
    if (!freshW) throw new Error("missing wrestler-0");
    freshW.skills.ringPerformance = beforeMatch;
    freshW.money = 0;
    const freshBefore = beforeMatch;
    const freshResult = runTick(freshWorld, [trainTurn("wrestler-0", 200)], "reset-fresh-check");
    const freshGain =
      (freshResult.world.wrestlers.find((x) => x.id === "wrestler-0")?.skills.ringPerformance ?? 0) - freshBefore;

    expect(plateauedGain).toBe(freshGain);
  });
});
