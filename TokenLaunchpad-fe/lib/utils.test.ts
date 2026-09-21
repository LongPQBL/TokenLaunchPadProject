import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins class names and drops falsy ones", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  // The reason cn wraps tailwind-merge: a caller's class must be able to override a component's default.
  it("lets a later Tailwind class override an earlier conflicting one", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
  });
});
