import { describe, expect, it } from "vitest";
import { momentumDirection, popularityBand, relationshipTier, skillBand } from "./projections.js";

describe("relationshipTier", () => {
  it("maps the full -100..100 range to the 5 documented tiers", () => {
    expect(relationshipTier(-100)).toBe("hostile");
    expect(relationshipTier(-40)).toBe("cold");
    expect(relationshipTier(0)).toBe("neutral");
    expect(relationshipTier(40)).toBe("warm");
    expect(relationshipTier(100)).toBe("trusted");
  });
});

describe("momentumDirection", () => {
  it("treats small values as steady (dead zone)", () => {
    expect(momentumDirection(0)).toBe("steady");
    expect(momentumDirection(5)).toBe("steady");
    expect(momentumDirection(-5)).toBe("steady");
  });

  it("reports rising and falling outside the dead zone", () => {
    expect(momentumDirection(50)).toBe("rising");
    expect(momentumDirection(-50)).toBe("falling");
  });
});

describe("popularityBand", () => {
  it("maps 0-100 to the 5 documented bands", () => {
    expect(popularityBand(0)).toBe("unknown");
    expect(popularityBand(25)).toBe("cult");
    expect(popularityBand(45)).toBe("known");
    expect(popularityBand(65)).toBe("over");
    expect(popularityBand(90)).toBe("star");
  });
});

describe("skillBand", () => {
  it("uses a coarser 3-tier scale for other wrestlers than for your own (spec §8.2)", () => {
    expect(skillBand(50, "other")).toBe("average");
    expect(skillBand(50, "own")).toBe("average");
    expect(skillBand(25, "other")).toBe("weak");
    expect(skillBand(25, "own")).toBe("developing");
  });

  it("defaults to the coarser viewpoint when none is given", () => {
    expect(skillBand(50)).toBe(skillBand(50, "other"));
  });
});
