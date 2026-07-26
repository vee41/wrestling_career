import { describe, expect, it } from "vitest";
import { CONTRACTS_PACKAGE_NAME } from "./index.js";

describe("contracts package", () => {
  it("loads", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@wrestling/contracts");
  });
});
