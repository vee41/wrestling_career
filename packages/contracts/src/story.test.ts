import { describe, expect, it } from "vitest";
import { storySchema } from "./story.js";

const validStory = {
  id: "story-ace-vs-vic",
  participantWrestlerIds: ["ace-steel", "vic-vendetta"],
  tension: "push_conflict",
  tensionDescription:
    "A popular underdog is gaining support while a protective former champion tries to hold his position.",
  stakes: "number-one contendership",
  audienceInterest: 72,
  momentum: 12,
  coherence: 80,
  phase: "peaking",
  unresolvedDevelopments: ["Vic refused a rematch clause on air"],
};

describe("storySchema", () => {
  it("round-trips through parse -> serialize -> parse", () => {
    const parsed = storySchema.parse(validStory);
    const roundTripped = storySchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("requires at least two participants", () => {
    expect(() =>
      storySchema.parse({ ...validStory, participantWrestlerIds: ["ace-steel"] }),
    ).toThrow();
  });

  it("rejects an unknown phase", () => {
    expect(() => storySchema.parse({ ...validStory, phase: "starting" })).toThrow();
  });

  it("allows an empty unresolvedDevelopments list for a resolved story", () => {
    expect(() =>
      storySchema.parse({ ...validStory, phase: "resolved", unresolvedDevelopments: [] }),
    ).not.toThrow();
  });
});
