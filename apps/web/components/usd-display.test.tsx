import { act, screen, within } from "@testing-library/react";
import { collectedQuote, formatUsdValue, formatUsdPrice, graduationAmountFromReserves, marketCap, spotPrice, type UsdRate } from "@vezta/shared";
import { roundQuote } from "@/lib/format";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Holder, Order, Position, TokenDetail, TokenRow, Trade } from "@/lib/types";
import { fakeChain } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { fakeLiveClient } from "../test/fake-live-client";
import { GraduationProgress } from "./graduation-progress";
import { HoldersTable } from "./holders-table";
import { OrdersTable } from "./orders-table";
import { PositionsTable } from "./positions-table";
import { TokenCard } from "./token-card";
import { TokenHeader } from "./token-header";
import { TokenTable } from "./token-table";
import { TradeTicker } from "./trade-ticker";
import { TradesTable } from "./trades-table";

// Everywhere a price or an amount is drawn: dollars when the chain's feed answers (here $3,000 an ETH), ETH otherwise.
const RATE: UsdRate = { answer: 3_000n * 10n ** 8n, decimals: 8 };
const ETH = 10n ** 18n;
const NOW = 1_700_000_000;
const A = "0x00000000000000000000000000000000000000a1";
const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const show = (ui: React.ReactElement, withPrice = true) => renderWithWallet(ui, undefined, fakeChain(withPrice ? { usd: { answer: RATE.answer } } : {}).transport);

describe("the holders in dollars", () => {
  const holder: Holder = { holder: A, amount: 40_000_000n * ETH, spent: 3n * ETH, received: 0n, value: 6n * ETH, pnl: 3n * ETH };

  it("shows a holder's position and profit in dollars, the profit signed", async () => {
    show(<HoldersTable holders={[holder, { ...holder, holder: "0x00000000000000000000000000000000000000b2", pnl: -ETH }]} chain="sepolia" />);
    const rows = screen.getAllByTestId("holder-row");
    expect(await within(rows[0]!).findByText("$18K")).toBeInTheDocument(); // 6 ETH
    expect(within(rows[0]!).getByTestId("holder-pnl")).toHaveTextContent("+$9K"); // 3 ETH
    expect(within(rows[1]!).getByTestId("holder-pnl")).toHaveTextContent("-$3K"); // -1 ETH
  });

  it("shows ETH when there is no price", async () => {
    show(<HoldersTable holders={[holder]} chain="sepolia" />, false);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    const row = screen.getByTestId("holder-row");
    expect(row).toHaveTextContent("6 ETH");
    expect(within(row).getByTestId("holder-pnl")).toHaveTextContent("+3 ETH");
    expect(row).not.toHaveTextContent("$");
  });
});

describe("the token table in dollars", () => {
  const row = (o: Partial<TokenRow> = {}): TokenRow => ({
    address: A,
    creator: "0xc0ffee",
    name: "Alpha",
    ticker: "ALP",
    progressBps: 0,
    volumeQuote: ETH,
    tradeCount: 5,
    complete: false,
    migrated: false,
    createdAt: BigInt(NOW - 60),
    stats: { marketCap: 100n * ETH, athMarketCap: 200n * ETH, volume24h: ETH / 2n, traders24h: 3, change1hBps: 0, change6hBps: 0, change24hBps: 0 },
    ...o,
  });

  it("shows the market cap, the ATH and the 24 h volume as compact dollars", async () => {
    show(<TokenTable chain="sepolia" items={[row()]} sort="new" q="" now={NOW} />);
    const cells = within(screen.getByTestId("token-row")).getAllByRole("cell");
    expect(await within(cells[1]!).findByText("$300K")).toBeInTheDocument(); // 100 ETH
    expect(cells[2]).toHaveTextContent("$600K"); // 200 ETH
    expect(cells[6]).toHaveTextContent("$1.5K"); // 0.5 ETH
  });

  it("shows ETH when there is no price", async () => {
    show(<TokenTable chain="sepolia" items={[row()]} sort="new" q="" now={NOW} />, false);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    const cells = within(screen.getByTestId("token-row")).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("100 ETH");
    expect(cells[1]).not.toHaveTextContent("$");
  });
});

describe("the token card in dollars", () => {
  it("shows the volume in compact dollars", async () => {
    show(
      <TokenCard
        chain="sepolia"
        token={{ address: A, creator: "0xc0", name: "Alpha", ticker: "ALP", progressBps: 100, volumeQuote: 4n * ETH, tradeCount: 1, complete: false, migrated: false, createdAt: 1n }}
      />,
    );
    expect(await screen.findByText("$12K")).toBeInTheDocument();
  });
});

