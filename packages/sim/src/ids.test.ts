import { describe, expect, it } from "vitest";
import { createIdFactory } from "./ids.js";

describe("createIdFactory", () => {
  it("produces unique, deterministic ids per prefix within a tick", () => {
    const factory = createIdFactory(7);
    expect(factory.next("event")).toBe("event-t7-1");
    expect(factory.next("event")).toBe("event-t7-2");
    expect(factory.next("match")).toBe("match-t7-1");
  });

  it("is deterministic across separate factories for the same tick", () => {
    const a = createIdFactory(3);
    const b = createIdFactory(3);
    expect(a.next("event")).toBe(b.next("event"));
    expect(a.next("event")).toBe(b.next("event"));
  });
});
