import { describe, expect, it } from "vitest";
import { narrativeJobSchema, narrativeResultSchema } from "./narrative.js";

// Shaped after the exact example in GDD §16 (with an id/tick/status added,
// since those weren't part of the illustrative JSON but are required for
// the job to live in WorldState.narrativeJobs).
const gddExampleJob = {
  id: "job-show-week-3-recap",
  tick: 3,
  jobType: "show_recap",
  facts: [
    "Wrestler A defeated Wrestler B",
    "Wrestler B received the louder crowd reaction",
    "The rivalry gained audience interest",
  ],
  characters: [
    {
      id: "wrestler-a",
      voice: ["arrogant", "controlled"],
    },
  ],
  constraints: {
    maxWords: 120,
    inventFacts: false,
  },
};

const gddExampleResult = {
  jobId: "job-show-week-3-recap",
  headline: "Victory Does Not Silence the Crowd",
  body: "Wrestler A won the match, but the audience clearly left talking about Wrestler B.",
  mentionedCharacterIds: ["wrestler-a", "wrestler-b"],
};

describe("narrativeJobSchema", () => {
  it("parses the GDD §16 example job and round-trips it", () => {
    const parsed = narrativeJobSchema.parse(gddExampleJob);
    const roundTripped = narrativeJobSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("defaults status to pending when omitted", () => {
    const parsed = narrativeJobSchema.parse(gddExampleJob);
    expect(parsed.status).toBe("pending");
  });

  it("requires at least one fact", () => {
    expect(() => narrativeJobSchema.parse({ ...gddExampleJob, facts: [] })).toThrow();
  });
});

describe("narrativeResultSchema", () => {
  it("parses the GDD §16 example result and round-trips it", () => {
    const parsed = narrativeResultSchema.parse(gddExampleResult);
    const roundTripped = narrativeResultSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a result missing a headline", () => {
    const { headline: _headline, ...withoutHeadline } = gddExampleResult;
    expect(() => narrativeResultSchema.parse(withoutHeadline)).toThrow();
  });
});
