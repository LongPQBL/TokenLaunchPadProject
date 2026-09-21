import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { shortAddress } from "@/lib/format";
import type { Holder, Trade } from "@/lib/types";
import { HoldersTable } from "./holders-table";
import { TokenTabs } from "./token-tabs";
import { TradesTable } from "./trades-table";

const NOW = 1_700_000_000;
const TRADER = "0xbeef000000000000000000000000000000000000";
const trade = (o: Partial<Trade> = {}): Trade => ({
  id: "1-0xabc-1",
  trader: TRADER,
  isBuy: true,
  quoteAmount: 4_000_000_000_000_000n, // 0.004 ETH
  tokenAmount: 12_000_000n * 10n ** 18n,
  fee: 0n,
  launchTax: 0n,
  virtualQuoteReserves: 1n,
  virtualTokenReserves: 1n,
  timestamp: BigInt(NOW - 2),
  blockNumber: 100n,
  logIndex: 1,
  ...o,
});

describe("TradesTable", () => {
  const table = (trades: Trade[]) => render(<TradesTable trades={trades} chain="sepolia" now={NOW} />);

  it("colours a buy green and a sell red, and says which is which in words", () => {
    table([trade({ id: "a", isBuy: true }), trade({ id: "b", isBuy: false })]);
    const [buy, sell] = screen.getAllByTestId("trade-row");
    expect(within(buy!).getByText("Buy")).toHaveClass("text-buy");
    expect(within(sell!).getByText("Sell")).toHaveClass("text-sell");
  });

  it("shows the token amount compactly and the value in the chain's currency, both in the mono font", () => {
    table([trade()]);
    const row = screen.getByTestId("trade-row");
    expect(within(row).getByText("12M")).toHaveClass("font-mono");
    expect(within(row).getByText("0.004 ETH").closest(".font-mono")).not.toBeNull();
  });

  it("shows when the trade happened, relative to now", () => {
    table([trade()]);
    expect(screen.getByText("2s ago")).toBeInTheDocument();
  });

  it("links the trader, shortened, to the block explorer", () => {
    table([trade()]);
    expect(screen.getByRole("link", { name: shortAddress(TRADER) })).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${TRADER}`);
  });

  it("does not make a link out of a trader that is not an address", () => {
    table([trade({ trader: "javascript:alert(1)" })]);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("shows the empty state, not an empty table, when there are no trades", () => {
    table([]);
    expect(screen.getByText("No trades yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the order it was given, newest first", () => {
    table([trade({ id: "new", tokenAmount: 5n * 10n ** 18n }), trade({ id: "old", tokenAmount: 9_000n * 10n ** 18n })]);
    const rows = screen.getAllByTestId("trade-row");
    expect(rows[0]).toHaveTextContent("5");
    expect(rows[1]).toHaveTextContent("9K");
  });

  // Corrupt data must not take the whole page down: new Date(1e33).toISOString() throws a RangeError.
  it("copes with a timestamp that is not a real date", () => {
    expect(() => table([trade({ timestamp: 10n ** 30n })])).not.toThrow();
    expect(screen.getByTestId("trade-row")).toBeInTheDocument();
  });
});

describe("HoldersTable", () => {
  const SUPPLY = 10n ** 27n;
  const ETH = 10n ** 18n;
  const holder = (n: number, tokens: bigint, o: Partial<Holder> = {}): Holder => ({
    holder: `0x${n.toString(16).padStart(40, "0")}`,
    amount: tokens * ETH,
    spent: 0n,
    received: 0n,
    value: 0n,
    pnl: 0n,
    ...o,
  });
  const table = (holders: Holder[]) => render(<HoldersTable holders={holders} chain="sepolia" />);
  const cells = (i = 0) => within(screen.getAllByTestId("holder-row")[i]!).getAllByRole("cell");

  it("has four columns: the holder, their position, their profit and their share of the supply", () => {
    table([holder(1, 1n)]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Holder", "Position", "Profit", "% supply"]);
    expect(cells()).toHaveLength(4);
  });

  it("keeps the holders in the order given, with their share of the supply", () => {
    table([holder(1, 40_000_000n), holder(2, 10_000_000n)]);
    const rows = screen.getAllByTestId("holder-row");
    expect(rows).toHaveLength(2);
    expect(cells(0)[3]).toHaveTextContent("4.00%");
    expect(cells(1)[3]).toHaveTextContent("1.00%");
  });

  it("shows what a holder's tokens are worth as their position, with how many tokens that is a hover away", () => {
    table([holder(1, 40_000_000n, { value: 16n * ETH })]);
    expect(cells()[1]).toHaveTextContent("16 ETH");
    expect(cells()[1]).toHaveAttribute("title", "40M tokens");
  });

  it("shows a profit with a plus and in the buy colour, and a loss with a minus and in the sell colour", () => {
    table([holder(1, 1n, { pnl: 2n * ETH }), holder(2, 1n, { pnl: -3n * (ETH / 2n) }), holder(3, 1n, { pnl: 0n })]);
    const profit = (i: number) => within(cells(i)[2]!).getByTestId("holder-pnl");
    expect(profit(0)).toHaveTextContent("+2 ETH");
    expect(profit(0)).toHaveAttribute("data-direction", "up");
    expect(profit(0)).toHaveClass("text-buy");
    expect(profit(1)).toHaveTextContent("-1.5 ETH");
    expect(profit(1)).toHaveAttribute("data-direction", "down");
    expect(profit(1)).toHaveClass("text-sell");
    expect(profit(2)).toHaveAttribute("data-direction", "flat");
    expect(profit(2)).not.toHaveClass("text-buy", "text-sell");
  });

  it("names a holder who has said who they are, and shows anyone else as a shortened address", () => {
    table([holder(1, 5n, { username: "bluntoctopus666" }), holder(0xabc, 5n)]);
    expect(cells(0)[0]).toHaveTextContent("bluntoctopus666");
    expect(cells(1)[0]).toHaveTextContent(shortAddress(`0x${(0xabc).toString(16).padStart(40, "0")}`));
  });

  it("draws their picture, and a lettered placeholder for a holder without one", () => {
    table([holder(1, 5n, { username: "octopus", avatarUrl: "https://ipfs.io/ipfs/bafyavatar" }), holder(2, 5n, { username: "goryorca" })]);
    const img = within(cells(0)[0]!).getByRole("img");
    expect(img).toHaveAttribute("src", "https://ipfs.io/ipfs/bafyavatar");
    expect(img).toHaveClass("rounded-full");
    expect(within(cells(1)[0]!).getByTestId("token-image-placeholder")).toHaveTextContent("G");
  });

  it("does not draw a picture whose address is not http(s): it is written by a stranger", () => {
    table([holder(1, 5n, { username: "sneaky", avatarUrl: "javascript:alert(1)" })]);
    expect(within(cells()[0]!).queryByRole("img")).toBeNull();
    expect(within(cells()[0]!).getByTestId("token-image-placeholder")).toBeInTheDocument();
  });

  it("draws a name as text, never as markup", () => {
    table([holder(1, 5n, { username: "<img src=x onerror=alert(1)>" })]);
    expect(cells()[0]).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(within(cells()[0]!).queryAllByRole("img").filter((i) => i.getAttribute("src") === "x")).toHaveLength(0);
  });

  // Every listed holder is a real holder (the API leaves out the curve, the pool and the burn address), so what is
  // listed can only ever add up to less than the whole supply.
  it("shows shares that add up to no more than the whole supply", () => {
    const holders = [holder(1, 300_000_000n), holder(2, 200_000_000n), holder(3, 100_000_000n)];
    table(holders);
    const total = screen
      .getAllByTestId("holder-row")
      .map((row) => Number(/(\d+\.\d+)%/.exec(row.textContent ?? "")![1]))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(60, 1);
    expect(total).toBeLessThanOrEqual(100);
    expect(holders.reduce((a, h) => a + h.amount, 0n)).toBeLessThan(SUPPLY);
  });

  it("does not show a small holding as zero", () => {
    table([holder(1, 1n)]);
    expect(screen.getByTestId("holder-row")).toHaveTextContent("<0.01%");
  });

  it("links each holder to their page in the app, and only when it is an address", () => {
    table([holder(0xabc, 5n), { ...holder(1, 5n), holder: "not-an-address" }]);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", `/sepolia/profile/0x${(0xabc).toString(16).padStart(40, "0")}`);
  });

  it("shows the empty state when there are no holders", () => {
    table([]);
    expect(screen.getByText("No holders yet.")).toBeInTheDocument();
  });
});

describe("TokenTabs", () => {
  const tabs = () => render(<TokenTabs trades={<p>trade rows</p>} holders={<p>holder rows</p>} comments={<p>comment rows</p>} />);

  it("offers Trades, Holders and Comments, starting on Trades", () => {
    tabs();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Trades", "Holders", "Comments"]);
    expect(screen.getByRole("tab", { name: "Trades" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("trade rows")).toBeInTheDocument();
    expect(screen.queryByText("holder rows")).not.toBeInTheDocument();
  });

  it("switches to the holders and back", async () => {
    tabs();
    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(screen.getByText("holder rows")).toBeInTheDocument();
    expect(screen.queryByText("trade rows")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Trades" }));
    expect(screen.getByText("trade rows")).toBeInTheDocument();
  });

  it("shows the comments panel without breaking the tab strip", async () => {
    tabs();
    await userEvent.click(screen.getByRole("tab", { name: "Comments" }));
    expect(screen.getByText("comment rows")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
