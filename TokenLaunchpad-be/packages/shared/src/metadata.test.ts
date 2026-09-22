import { describe, expect, it } from "vitest";
import { ALLOWED_IMAGE_TYPES, buildMetadata, MAX_IMAGE_BYTES, safeHttpUrl, tokenFormSchema, tokenMetadataSchema } from "./metadata.js";

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

  // An icon next to the link says which platform it is; a link that is not really that platform, kept anyway, would
  // make the icon a lie. website has no real platform to check against, so it stays a plain http(s) link.
  it("drops a twitter link that does not point at twitter.com or x.com, keeping a good one", () => {
    for (const twitter of ["https://twitter.com/demo", "https://x.com/demo", "https://www.x.com/demo", "https://mobile.twitter.com/demo", "https://t.co/abc"]) {
      expect(tokenMetadataSchema.parse({ ...valid, socials: { twitter } }).socials.twitter, twitter).toBe(twitter);
    }
    for (const twitter of ["https://evil.example/demo", "https://nottwitter.com", "https://x.com.evil.example/demo"]) {
      expect(tokenMetadataSchema.parse({ ...valid, socials: { twitter } }).socials.twitter, twitter).toBeUndefined();
    }
  });

  it("drops a telegram link that does not point at t.me, keeping a good one", () => {
    for (const telegram of ["https://t.me/demo", "https://telegram.me/demo"]) {
      expect(tokenMetadataSchema.parse({ ...valid, socials: { telegram } }).socials.telegram, telegram).toBe(telegram);
    }
    for (const telegram of ["https://evil.example/demo", "https://t.me.evil.example/demo"]) {
      expect(tokenMetadataSchema.parse({ ...valid, socials: { telegram } }).socials.telegram, telegram).toBeUndefined();
    }
  });
});

describe("tokenFormSchema", () => {
  const form = { name: "Demo Token", ticker: "demo", description: "About it", antiSniperWindow: 60 };

  it("accepts a normal form and defaults the window to 60 seconds", () => {
    const parsed = tokenFormSchema.parse({ name: "Demo", ticker: "DEMO" });
    expect(parsed).toMatchObject({ name: "Demo", ticker: "DEMO", description: "", antiSniperWindow: 60 });
    expect(tokenFormSchema.safeParse(form).success).toBe(true);
  });

  it("trims the name and the ticker", () => {
    expect(tokenFormSchema.parse({ name: "  Demo  ", ticker: " DEMO " })).toMatchObject({ name: "Demo", ticker: "DEMO" });
  });

  it("rejects what the contract or the resolver would: an empty or 33-character name, a 1-character or spaced ticker", () => {
    const bad = [
      { ...form, name: "" },
      { ...form, name: "x".repeat(33) },
      { ...form, ticker: "D" },
      { ...form, ticker: "DE MO" },
      { ...form, ticker: "A".repeat(11) },
      { ...form, ticker: "DÉMO" },
    ];
    for (const b of bad) expect(tokenFormSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it("accepts exactly the four anti-sniper windows the contract does", () => {
    for (const w of [0, 60, 600, 5880]) expect(tokenFormSchema.safeParse({ ...form, antiSniperWindow: w }).success).toBe(true);
    for (const w of [30, 61, -1, 5881, "60"]) expect(tokenFormSchema.safeParse({ ...form, antiSniperWindow: w }).success, String(w)).toBe(false);
  });

  it("REJECTS a link that is not http(s), unlike the reader, which drops it: a form is where a person can still fix it", () => {
    for (const website of ["javascript:alert(1)", "data:text/html,x", "ftp://x.example", "not a url", "https://" + "a".repeat(200) + ".com"]) {
      expect(tokenFormSchema.safeParse({ ...form, website }).success, website).toBe(false);
    }
    expect(tokenFormSchema.safeParse({ ...form, website: "https://example.com", twitter: "https://x.com/demo", telegram: "https://t.me/demo" }).success).toBe(true);
  });

  it("REJECTS a twitter link that is not twitter.com or x.com, unlike a generic link", () => {
    for (const twitter of ["https://evil.example/demo", "https://nottwitter.com", "not a url"]) {
      expect(tokenFormSchema.safeParse({ ...form, twitter }).success, twitter).toBe(false);
    }
    for (const twitter of ["https://twitter.com/demo", "https://x.com/demo"]) {
      expect(tokenFormSchema.safeParse({ ...form, twitter }).success, twitter).toBe(true);
    }
  });

  it("REJECTS a telegram link that is not t.me", () => {
    expect(tokenFormSchema.safeParse({ ...form, telegram: "https://evil.example/demo" }).success).toBe(false);
    expect(tokenFormSchema.safeParse({ ...form, telegram: "https://t.me/demo" }).success).toBe(true);
  });

  it("treats an empty optional field as absent, so a form left blank is valid", () => {
    const parsed = tokenFormSchema.parse({ ...form, website: "", twitter: "", telegram: "" });
    expect([parsed.website, parsed.twitter, parsed.telegram]).toEqual([undefined, undefined, undefined]);
  });

  it("caps the description at 500 characters", () => {
    expect(tokenFormSchema.safeParse({ ...form, description: "x".repeat(501) }).success).toBe(false);
    expect(tokenFormSchema.safeParse({ ...form, description: "x".repeat(500) }).success).toBe(true);
  });
});

describe("buildMetadata", () => {
  it("builds the document the reader accepts, with the ticker upper-cased and the image as an ipfs:// URI", () => {
    const form = tokenFormSchema.parse({ name: "Demo", ticker: "demo", description: "d", website: "https://example.com" });
    const doc = buildMetadata(form, "bafyimage");
    expect(doc).toEqual({ name: "Demo", symbol: "DEMO", description: "d", image: "ipfs://bafyimage", socials: { website: "https://example.com" } });
    expect(tokenMetadataSchema.safeParse(doc).success).toBe(true);
  });

  it("leaves out links that were not given", () => {
    const doc = buildMetadata(tokenFormSchema.parse({ name: "Demo", ticker: "DEMO" }), "bafyimage");
    expect(doc.socials).toEqual({});
  });
});

describe("image limits", () => {
  it("are 2 MB and PNG, JPEG or WebP only: never SVG, which can carry script", () => {
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    expect([...ALLOWED_IMAGE_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});
