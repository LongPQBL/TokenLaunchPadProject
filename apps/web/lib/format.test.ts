import { describe, expect, it } from "vitest";
import { formatPercentBps, shortAddress } from "./format";

describe("shortAddress", () => {
  it("keeps the start and the end, which is what people compare", () => {
    expect(shortAddress("0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744")).toBe("0x8509…7744");
  });

  it("leaves something too short to shorten alone, rather than mangling it", () => {
    expect(shortAddress("0xa1")).toBe("0xa1");
    expect(shortAddress("")).toBe("");
  });
});

describe("formatPercentBps", () => {
  it("shows whole percentages without a decimal", () => {
    expect(formatPercentBps(7800)).toBe("78%");
    expect(formatPercentBps(0)).toBe("0%");
    expect(formatPercentBps(10000)).toBe("100%");
  });

  it("shows one decimal when there is a fraction", () => {
    expect(formatPercentBps(7855)).toBe("78.6%");
    expect(formatPercentBps(5)).toBe("0.1%");
  });

  // The indexer derives progress from reserves; a bad value must not draw a bar wider than its box or a negative one.
  it("clamps to 0..100%", () => {
    expect(formatPercentBps(12000)).toBe("100%");
    expect(formatPercentBps(-300)).toBe("0%");
  });
});
