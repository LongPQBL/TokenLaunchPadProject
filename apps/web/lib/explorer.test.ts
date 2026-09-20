import { CHAINS } from "@vezta/shared";
import { describe, expect, it } from "vitest";
import { explorerAddressUrl, explorerTxUrl, uniswapSwapUrl } from "./explorer";

const ADDR = "0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744";
const sepolia = CHAINS.sepolia;

describe("explorerAddressUrl", () => {
  it("builds the address page on the chain's explorer", () => {
    expect(explorerAddressUrl(sepolia, ADDR)).toBe(`https://sepolia.etherscan.io/address/${ADDR}`);
  });

  // The value is about to become an href, so anything that is not an address gets no link at all.
  it("returns undefined for anything that is not an address", () => {
    for (const bad of ["", "0xa1", "javascript:alert(1)", `${ADDR}/../../x`, `0x${"z".repeat(40)}`]) {
      expect(explorerAddressUrl(sepolia, bad), bad).toBeUndefined();
    }
  });

  it("returns undefined when the chain is unknown", () => {
    expect(explorerAddressUrl(undefined, ADDR)).toBeUndefined();
  });
});

describe("explorerTxUrl", () => {
  const chain = { explorerUrl: "https://sepolia.etherscan.io" } as never;
  const hash = `0x${"ab".repeat(32)}`;

  it("links a real transaction hash", () => {
    expect(explorerTxUrl(chain, hash)).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
  });

  it("links nothing that is not a 32-byte hash", () => {
    expect(explorerTxUrl(chain, "javascript:alert(1)")).toBeUndefined();
    expect(explorerTxUrl(chain, "0x1234")).toBeUndefined();
    expect(explorerTxUrl(undefined, hash)).toBeUndefined();
  });
});

describe("uniswapSwapUrl", () => {
  it("points Uniswap at the token on the right chain", () => {
    expect(uniswapSwapUrl(sepolia, ADDR)).toBe(`https://app.uniswap.org/swap?chain=sepolia&outputCurrency=${ADDR}`);
  });

  it("links nothing for a value that is not an address, or an unknown chain", () => {
    expect(uniswapSwapUrl(sepolia, "javascript:alert(1)")).toBeUndefined();
    expect(uniswapSwapUrl(undefined, ADDR)).toBeUndefined();
  });
});
