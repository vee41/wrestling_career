import { describe, expect, it } from "vitest";
import { describeCli } from "./index.js";

describe("cli app", () => {
  it("loads and resolves all workspace dependencies", () => {
    expect(describeCli()).toBe(
      "@wrestling/contracts | @wrestling/sim depends on @wrestling/contracts | @wrestling/narrative depends on @wrestling/contracts",
    );
  });
});
