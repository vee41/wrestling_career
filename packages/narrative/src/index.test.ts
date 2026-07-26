import { describe, expect, it } from "vitest";
import { describeNarrative } from "./index.js";

describe("narrative package", () => {
  it("loads and resolves the contracts dependency", () => {
    expect(describeNarrative()).toBe("@wrestling/narrative depends on @wrestling/contracts");
  });
});
