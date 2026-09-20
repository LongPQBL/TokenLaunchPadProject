import { describe, expect, it } from "vitest";
import { UI } from "./strings.js";

describe("UI strings", () => {
  // The end-to-end tests and the spec both look for this exact text.
  it("labels the network as a testnet so nobody mistakes it for real money", () => {
    expect(UI.badge.testnet).toBe("SEPOLIA TESTNET");
  });

  it("builds the graduation progress line from already-formatted amounts", () => {
    expect(UI.token.collected("0.039", "0.05", "ETH")).toBe("0.039 / 0.05 ETH collected");
  });

  it("uses the three discover tabs the spec names", () => {
    expect(Object.values(UI.discover.tabs)).toEqual(["New", "Trending", "Nearing graduation"]);
  });
});
