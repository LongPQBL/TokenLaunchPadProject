import { describe, expect, it } from "vitest";
import { CHAINS, chainBySlug, chainSlugById } from "./chains.js";

describe("chains", () => {
  it("resolves sepolia by slug and by id", () => {
    expect(chainBySlug("sepolia")).toMatchObject({ chainId: 11155111, isTestnet: true, quoteSymbol: "ETH" });
    expect(chainSlugById(11155111)).toBe("sepolia");
  });

  // The link to trade a graduated token on Uniswap names the chain the way Uniswap's own URLs do.
  it("knows how Uniswap names each chain", () => {
    expect(chainBySlug("sepolia")!.uniswapSlug).toBe("sepolia");
    for (const chain of Object.values(CHAINS)) expect(chain.uniswapSlug, chain.slug).toMatch(/^[a-z0-9_]+$/);
  });

  it("returns undefined for an unknown slug or id", () => {
    expect(chainBySlug("mainnet")).toBeUndefined();
    expect(chainSlugById(1)).toBeUndefined();
  });

  // The slug comes straight from a URL. A plain object lookup would resolve these to inherited
  // members of Object.prototype, i.e. treat "constructor" as a valid chain.
  it("does not resolve slugs that name inherited object members", () => {
    for (const slug of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(chainBySlug(slug), slug).toBeUndefined();
    }
  });

  it("is case-sensitive: the slug is an exact URL segment", () => {
    expect(chainBySlug("Sepolia")).toBeUndefined();
  });

  it("keeps every entry's slug equal to its key, so the two lookups cannot disagree", () => {
    for (const [key, chain] of Object.entries(CHAINS)) expect(chain.slug).toBe(key);
  });
});
