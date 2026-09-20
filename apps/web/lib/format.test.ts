import { describe, expect, it } from "vitest";
import { parseAmount, formatCountdown, formatMultiplier, formatPercentBps, formatRelativeTime, formatShareOfSupply, isAddress, shortAddress } from "./format";

describe("formatRelativeTime", () => {
  const now = 1_700_000_000;
  const ago = (seconds: number) => formatRelativeTime(BigInt(now - seconds), now);

  it("counts seconds, minutes, hours and days", () => {
    expect(ago(2)).toBe("2s ago");
    expect(ago(59)).toBe("59s ago");
    expect(ago(60)).toBe("1m ago");
    expect(ago(3599)).toBe("59m ago");
    expect(ago(3600)).toBe("1h ago");
    expect(ago(86_400 * 3)).toBe("3d ago");
  });

  // A trade's time is the chain's, and "now" is this server's. They differ by seconds, so a trade can look like it
  // is from the future. That must read as now, never as "-3s ago".
  it("says 'just now' for the present and for clock skew into the future", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(-3)).toBe("just now");
    expect(ago(-86_400)).toBe("just now");
  });

  it("does not choke on an absurd timestamp", () => {
    expect(formatRelativeTime(10n ** 30n, now)).toBe("just now");
    expect(formatRelativeTime(0n, now)).toMatch(/d ago$/);
  });
});

describe("formatShareOfSupply", () => {
  const SUPPLY = 10n ** 27n;

  it("shows a share of the one-billion supply with two decimals", () => {
    expect(formatShareOfSupply(40_000_000n * 10n ** 18n, SUPPLY)).toBe("4.00%");
    expect(formatShareOfSupply(SUPPLY / 3n, SUPPLY)).toBe("33.33%");
  });

  // Holders are usually a tiny fraction of a billion tokens; rounding them to "0%" would hide who is who.
  it("does not round a small holding down to zero", () => {
    expect(formatShareOfSupply(1n * 10n ** 18n, SUPPLY)).toBe("<0.01%");
    expect(formatShareOfSupply(SUPPLY / 5000n, SUPPLY)).toBe("0.02%");
  });

  it("clamps to 100% and shows nothing for nothing", () => {
    expect(formatShareOfSupply(SUPPLY * 2n, SUPPLY)).toBe("100.00%");
    expect(formatShareOfSupply(0n, SUPPLY)).toBe("0%");
  });
});

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

describe("formatCountdown", () => {
  it("counts minutes and seconds, then hours", () => {
    expect(formatCountdown(299)).toBe("4:59");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(5880)).toBe("1:38:00");
  });

  it("never shows a negative or fractional time", () => {
    expect(formatCountdown(-4)).toBe("0:00");
    expect(formatCountdown(59.9)).toBe("0:59");
  });
});

describe("formatMultiplier", () => {
  it("shows one decimal", () => {
    expect(formatMultiplier(50.2)).toBe("50.2");
    expect(formatMultiplier(10)).toBe("10.0");
  });
});

describe("parseAmount", () => {
  it("reads plain decimals exactly", () => {
    expect(parseAmount("1")).toBe(10n ** 18n);
    expect(parseAmount("0.01")).toBe(10n ** 16n);
    expect(parseAmount(".5")).toBe(5n * 10n ** 17n);
    expect(parseAmount("2.")).toBe(2n * 10n ** 18n);
    expect(parseAmount("0.000000000000000001")).toBe(1n);
    expect(parseAmount(" 3 ")).toBe(3n * 10n ** 18n);
  });

  it("reads zero as zero, so the caller can say buying nothing is not an action", () => {
    expect(parseAmount("0")).toBe(0n);
    expect(parseAmount("0.0")).toBe(0n);
  });

  it("refuses everything else: signs, exponents, words, more decimals than the token has", () => {
    for (const bad of ["", "-1", "+1", "1e5", "abc", ".", "--1", "1,5", "0x10", "1.0000000000000000001", "1 000"]) {
      expect(parseAmount(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("works for a quote with fewer decimals", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.0000001", 6)).toBeUndefined();
  });
});
