import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/types";
import { PositionsTable } from "./positions-table";

const ETH = 10n ** 18n;
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const position = (address: string, o: Partial<Position> = {}): Position => ({
  token: { address, name: "Alpha Coin", ticker: "ALPHA" },
  balance: 1_500_000n * ETH,
  spent: 2n * ETH,
  received: ETH / 2n,
  buys: 2,
  sells: 1,
  value: 3n * ETH,
  pnl: (3n * ETH) / 2n, // 3 + 0.5 - 2
  pnlBps: 7_500,
  ...o,
});
const rows = () => screen.getAllByTestId("position-row");
const cells = (i = 0) => within(rows()[i]!).getAllByRole("cell");

describe("PositionsTable", () => {
  it("has the columns of a position, in order, and names each one", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A)]} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual(["Token", "Balance", "Value", "Bought", "Sold", "PnL", "Trade"]);
  });

  it("shows what is held, what it is worth, what it cost and what came back, in the quote's units", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A)]} />);
    const text = cells().map((c) => c.textContent);
    expect(text[1]).toBe("1.5M"); // balance in tokens
    expect(text[2]).toBe("3 ETH");
    expect(text[3]).toBe("2 ETH");
    expect(text[4]).toBe("0.5 ETH");
  });

  it("shows the profit with its sign and the percent beside it, green for a gain", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A)]} />);
    const pnl = cells()[5]!;
    expect(pnl).toHaveTextContent("+1.5 ETH");
    expect(pnl).toHaveTextContent("+75.0%");
    expect(within(pnl).getByTestId("pnl")).toHaveAttribute("data-direction", "up");
  });

  it("shows a loss with a minus and red", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A, { pnl: -ETH / 4n, pnlBps: -1_250 })]} />);
    expect(cells()[5]).toHaveTextContent("-0.25 ETH");
    expect(cells()[5]).toHaveTextContent("-12.5%");
    expect(within(cells()[5]!).getByTestId("pnl")).toHaveAttribute("data-direction", "down");
  });

  it("shows a dash for what was never bought or sold on the curve, and no percentage for a token that cost nothing", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A, { spent: 0n, received: 0n, buys: 0, sells: 0, pnl: 3n * ETH, pnlBps: null })]} />);
    expect(cells()[3]).toHaveTextContent("—");
    expect(cells()[4]).toHaveTextContent("—");
    expect(cells()[5]).toHaveTextContent(/^\+3 ETH$/); // nothing after it: no percentage, and not a dash pretending to be one
  });

  it("links the name to the token's page, and offers Trade there", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A)]} />);
    expect(within(cells()[0]!).getByRole("link", { name: /Alpha Coin/ })).toHaveAttribute("href", `/sepolia/token/${A}`);
    expect(within(cells()[6]!).getByRole("link", { name: "Trade" })).toHaveAttribute("href", `/sepolia/token/${A}`);
  });

  it("names a token with no name by its ticker, and with neither by its short address", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A, { token: { address: A, ticker: "ONLY" } }), position(B, { token: { address: B } })]} />);
    expect(cells(0)[0]).toHaveTextContent("ONLY");
    expect(cells(1)[0]).toHaveTextContent("0x0000…00b2");
  });

  it("draws what a stranger wrote as text, never as markup", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A, { token: { address: A, name: "<img src=x onerror=alert(1)>", ticker: "<b>X</b>" } })]} />);
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(cells()[0]).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("adds up what everything is worth and what has been made or lost, above the table", () => {
    render(<PositionsTable chain="sepolia" positions={[position(A), position(B, { value: ETH, pnl: -ETH / 2n, pnlBps: -3_333 })]} />);
    const totals = screen.getByRole("group", { name: "Totals" });
    expect(within(totals).getByText("Total value").parentElement).toHaveTextContent("4 ETH");
    expect(within(totals).getByText("Total PnL").parentElement).toHaveTextContent("+1 ETH");
  });

  it("says so when nothing is held", () => {
    render(<PositionsTable chain="sepolia" positions={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("You hold no tokens yet. Buy one and it will show here.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
