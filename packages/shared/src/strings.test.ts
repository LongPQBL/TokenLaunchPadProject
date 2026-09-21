import { describe, expect, it } from "vitest";
import { UI } from "./strings.js";

describe("UI strings", () => {
  // The end-to-end tests and the spec both look for this exact text.
  it("labels the network as a testnet so nobody mistakes it for real money", () => {
    expect(UI.badge.testnet("Sepolia")).toBe("SEPOLIA TESTNET");
  });

  // The badge names the chain it is on: a second testnet must not say "SEPOLIA".
  it("builds the testnet badge from the chain's own name", () => {
    expect(UI.badge.testnet("Base Sepolia")).toBe("BASE SEPOLIA TESTNET");
  });

  it("builds the graduation progress line from already-formatted amounts", () => {
    expect(UI.token.collected("0.039", "0.05", "ETH")).toBe("0.039 / 0.05 ETH collected");
  });

  it("uses the three discover tabs the spec names", () => {
    expect(Object.values(UI.discover.tabs)).toEqual(["New", "Trending", "Nearing graduation"]);
  });

  it("says '1 trade' but '12 trades'", () => {
    expect(UI.token.trades(1)).toBe("1 trade");
    expect(UI.token.trades(12)).toBe("12 trades");
    expect(UI.token.trades(0)).toBe("0 trades");
  });

  it("labels a buy and a sell, and the table columns", () => {
    expect(UI.token.side).toEqual({ buy: "Buy", sell: "Sell" });
    expect(Object.values(UI.token.columns)).toEqual(["#", "Type", "Amount", "Value", "Trader", "Time", "Holder", "Balance", "Share"]);
  });

  it("words the comment thread, its limit and each way a post can be refused", () => {
    expect(UI.comments.empty).toBe("No comments yet. Be the first to say something.");
    expect(UI.comments.counter(12, 500)).toBe("12 / 500");
    expect(UI.comments.errors.banned).toMatch(/cannot post/i);
    expect(UI.comments.errors.rateLimited).toMatch(/too fast/i);
    expect(Object.keys(UI.comments.errors).sort()).toEqual(["banned", "generic", "hiddenToken", "network", "rateLimited", "tooLong"]);
  });

  it("offers the four launch-protection windows the contract accepts, in words", () => {
    expect(Object.keys(UI.create.window.options).map(Number)).toEqual([0, 60, 600, 5880]);
    expect(UI.create.window.options[0]).toBe("No protection");
    expect(UI.create.window.options[5880]).toBe("98 minutes");
  });

  it("has a label for paging on", () => {
    expect(UI.discover.next).toBe("Next page");
  });

  it("names the network a wallet has to switch to", () => {
    expect(UI.wallet.switchTo("Sepolia")).toBe("Switch to Sepolia");
    expect(UI.wallet.wrongNetwork("Sepolia")).toContain("Sepolia");
  });
});
