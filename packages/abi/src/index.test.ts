import { describe, expect, it } from "vitest";
import { getAbiItem } from "viem";
import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "./index.js";

describe("abi", () => {
  it("exposes the events the indexer subscribes to", () => {
    for (const name of ["CreatePool", "Trade", "Complete", "Migrated"] as const) {
      expect(getAbiItem({ abi: launchpadAbi, name }), name).toBeDefined();
    }
    expect(getAbiItem({ abi: tokenFactoryAbi, name: "TokenCreated" })).toBeDefined();
    expect(getAbiItem({ abi: tokenAbi, name: "Transfer" })).toBeDefined();
  });

  it("keeps Trade's reserve fields, which the indexer reads instead of calling the chain", () => {
    const trade = getAbiItem({ abi: launchpadAbi, name: "Trade" });
    const names = trade!.inputs.map((i) => i.name);
    expect(names).toContain("virtualQuoteReserves");
    expect(names).toContain("virtualTokenReserves");
  });
});
