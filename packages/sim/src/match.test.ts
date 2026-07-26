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
});
