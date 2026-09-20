import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLiveClient } from "@/test/fake-live-client";
import type { TokenListItem } from "@/lib/types";
import { LiveTokenGrid } from "./live-discover";
import { TradeTicker } from "./trade-ticker";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000a2";
const NEW = "0x00000000000000000000000000000000000000c9";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const api = vi.hoisted(() => ({ tokens: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), api }));

const item = (address: string, o: Partial<TokenListItem> = {}): TokenListItem => ({
  address, creator: "0xc0ffee", name: `Token ${address.slice(-2)}`, ticker: `T${address.slice(-2)}`, progressBps: 0, volumeQuote: 0n, tradeCount: 0,
  complete: false, migrated: false, createdAt: address === A ? 200n : 100n, ...o, // A is newer than B, as the API would list them
});
const trade = (n: number, token: string, quote = "1000000000000000") => ({
  type: "trade", id: `${tx(n)}-0`, chain: "sepolia", token, trader: "0x00000000000000000000000000000000000000f1", isBuy: true, quoteAmount: quote, tokenAmount: "5000000000000000000000000",
  fee: "0", launchTax: "0", virtualQuoteReserves: "1", virtualTokenReserves: "1000000000000000000000000000", timestamp: "1000", blockNumber: "5", txHash: tx(n), logIndex: 0,
});
const created = (n: number, token: string) => ({
  type: "created", id: `${tx(n)}-0`, chain: "sepolia", token, creator: "0x00000000000000000000000000000000000000f2", quoteToken: "0x00000000000000000000000000000000000000e5",
  name: "Fresh Coin", ticker: "FRSH", metadataURI: "ipfs://bafyabcde", blockNumber: "6", txHash: tx(n), logIndex: 0,
});

beforeEach(() => api.tokens.mockReset());

const cards = () => screen.getAllByTestId("token-card").map((c) => c.getAttribute("href")!.split("/").pop());

describe("LiveTokenGrid: new tokens", () => {
  const grid = (fake = fakeLiveClient(), over: Partial<React.ComponentProps<typeof LiveTokenGrid>> = {}) => {
    render(<LiveTokenGrid chain="sepolia" initial={[item(A), item(B)]} sort="new" q="" firstPage client={fake.client} {...over} />);
    return fake;
  };

  it("puts a token created a moment ago at the top of the grid without a reload, and marks it new for the entrance animation", () => {
    const fake = grid();
    act(() => fake.message("tokens", created(9, NEW)));
    expect(cards()).toEqual([NEW, A, B]);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-fresh", "true");
    expect(screen.getByText("Fresh Coin")).toBeInTheDocument();
  });

  it("does not add the same token twice when its event is delivered twice", () => {
    const fake = grid();
    act(() => fake.message("tokens", created(9, NEW)));
    act(() => fake.message("tokens", created(9, NEW)));
    expect(cards().filter((c) => c === NEW)).toHaveLength(1);
  });

  it("does not add a token that is already there", () => {
    const fake = grid();
    act(() => fake.message("tokens", created(9, A)));
    expect(cards()).toEqual([A, B]);
  });

  it("does NOT add it to a view where it does not belong: another sort, a search, or a later page", () => {
    for (const over of [{ sort: "volume" as const }, { q: "demo" }, { firstPage: false }]) {
      const fake = fakeLiveClient();
      const { unmount } = render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} {...over} />);
      act(() => fake.message("tokens", created(9, NEW)));
      expect(cards(), JSON.stringify(over)).toEqual([A]);
      unmount();
    }
  });

  it("ignores a created message that is not well-formed", () => {
    const fake = grid();
    act(() => fake.message("tokens", { ...created(9, NEW), token: "0x12" }));
    expect(cards()).toEqual([A, B]);
  });
});

describe("LiveTokenGrid: trades", () => {
  it("updates a card's volume and trade count as trades arrive, and flashes the number that changed", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A, { volumeQuote: 0n })]} sort="new" q="" firstPage client={fake.client} />);
    const flashing = () => document.querySelector('[data-testid="token-card"] [data-tick]');
    expect(flashing()).toBeNull();
    act(() => fake.message("trades", trade(1, A, "1000000000000000")));
    expect(screen.getByText("0.001 ETH")).toBeInTheDocument();
    expect(screen.getByText("1 trade")).toBeInTheDocument();
    expect(flashing()).not.toBeNull();
    expect(flashing()!.className).toContain("tick-flash-primary");
  });

  it("counts a trade once when it is delivered twice", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} />);
    act(() => fake.message("trades", trade(1, A)));
    act(() => fake.message("trades", trade(1, A)));
    expect(screen.getByText("1 trade")).toBeInTheDocument();
  });

  it("ignores a trade for a token that is not in the grid", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} />);
    act(() => fake.message("trades", trade(1, B)));
    expect(screen.getByText("0 trades")).toBeInTheDocument();
  });

  it("moves a card up when its volume overtakes the one above it, in the volume view", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A, { volumeQuote: 10n ** 16n }), item(B, { volumeQuote: 10n ** 15n })]} sort="volume" q="" firstPage client={fake.client} />);
    expect(cards()).toEqual([A, B]);
    act(() => fake.message("trades", trade(1, B, "50000000000000000")));
    expect(cards()).toEqual([B, A]);
  });
});

