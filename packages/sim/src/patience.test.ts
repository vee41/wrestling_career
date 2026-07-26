import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@wrestling/contracts";
import { countRecentInteractions, patienceMultiplier } from "./patience.js";
import { createTestWorld } from "./test-helpers.js";

function interactionEvent(tick: number, wrestlerId: string, intent: string): WorldEvent {
  return {
    id: `evt-${tick}-${wrestlerId}-${intent}`,
    tick,
    type: "interaction_resolved",
    summary: "test",
    wrestlerIds: [wrestlerId],
    data: { intent },
  };
}

describe("countRecentInteractions / patienceMultiplier", () => {
  it("counts only matching wrestler+intent events within the window", () => {
    const world = createTestWorld({ wrestlerCount: 3 });
    world.events.push(
      interactionEvent(1, "wrestler-0", "request_opportunity"),
      interactionEvent(2, "wrestler-0", "request_opportunity"),
      interactionEvent(2, "wrestler-0", "pitch_feud"),
      interactionEvent(2, "wrestler-1", "request_opportunity"),
      interactionEvent(0, "wrestler-0", "request_opportunity"),
    );
    // windowTicks=2, currentTick=2 -> only tick > 0 && tick <= 2 counts, so
    // the tick-0 event (out of window), the pitch_feud event (wrong
    // intent), and the wrestler-1 event (wrong wrestler) are all excluded.
    const count = countRecentInteractions(world, "wrestler-0", "request_opportunity", 2, 2);
    expect(count).toBe(2);
  });

  it("excludes events outside the window", () => {
    const world = createTestWorld({ wrestlerCount: 1 });
    world.events.push(interactionEvent(1, "wrestler-0", "request_opportunity"));
    const count = countRecentInteractions(world, "wrestler-0", "request_opportunity", 20, 6);
    expect(count).toBe(0);
  });

  it("patienceMultiplier decreases monotonically as repeats increase", () => {
    const values = [0, 1, 2, 3, 4].map((n) => patienceMultiplier(n));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1] as number);
    }
    expect(patienceMultiplier(0)).toBe(1);
  });
});
