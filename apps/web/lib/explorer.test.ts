import { CHAINS } from "@vezta/shared";
import { describe, expect, it } from "vitest";
import { explorerAddressUrl } from "./explorer";

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