describe("the token header in dollars", () => {
  const detail: TokenDetail = {
    address: A,
    creator: "0xc0ffee0000000000000000000000000000000000",
    name: "Demo Token",
    ticker: "DEMO",
    progressBps: 4500,
    volumeQuote: 1n,
    tradeCount: 3,
    complete: false,
    migrated: false,
    createdAt: 1n,
    quoteToken: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    antiSniperWindow: 60,
    virtualQuoteReserves: 21_902_806_297_056_811n,
    virtualTokenReserves: 811_666_666_666_666_666_666_666_666n,
    metadataStatus: "ok",
    socials: {},
  };
  const price = spotPrice(detail.virtualQuoteReserves, detail.virtualTokenReserves);
  const cap = marketCap(detail.virtualQuoteReserves, detail.virtualTokenReserves);

  it("shows the price and the market cap in dollars only: the ETH is in the tooltip, not on the page", async () => {
    show(<TokenHeader chain="sepolia" token={detail} />);
    const dollars = await screen.findByText(formatUsdPrice(price, RATE));
    expect(screen.getByText(formatUsdValue(cap, RATE, 18, { compact: true }))).toBeInTheDocument();
    expect(screen.queryByText(/ETH/)).toBeNull();
    expect(dollars.closest("[title]")).toHaveAttribute("title", "0.000000000026985 ETH");
    expect(screen.getByText(formatUsdValue(cap, RATE, 18, { compact: true })).closest("[title]")).toHaveAttribute("title", "0.0269 ETH");
  });

  it("shows ETH alone, with the price written out in full, when there is no price", async () => {
    show(<TokenHeader chain="sepolia" token={detail} />, false);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(screen.getByText("0.000000000026985 ETH")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe("the graduation progress in dollars", () => {
  const token = {
    address: A,
    creator: "0xc0",
    name: "D",
    ticker: "D",
    progressBps: 4500,
    volumeQuote: 1n,
    tradeCount: 3,
    complete: false,
    migrated: false,
    createdAt: 1n,
    quoteToken: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    antiSniperWindow: 60,
    virtualQuoteReserves: 21_902_806_297_056_811n,
    virtualTokenReserves: 811_666_666_666_666_666_666_666_666n,
    metadataStatus: "ok" as const,
    socials: {},
  };
  const collected = collectedQuote(token.virtualQuoteReserves, token.virtualTokenReserves);
  const target = graduationAmountFromReserves(token.virtualQuoteReserves, token.virtualTokenReserves);

  it("says how much is collected against the target in dollars, the target rounded so a wei off does not read as a cent off", async () => {
    show(<GraduationProgress chain="sepolia" token={token} decimals={18} symbol="ETH" />);
    const usd = (raw: bigint) => formatUsdValue(roundQuote(raw, 18, 6), RATE);
    expect(await screen.findByText(`${usd(collected)} / ${usd(target)} collected`)).toBeInTheDocument();
    expect(usd(target)).toBe("$150.00"); // not $149.99
  });

  it("says it in ETH, as before, when there is no price", async () => {
    show(<GraduationProgress chain="sepolia" token={token} decimals={18} symbol="ETH" />, false);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(screen.getByText("0.0052 / 0.05 ETH collected")).toBeInTheDocument();
  });
});

describe("the trades in dollars", () => {
  const trade: Trade = {
    id: "1-0xabc-1",
    trader: "0xbeef000000000000000000000000000000000000",
    isBuy: true,
    quoteAmount: ETH / 100n,
    tokenAmount: 12_000_000n * ETH,
    fee: 0n,
    launchTax: 0n,
    virtualQuoteReserves: 1n,
    virtualTokenReserves: 1n,
    timestamp: BigInt(NOW - 2),
    blockNumber: 100n,
    logIndex: 1,
  };

  it("the trade table shows what each trade came to in dollars", async () => {
    show(<TradesTable trades={[trade]} chain="sepolia" now={NOW} />);
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
  });

  it("the ticker shows it in compact dollars", async () => {
    const fake = fakeLiveClient();
    show(<TradeTicker chain="sepolia" labels={{ [A]: "DEMO" }} client={fake.client} />);
    act(() =>
      fake.message("trades", {
        type: "trade", id: `${HASH}-0`, chain: "sepolia", token: A, trader: "0x00000000000000000000000000000000000000f1", isBuy: true, quoteAmount: String(ETH / 100n), tokenAmount: "5",
        fee: "0", launchTax: "0", virtualQuoteReserves: "1", virtualTokenReserves: "1", timestamp: "1", blockNumber: "1", txHash: HASH, logIndex: 0,
      }),
    );
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
  });
});

describe("positions and orders in dollars", () => {
  const position: Position = {
    token: { address: A, name: "Alpha", ticker: "ALP" },
    balance: 1_000n * ETH,
    spent: ETH / 100n,
    received: 0n,
    buys: 1,
    sells: 0,
    value: ETH / 50n,
    pnl: ETH / 100n,
    pnlBps: 10_000,
  };

  it("shows value, what it cost and the profit in dollars, and the totals too, with no ETH on the page", async () => {
    show(<PositionsTable chain="sepolia" positions={[position]} />);
    const cells = within(await screen.findByTestId("position-row")).getAllByRole("cell");
    await within(cells[2]!).findByText("$60.00"); // value: 0.02 ETH
    expect(cells[2]).not.toHaveTextContent("ETH");
    expect(cells[3]).toHaveTextContent("$30.00"); // cost: 0.01 ETH
    expect(cells[5]).toHaveTextContent("+$30.00");
    const totals = screen.getByRole("group", { name: "Totals" });
    expect(totals).toHaveTextContent("$60.00");
    expect(totals).toHaveTextContent("+$30.00");
  });

  it("shows the order total and the price in dollars, the price written out in full, with no ETH on the page", async () => {
    const order: Order = {
      id: `11155111-${HASH}-0`,
      txHash: HASH,
      token: { address: A, name: "Alpha", ticker: "ALP" },
      isBuy: true,
      quoteAmount: ETH / 100n,
      fee: 0n,
      total: ETH / 100n,
      tokenAmount: 1_000n * ETH,
      price: 15_625_000n,
      timestamp: BigInt(NOW - 60),
      blockNumber: 1n,
      logIndex: 0,
    };
    show(<OrdersTable chain="sepolia" orders={[order]} now={NOW} />);
    const cells = within(await screen.findByTestId("order-row")).getAllByRole("cell");
    await within(cells[3]!).findByText("$30.00");
    expect(cells[3]).not.toHaveTextContent("ETH");
    expect(cells[5]).toHaveTextContent("$0.000000046875");
    expect(cells[5]).not.toHaveTextContent("ETH");
  });
});
