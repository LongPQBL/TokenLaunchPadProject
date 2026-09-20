import { describe, expect, it } from "vitest";
import { formatPercentBps, isAddress, shortAddress } from "./format";

describe("isAddress", () => {
  it("accepts a 40-digit hex address in any case", () => {
    expect(isAddress("0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744")).toBe(true);
    expect(isAddress("0x8509AEA46CEF52BE7CC3D07B3F2A4C4F08AE7744")).toBe(true);
  });

  // It comes from the URL, and decides whether to ask the API at all.
  it("rejects anything else", () => {
    for (const bad of ["", "0x", "0xa1", "8509aea46cef52be7cc3d07b3f2a4c4f08ae7744", `0x${"z".repeat(40)}`, `0x${"a".repeat(41)}`, "../etc/passwd"]) {
      expect(isAddress(bad), bad).toBe(false);
    }
  });
});

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
