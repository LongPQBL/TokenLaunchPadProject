import { describe, expect, it } from "vitest";
import { containsSecret, scrubSecrets } from "./scrub";

const SIGNATURE = `0x${"ab".repeat(65)}`;
const PRIVATE_KEY = `0x${"12".repeat(32)}`;
const ADDRESS = "0x00000000000000000000000000000000000000a1";
const TX_HASH = `0x${"cd".repeat(32)}`;

describe("containsSecret", () => {
  it("spots a 65-byte signature and a 32-byte key inside any text", () => {
    expect(containsSecret(`failed with ${SIGNATURE} here`)).toBe(true);
    expect(containsSecret(`key=${PRIVATE_KEY}`)).toBe(true);
  });

  it("leaves addresses alone: they are public and useful in a report", () => {
    expect(containsSecret(`sent to ${ADDRESS}`)).toBe(false);
  });

  it("cannot tell a private key from a transaction hash (both are 32 bytes), so it redacts both: a key must never leak", () => {
    expect(containsSecret(`tx ${TX_HASH}`)).toBe(true);
  });

  it("does not mistake a longer hex string for a key by cutting it, but does catch one inside it", () => {
    expect(containsSecret(`0x${"ab".repeat(200)}`)).toBe(true);
    expect(containsSecret("0x1234")).toBe(false);
  });
});

describe("scrubSecrets", () => {
  it("redacts them wherever they sit in a nested report, without touching the rest", () => {
    const event = { message: `boom ${SIGNATURE}`, extra: { list: [`k ${PRIVATE_KEY}`, ADDRESS], n: 3 }, user: { id: 1 } };
    expect(scrubSecrets(event)).toEqual({ message: "boom [redacted]", extra: { list: ["k [redacted]", ADDRESS], n: 3 }, user: { id: 1 } });
  });

  it("also redacts a secret used as an object key", () => {
    expect(Object.keys(scrubSecrets({ [SIGNATURE]: 1 }) as object)).toEqual(["[redacted]"]);
  });

  it("does not loop on a report that refers to itself", () => {
    const a: Record<string, unknown> = { note: SIGNATURE };
    a.self = a;
    const out = scrubSecrets(a) as Record<string, unknown>;
    expect(out.note).toBe("[redacted]");
  });

  it("does not change what it was given", () => {
    const event = { message: SIGNATURE };
    scrubSecrets(event);
    expect(event.message).toBe(SIGNATURE);
  });
});
