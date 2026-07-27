import { describe, expect, it } from "vitest";
import { showSchema } from "./show.js";

const validShow = {
  id: "show-week-3",
  tick: 3,
  kind: "tv",
  card: [
    {
      id: "slot-main-event",
      participantWrestlerIds: ["ace-steel", "vic-vendetta"],
      storyId: "story-ace-vs-vic",
      position: "main_event",
      gmIntent: "capitalise_on_rising_star",
    },
  ],
};

describe("showSchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = showSchema.parse(validShow);
    const roundTripped = showSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("requires at least one match slot on the card", () => {
    expect(() => showSchema.parse({ ...validShow, card: [] })).toThrow();
  });

  it("allows a match slot with no story link or GM intent", () => {
    const minimalSlot = { id: "slot-b", participantWrestlerIds: ["ace-steel", "dusty-cole"], position: "opener" };
    expect(() => showSchema.parse({ ...validShow, card: [minimalSlot] })).not.toThrow();
  });

  it("rejects an unknown GM objective", () => {
    const badSlot = { ...validShow.card[0], gmIntent: "start_a_war" };
    expect(() => showSchema.parse({ ...validShow, card: [badSlot] })).toThrow();
  });

  it("requires a recognised show kind and card position", () => {
    expect(() => showSchema.parse({ ...validShow, kind: "house_show" })).toThrow();
    expect(() => showSchema.parse({ ...validShow, card: [{ ...validShow.card[0], position: "semi_main" }] })).toThrow();
  });
});
