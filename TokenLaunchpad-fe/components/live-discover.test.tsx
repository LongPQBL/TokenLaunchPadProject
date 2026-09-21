import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLiveClient } from "@/test/fake-live-client";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { http, HttpResponse } from "msw";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  api.tokens.mockReset();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  server.use(
    http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })),
    http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: [] })),
  );
});
afterEach(() => vi.unstubAllEnvs());

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

const hidden = (token: string, over: Record<string, unknown> = {}) => ({ type: "token_hidden", chain: "sepolia", token, ...over });

describe("LiveTokenGrid: a token hidden while the page is open", () => {
  const grid = (fake = fakeLiveClient()) => {
    render(<LiveTokenGrid chain="sepolia" initial={[item(A), item(B)]} sort="new" q="" firstPage client={fake.client} />);
    return fake;
  };

  it("takes its card off the grid at once, and leaves the others", () => {
    const fake = grid();
    act(() => fake.message("tokens", hidden(A)));
    expect(cards()).toEqual([B]);
  });

  it("does not bring it back when a late trade or a repeated creation arrives", () => {
    const fake = grid();
    act(() => fake.message("tokens", hidden(A)));
    act(() => fake.message("trades", trade(1, A)));
    act(() => fake.message("tokens", created(2, A)));
    expect(cards()).toEqual([B]);
  });

  it("ignores the announcement when it is for another chain or is not well-formed", () => {
    const fake = grid();
    act(() => fake.message("tokens", hidden(A, { chain: "mainnet" })));
    act(() => fake.message("tokens", hidden(A, { token: "0x12" })));
    expect(cards()).toEqual([A, B]);
  });

  it("takes it off even while the pointer is over the grid, since a hidden token must not stay on screen", () => {
    const fake = grid();
    fireEvent.pointerEnter(screen.getAllByRole("list")[0]!);
    act(() => fake.message("tokens", hidden(A)));
    expect(cards()).toEqual([B]);
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

describe("LiveTokenGrid as a table", () => {
  const stats = { marketCap: 5n * 10n ** 18n, athMarketCap: 5n * 10n ** 18n, volume24h: 100n, traders24h: 2, change1hBps: 0, change6hBps: 0, change24hBps: 0 };
  const rows = () => screen.getAllByTestId("token-row").map((r) => r.querySelector<HTMLAnchorElement>('a[href*="/token/"]')!.getAttribute("href")!.split("/").pop());
  const view = (fake = fakeLiveClient(), over: Partial<React.ComponentProps<typeof LiveTokenGrid>> = {}) => {
    const wallet = renderWithWallet(
      <LiveTokenGrid chain="sepolia" initial={[{ ...item(A), stats }, { ...item(B), stats }]} sort="new" q="" firstPage view="table" now={1_000} client={fake.client} {...over} />,
    );
    return { fake, ...wallet };
  };

  it("draws a table, not cards, and listens to the same two rooms", () => {
    const { fake } = view();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryAllByTestId("token-card")).toHaveLength(0);
    expect(fake.rooms().sort()).toEqual(["tokens", "trades"]);
  });

  it("puts a token created a moment ago at the top, with dashes for the numbers it does not have yet", () => {
    const { fake } = view();
    act(() => fake.message("tokens", created(9, NEW)));
    expect(rows()).toEqual([NEW, A, B]);
    expect(within(screen.getAllByTestId("token-row")[0]!).getAllByRole("cell")[1]).toHaveTextContent("—");
  });

  it("moves a row's market cap, trades and 24 h volume when a trade arrives, and flashes the volume", () => {
    const { fake } = view();
    act(() => fake.message("trades", trade(1, A, "1000")));
    const cells = within(screen.getAllByTestId("token-row").find((r) => r.querySelector(`a[href$="${A}"]`))!).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent("1"); // trades
    expect(cells[6]!.querySelector("[data-tick]")).not.toBeNull();
    expect(cells[1]).not.toHaveTextContent("5 ETH"); // the market cap is where the trade's reserves put it
  });

  it("takes a hidden token's row off the table at once", () => {
    const { fake } = view();
    act(() => fake.message("tokens", hidden(A)));
    expect(rows()).toEqual([B]);
  });

  it("re-sorts by the column it was sorted by as the numbers move", () => {
    const { fake } = view(fakeLiveClient(), { sort: "txns" });
    expect(rows()).toEqual([B, A]); // no trades on either: ties go to the higher address
    act(() => fake.message("trades", trade(1, A)));
    expect(rows()).toEqual([A, B]);
  });

  it("holds the arrangement while the pointer is over the table", () => {
    const { fake } = view(fakeLiveClient(), { sort: "txns" });
    fireEvent.pointerEnter(screen.getByRole("table"));
    act(() => fake.message("trades", trade(1, A)));
    expect(rows()).toEqual([B, A]);
    fireEvent.pointerLeave(screen.getByRole("table"));
    expect(rows()).toEqual([A, B]);
  });
});

describe("LiveTokenGrid as a watchlist", () => {
  const stats = { marketCap: 5n * 10n ** 18n, athMarketCap: 5n * 10n ** 18n, volume24h: 100n, traders24h: 2, change1hBps: 0, change6hBps: 0, change24hBps: 0 };
  const rows = () => screen.getAllByTestId("token-row").map((r) => r.querySelector<HTMLAnchorElement>('a[href*="/token/"]')!.getAttribute("href")!.split("/").pop());
  const watch = (fake = fakeLiveClient()) => {
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json({ address: TEST_USER })),
      http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: [A, B] })),
      http.delete(`${API}/sepolia/me/favorites/:token`, ({ params }) => HttpResponse.json({ token: params.token, starred: false })),
    );
    const wallet = renderWithWallet(
      <LiveTokenGrid chain="sepolia" initial={[{ ...item(A), stats }, { ...item(B), stats }]} sort="new" q="" firstPage view="table" watchlist now={1_000} client={fake.client} />,
    );
    return { fake, ...wallet };
  };

  it("does not add a token that was created, since it was not starred", () => {
    const { fake } = watch();
    act(() => fake.message("tokens", created(9, NEW)));
    expect(rows()).toEqual([A, B]);
  });

  it("still moves the numbers of a row when a trade arrives", () => {
    const { fake } = watch();
    act(() => fake.message("trades", trade(1, A)));
    const cells = within(screen.getAllByTestId("token-row").find((r) => r.querySelector(`a[href$="${A}"]`))!).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent("1");
  });

  it("refetches its own rows after a reconnect, from the watchlist and not from discover", async () => {
    const { fake } = watch();
    server.use(http.get(`${API}/sepolia/me/watchlist`, () => HttpResponse.json({ items: [{ address: A, creator: "0xc0ffee", name: "Only One", ticker: "ONE", progressBps: 0, volumeQuote: "0", tradeCount: 0, complete: false, migrated: false, createdAt: "100" }] })));
    act(() => fake.reconnect());
    await waitFor(() => expect(rows()).toEqual([A]));
    expect(api.tokens).not.toHaveBeenCalled();
  });

  it("takes a row off the list when its star is taken off", async () => {
    const wallet = watch();
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    const starOfA = await screen.findByRole("button", { name: `Star ${item(A).name}`, pressed: true });
    await userEvent.click(starOfA);
    await waitFor(() => expect(rows()).toEqual([B]));
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

  it("drops a token's trades the moment it is hidden, and ignores its trades from then on", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, A)));
    act(() => fake.message("trades", trade(2, B)));
    act(() => fake.message("trades", hidden(A)));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
    act(() => fake.message("trades", trade(3, A)));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
    expect(screen.getByTestId("ticker-item")).toHaveTextContent("0x0000…00a2");
  });

  it("drops the hidden token's trades that were held back while the pointer was over the strip", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, B)));
    const region = screen.getByRole("region", { name: "Recent trades" });
    fireEvent.pointerEnter(region);
    act(() => fake.message("trades", trade(2, A)));
    act(() => fake.message("trades", hidden(A)));
    fireEvent.pointerLeave(region);
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
  });

  it("ignores a hidden announcement for another chain", () => {
    const fake = ticker();
    act(() => fake.message("trades", trade(1, A)));
    act(() => fake.message("trades", hidden(A, { chain: "mainnet" })));
    expect(screen.getAllByTestId("ticker-item")).toHaveLength(1);
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
