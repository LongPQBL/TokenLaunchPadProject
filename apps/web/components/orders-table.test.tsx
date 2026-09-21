import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/types";
import { OrdersTable } from "./orders-table";

const ETH = 10n ** 18n;
const NOW = 1_700_000_000;
const A = "0x00000000000000000000000000000000000000a1";
const HASH = `0x${"ab".repeat(32)}`;
const order = (o: Partial<Order> = {}): Order => ({
  id: `11155111-${HASH}-0`,
  txHash: HASH,
  token: { address: A, name: "Alpha Coin", ticker: "ALPHA" },
  isBuy: true,
  quoteAmount: ETH,
  fee: ETH / 100n,
  total: ETH + ETH / 100n,
  tokenAmount: 2_000_000n * ETH,
  price: 500_000_000_000n, // 5e-7 ETH per token
  timestamp: BigInt(NOW - 3 * 3600),
  blockNumber: 5n,
  logIndex: 0,
  ...o,
});
const rows = () => screen.getAllByTestId("order-row");
const cells = (i = 0) => within(rows()[i]!).getAllByRole("cell");

describe("OrdersTable", () => {
  it("has the columns of an order, in order", () => {
    render(<OrdersTable chain="sepolia" orders={[order()]} now={NOW} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual(["Time", "Token", "Type", "Total", "Amount", "Price", "Transaction"]);
  });

  it("says when, how much was paid or received in all, what of, and at what price", () => {
    render(<OrdersTable chain="sepolia" orders={[order()]} now={NOW} />);
    const text = cells().map((c) => c.textContent);
    expect(text[0]).toBe("3h ago");
    expect(text[2]).toBe("Buy");
    expect(text[3]).toBe("1.01 ETH"); // price + fee
    expect(text[4]).toContain("2M");
    expect(text[5]).toBe("0.0000005 ETH");
  });

  it("writes a launch-sized price out in full: it must not read as 0", () => {
    render(<OrdersTable chain="sepolia" orders={[order({ price: 15_625_000n })]} now={NOW} />);
    expect(cells()[5]).toHaveTextContent("0.000000000015625 ETH");
  });

  it("marks a buy green and a sell red, and shows a sell's total net of its fee", () => {
    render(<OrdersTable chain="sepolia" orders={[order(), order({ id: "x", isBuy: false, total: ETH - ETH / 100n })]} now={NOW} />);
    expect(within(cells(0)[2]!).getByText("Buy")).toHaveClass("text-buy");
    expect(within(cells(1)[2]!).getByText("Sell")).toHaveClass("text-sell");
    expect(cells(1)[3]).toHaveTextContent("0.99 ETH");
  });

  it("puts the time in a <time> element with its date", () => {
    render(<OrdersTable chain="sepolia" orders={[order()]} now={NOW} />);
    expect(within(cells()[0]!).getByText("3h ago")).toHaveAttribute("datetime", new Date((NOW - 3 * 3600) * 1000).toISOString());
  });

  it("links the token to its page and the transaction to the explorer, in a new tab that cannot reach back", () => {
    render(<OrdersTable chain="sepolia" orders={[order()]} now={NOW} />);
    expect(within(cells()[1]!).getByRole("link", { name: /Alpha Coin/ })).toHaveAttribute("href", `/sepolia/token/${A}`);
    const tx = within(cells()[6]!).getByRole("link", { name: "View" });
    expect(tx).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${HASH}`);
    expect(tx).toHaveAttribute("target", "_blank");
    expect(tx).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("gives no link for a transaction hash that is not one, rather than a broken one", () => {
    render(<OrdersTable chain="sepolia" orders={[order({ txHash: "0xnope" })]} now={NOW} />);
    expect(within(cells()[6]!).queryByRole("link")).toBeNull();
  });

  it("draws what a stranger wrote as text, never as markup", () => {
    render(<OrdersTable chain="sepolia" orders={[order({ token: { address: A, name: "<img src=x onerror=alert(1)>" } })]} now={NOW} />);
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(cells()[1]).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("says so when there are no orders", () => {
    render(<OrdersTable chain="sepolia" orders={[]} now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent("You have not placed an order yet.");
  });
});
