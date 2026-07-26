import { describe, expect, it } from "vitest";
import type { Show } from "@wrestling/contracts";
import { resolveShow } from "./match.js";
import { createTestWorld } from "./test-helpers.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";
import type { TickContext } from "./context.js";

function ctxAt(tick: number): TickContext {
  return { tick, rng: createRng(`match-test:${tick}`), ids: createIdFactory(tick), events: [] };
}

describe("resolveShow", () => {
  it("pays every participant appearance money (GDD §8, the earn side of the economy)", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "payday" });
    const show: Show = {
      id: "show-x",
      tick: 0,
      card: [{ id: "slot-x", participantWrestlerIds: ["wrestler-0", "wrestler-1"], intents: {} }],
    };
    world.shows.push(show);
    const before = new Map(world.wrestlers.map((w) => [w.id, w.money]));

    const ctx = ctxAt(0);
    const [result] = resolveShow(world, show, ctx);

    // Base pay is 30 plus a crowd bonus — losing still pays (appearance, not prize).
    for (const w of world.wrestlers) {
      expect(w.money).toBeGreaterThanOrEqual((before.get(w.id) ?? 0) + 30);
    }
    const matchEvent = ctx.events.find((e) => e.type === "match_result");
    expect(matchEvent?.data["payouts"]).toBeDefined();
    expect(result?.performances).toHaveLength(2);
  });

  it("emits an injury event when a match drives a wrestler's condition below the strain threshold", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "injury" });
    const wrestler = world.wrestlers.find((w) => w.id === "wrestler-0");
    // physicalCost's floor (follow_plan assertiveness, worst-case rng roll)
    // is ~8, i.e. at least a 4-point condition hit — 26 always crosses 25.
    if (wrestler) wrestler.condition = 26;
    const show: Show = {
      id: "show-y",
      tick: 0,
      card: [{ id: "slot-y", participantWrestlerIds: ["wrestler-0", "wrestler-1"], intents: {} }],
    };
    world.shows.push(show);

    const ctx = ctxAt(0);
    resolveShow(world, show, ctx);

    const injured = world.wrestlers.find((w) => w.id === "wrestler-0");
    expect(injured?.condition).toBeLessThan(25);
    const injuryEvents = ctx.events.filter((e) => e.type === "injury");
    expect(injuryEvents.some((e) => e.wrestlerIds.includes("wrestler-0"))).toBe(true);
  });

  it("does not emit an injury event for a wrestler who stays above the strain threshold", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "no-injury" });
    for (const w of world.wrestlers) w.condition = 100;
    const show: Show = {
      id: "show-z",
      tick: 0,
      card: [{ id: "slot-z", participantWrestlerIds: ["wrestler-0", "wrestler-1"], intents: {} }],
    };
    world.shows.push(show);

    const ctx = ctxAt(0);
    resolveShow(world, show, ctx);

    expect(ctx.events.some((e) => e.type === "injury")).toBe(false);
  });
});
