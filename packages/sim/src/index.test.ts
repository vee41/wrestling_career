import { describe, expect, it } from "vitest";
import { describeSim } from "./index.js";

describe("sim package", () => {
  it("loads and resolves the contracts dependency", () => {
    expect(describeSim()).toBe("@wrestling/sim depends on @wrestling/contracts");
  });
});