describe("LiveTokenGrid: not moving under the cursor", () => {
  const volumeGrid = () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A, { volumeQuote: 10n ** 16n }), item(B, { volumeQuote: 10n ** 15n })]} sort="volume" q="" firstPage client={fake.client} />);
    return fake;
  };

  it("keeps the order while the pointer is over the grid, still updating the numbers, and reorders when it leaves", () => {
    const fake = volumeGrid();
    const list = screen.getByRole("list");
    fireEvent.pointerEnter(list);
    act(() => fake.message("trades", trade(1, B, "50000000000000000")));
    expect(cards()).toEqual([A, B]); // B overtook A, but nothing moved under the pointer
    expect(within(screen.getAllByTestId("token-card")[1]!).getByText("0.051 ETH")).toBeInTheDocument(); // and its number is current
    fireEvent.pointerLeave(list);
    expect(cards()).toEqual([B, A]);
  });

  it("holds a new token back while the pointer is over the grid, and shows it when the pointer leaves", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} />);
    const list = screen.getByRole("list");
    fireEvent.pointerEnter(list);
    act(() => fake.message("tokens", created(9, NEW)));
    expect(cards()).toEqual([A]);
    fireEvent.pointerLeave(list);
    expect(cards()).toEqual([NEW, A]);
  });

  it("also holds still while a card has keyboard focus", () => {
    const fake = volumeGrid();
    const first = screen.getAllByTestId("token-card")[0]!;
    fireEvent.focusIn(first);
    act(() => fake.message("trades", trade(1, B, "50000000000000000")));
    expect(cards()).toEqual([A, B]);
    fireEvent.focusOut(first);
    expect(cards()).toEqual([B, A]);
  });
});

describe("LiveTokenGrid: keeping right", () => {
  it("refetches the first page after a reconnect, and shows what it missed", async () => {
    const fake = fakeLiveClient();
    api.tokens.mockResolvedValue({ items: [item(NEW, { createdAt: 300n }), item(A)] });
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} />);
    await act(async () => fake.reconnect());
    expect(api.tokens).toHaveBeenCalledWith("sepolia", expect.objectContaining({ sort: "new" }));
    expect(cards()).toEqual([NEW, A]);
  });

  it("does not refetch a later page or a search: they are not the live view", async () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage={false} client={fake.client} />);
    await act(async () => fake.reconnect());
    expect(api.tokens).not.toHaveBeenCalled();
  });

  it("listens to the two global rooms and no others", () => {
    const fake = fakeLiveClient();
    render(<LiveTokenGrid chain="sepolia" initial={[item(A)]} sort="new" q="" firstPage client={fake.client} />);
    expect(fake.rooms().sort()).toEqual(["tokens", "trades"]);
  });
});

describe("TradeTicker", () => {
  const ticker = (fake = fakeLiveClient()) => {
    render(<TradeTicker chain="sepolia" labels={{ [A]: "DEMO" }} client={fake.client} />);
    return fake;
  };

  it("says it is waiting until the first trade arrives", () => {
    ticker();
    expect(screen.getByText("Waiting for trades…")).toBeInTheDocument();
  });

  it("shows recent trades, newest first, naming the token by ticker (or its short address when unknown) and linking to it", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, A, "1000000000000000")));
    act(() => fake.message("trades", trade(2, B, "2000000000000000")));
    const items = screen.getAllByTestId("ticker-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/0\.002 ETH/);
    expect(items[0]).toHaveTextContent("0x0000…00a2"); // unknown token: short address
    expect(items[1]).toHaveTextContent("DEMO");
    expect(within(items[1]!).getByRole("link")).toHaveAttribute("href", `/sepolia/token/${A}`);
  });

  it("does not show a trade twice, and keeps only the newest 20", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, A)));
    act(() => fake.message("trades", trade(1, A)));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
    for (let i = 2; i <= 40; i++) act(() => fake.message("trades", trade(i, A)));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(20);
  });

  it("pauses on hover: nothing moves while the pointer is over it, and what arrived is shown when it leaves", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, A)));
    const region = screen.getByRole("region", { name: "Recent trades" });
    fireEvent.pointerEnter(region);
    act(() => fake.message("trades", trade(2, B)));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
    fireEvent.pointerLeave(region);
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(2);
  });

  it("ignores a message that is not a well-formed trade", () => {
    const fake = ticker();
    act(() => fake.message("trades", { ...trade(1, A), quoteAmount: "lots" }));
    expect(screen.queryAllByTestId("ticker-item")).toHaveLength(0);
  });
});

describe("motion", () => {
  it("has the flash animation, and switches it off for anyone who asked for less motion", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/\.tick-flash-primary\[data-tick="up"\]/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^@]*\.tick-flash-primary[^}]*animation: none/s);
  });
});
