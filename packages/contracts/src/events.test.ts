import { describe, expect, it } from "vitest";
import { worldEventSchema } from "./events.js";

const validEvent = {
  id: "event-match-week-3-main-event",
  tick: 3,
  type: "match_result",
  summary: "Vic Vendetta defeated Ace Steel, but the crowd left louder for Ace.",
  wrestlerIds: ["ace-steel", "vic-vendetta"],
  storyId: "story-ace-vs-vic",
  matchId: "match-week-3-main-event",
  showId: "show-week-3",
  data: {},
};

describe("worldEventSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = worldEventSchema.parse(validEvent);
    const roundTripped = worldEventSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("defaults data to an empty object when omitted", () => {
    const { data: _data, ...withoutData } = validEvent;
    const parsed = worldEventSchema.parse(withoutData);
    expect(parsed.data).toEqual({});
  });

  it("allows a global event with no referenced wrestlers", () => {
    expect(() =>
      worldEventSchema.parse({ ...validEvent, type: "gm_decision", wrestlerIds: [] }),
    ).not.toThrow();
  });

  it("rejects an unknown event type", () => {
    expect(() => worldEventSchema.parse({ ...validEvent, type: "wrestler_traded" })).toThrow();
  });

  it("accepts the Phase 2 tick-engine event types", () => {
    for (const type of [
      "action_performed",
      "interaction_resolved",
      "proposal_created",
      "proposal_resolved",
      "reactive_decision_created",
      "reactive_decision_resolved",
      "stance_changed",
      "show_booked",
      "title_change",
    ]) {
      expect(() => worldEventSchema.parse({ ...validEvent, type })).not.toThrow();
    }
  });
});
