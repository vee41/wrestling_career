import { describe, expect, it } from "vitest";
import { worldStateSchema } from "./world.js";
import { exampleWorldState } from "./fixtures.js";

describe("worldStateSchema", () => {
  it("validates the example 3-wrestler WorldState fixture", () => {
    expect(() => worldStateSchema.parse(exampleWorldState)).not.toThrow();
  });

  it("round-trips the fixture through parse -> serialize -> parse", () => {
    const parsed = worldStateSchema.parse(exampleWorldState);
    const roundTripped = worldStateSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a wrong schemaVersion", () => {
    expect(() => worldStateSchema.parse({ ...exampleWorldState, schemaVersion: 1 })).toThrow();
    expect(() => worldStateSchema.parse({ ...exampleWorldState, schemaVersion: 5 })).toThrow();
  });

  it("rejects a relationship that references a wrestler not in the world", () => {
    const invalid = {
      ...exampleWorldState,
      relationships: [
        ...exampleWorldState.relationships,
        {
          fromWrestlerId: "ace-steel",
          toWrestlerId: "ghost-wrestler",
          affinity: 0,
          respect: 0,
          trust: 0,
          rivalry: 0,
          resentment: 0,
          influence: 0,
        },
      ],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/unknown wrestler id.*ghost-wrestler/);
  });

  it("rejects a world where a wrestler is missing its popularity block", () => {
    const invalid = {
      ...exampleWorldState,
      popularity: exampleWorldState.popularity.slice(1),
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/exactly one popularity block/);
  });

  it("rejects a match result that references a show not in the world", () => {
    const invalid = {
      ...exampleWorldState,
      matchResults: [
        { ...exampleWorldState.matchResults[0], showId: "show-that-does-not-exist" },
      ],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/unknown show id/);
  });

  it("rejects a world where a wrestler is missing its stance entry", () => {
    const invalid = {
      ...exampleWorldState,
      stances: exampleWorldState.stances.slice(1),
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/exactly one stance entry/);
  });

  it("rejects a resolved proposal sitting in pendingProposals", () => {
    const invalid = {
      ...exampleWorldState,
      pendingProposals: [{ ...exampleWorldState.pendingProposals[0], status: "accepted" }],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/may only contain pending proposals/);
  });

  it("rejects a resolved reactive decision sitting in pendingReactiveDecisions", () => {
    const invalid = {
      ...exampleWorldState,
      pendingReactiveDecisions: [
        { ...exampleWorldState.pendingReactiveDecisions[0], status: "responded" },
      ],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/may only contain pending decisions/);
  });

  it("rejects a pending proposal that references an unknown recipient", () => {
    const invalid = {
      ...exampleWorldState,
      pendingProposals: [
        { ...exampleWorldState.pendingProposals[0], recipientWrestlerId: "ghost-wrestler" },
      ],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/unknown wrestler id.*ghost-wrestler/);
  });

  it("rejects a pending reactive decision whose origin match does not exist", () => {
    const invalid = {
      ...exampleWorldState,
      pendingReactiveDecisions: [
        { ...exampleWorldState.pendingReactiveDecisions[0], originMatchId: "no-such-match" },
      ],
    };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/unknown match id/);
  });

  it("accepts titles with holders", () => {
    const valid = { ...exampleWorldState, titles: exampleWorldState.titles.map((title) => ({ ...title, holderId: "ace-steel" })) };
    expect(() => worldStateSchema.parse(valid)).not.toThrow();
  });

  it("rejects a title holder that references an unknown wrestler", () => {
    const invalid = { ...exampleWorldState, titles: [{ ...exampleWorldState.titles[0], holderId: "ghost-wrestler" }, exampleWorldState.titles[1]] };
    expect(() => worldStateSchema.parse(invalid)).toThrow(/unknown wrestler id.*ghost-wrestler/);
  });

  it("rejects duplicate title ids and unknown title bookings", () => {
    expect(() => worldStateSchema.parse({ ...exampleWorldState, titles: [exampleWorldState.titles[0], { ...exampleWorldState.titles[1], id: "world-title" }] })).toThrow(/title ids must be unique/);
    expect(() => worldStateSchema.parse({ ...exampleWorldState, shows: [{ ...exampleWorldState.shows[0], card: [{ ...exampleWorldState.shows[0]!.card[0]!, titleId: "no-title" }] }] })).toThrow(/unknown title id/);
  });

  it("accepts a pending reactive decision whose origin match is only a booked slot, not yet resolved", () => {
    const valid = {
      ...exampleWorldState,
      pendingReactiveDecisions: [
        { ...exampleWorldState.pendingReactiveDecisions[0], originMatchId: "slot-main-event" },
      ],
    };
    expect(() => worldStateSchema.parse(valid)).not.toThrow();
  });
});
