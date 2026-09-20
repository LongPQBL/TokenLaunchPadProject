import { describe, expect, it } from "vitest";
import { safeHttpUrl, tokenMetadataSchema } from "./metadata.js";

describe("safeHttpUrl", () => {
  it("accepts http and https", () => {
    expect(safeHttpUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com");
  });

  // Spec §11: a javascript: URL in an href executes. Token links are attacker-controlled.
  it("rejects javascript: and data: URLs", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHttpUrl("  javascript:alert(1)  ")).toBeUndefined();
  });

  it("rejects other schemes that can carry a payload or leave the browser", () => {
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHttpUrl("file:///etc/passwd")).toBeUndefined();
    expect(safeHttpUrl("ftp://example.com")).toBeUndefined();
  });

  it("rejects non-strings and nonsense", () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
    expect(safeHttpUrl({ toString: () => "https://example.com" })).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
  });
});

describe("tokenMetadataSchema", () => {
  const valid = {
    name: "Demo Token",
    symbol: "DEMO",
    description: "A token",
    image: "ipfs://bafyimage",
    socials: { website: "https://example.com" },
  };

  it("accepts a well-formed document", () => {
    expect(tokenMetadataSchema.parse(valid)).toMatchObject({ name: "Demo Token", symbol: "DEMO" });
  });

  it("fills in defaults for optional fields", () => {
    const out = tokenMetadataSchema.parse({ name: "Bare", symbol: "BARE" });
    expect(out.description).toBe("");
    expect(out.socials).toEqual({});
  });

  it("rejects an over-long name and description", () => {
    expect(() => tokenMetadataSchema.parse({ ...valid, name: "x".repeat(33) })).toThrow();
    expect(() => tokenMetadataSchema.parse({ ...valid, description: "x".repeat(501) })).toThrow();
  });

  it("rejects a bad ticker", () => {
    expect(() => tokenMetadataSchema.parse({ ...valid, symbol: "A" })).toThrow();
    expect(() => tokenMetadataSchema.parse({ ...valid, symbol: "TOO-LONG-TICKER" })).toThrow();
    expect(() => tokenMetadataSchema.parse({ ...valid, symbol: "AB CD" })).toThrow();
  });

  it("drops a hostile social link instead of failing the whole document", () => {
    const out = tokenMetadataSchema.parse({ ...valid, socials: { website: "javascript:alert(1)" } });
    expect(out.socials.website).toBeUndefined();
  });

  it("keeps the good links when one of several is hostile", () => {
    const out = tokenMetadataSchema.parse({
      ...valid,
      socials: { website: "javascript:alert(1)", twitter: "https://x.com/demo" },
    });
    expect(out.socials.twitter).toBe("https://x.com/demo");
    expect(out.socials.website).toBeUndefined();
  });

  it("keeps a name containing markup as literal text, to be escaped at render time", () => {
    const out = tokenMetadataSchema.parse({ ...valid, name: "<script>x</script>" });
    expect(out.name).toBe("<script>x</script>");
  });
});
