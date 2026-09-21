import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import type { TokenRow } from "@/lib/types";
import { TokenTable } from "./token-table";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`) }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  server.use(
    http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })),
    http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: [] })),
  );
});
afterEach(() => vi.unstubAllEnvs());

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
const row = (address: string, o: Partial<TokenRow> = {}): TokenRow => ({
  address,
  creator: "0xc0ffee",
  name: "Alpha Coin",
  ticker: "ALPHA",
  progressBps: 2500,
  volumeQuote: 3n * ETH,
  tradeCount: 7_103,
  complete: false,
  migrated: false,
  createdAt: BigInt(NOW - 3 * 3600),
  stats: { marketCap: 5n * ETH, athMarketCap: 10n * ETH, volume24h: (3n * ETH) / 2n, traders24h: 1_905, change1hBps: 8_870, change6hBps: 632_070, change24hBps: -3_110 },
  ...o,
});

const table = (items: TokenRow[], o: Partial<React.ComponentProps<typeof TokenTable>> = {}) =>
  renderWithWallet(<TokenTable chain="sepolia" items={items} sort="new" q="" now={NOW} {...o} />);
const cells = (rowIndex = 0) => within(screen.getAllByTestId("token-row")[rowIndex]!).getAllByRole("cell");

describe("TokenTable: what it shows", () => {
  it("has the columns of a token table, in order, and names each one", () => {
    table([row(A)]);
    const names = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(names).toEqual(["Token", "MCAP", "ATH", "AGE", "TXNS", "24H VOL", "TRADERS", "1H", "6H", "24H", "Star"]);
  });

  it("shows each number of a token in its own cell, in the quote's units", () => {
    table([row(A)]);
    const text = cells().map((c) => c.textContent);
    expect(text[1]).toBe("5 ETH"); // market cap
    expect(text[2]).toContain("10 ETH"); // ATH
    expect(text[3]).toBe("3h");
    expect(text[4]).toBe("7,103");
    expect(text[5]).toBe("1.5 ETH");
    expect(text[6]).toBe("1,905");
  });

  it("shows the three changes with an arrow, a comma in the thousands, and a colour that says which way", () => {
    table([row(A)]);
    const [h1, h6, h24] = [cells()[7]!, cells()[8]!, cells()[9]!].map((c) => c.firstElementChild as HTMLElement);
    expect(h1).toHaveTextContent("↑ 88.7%");
    expect(h1).toHaveAttribute("data-direction", "up");
    expect(h6).toHaveTextContent("↑ 6,320.7%");
    expect(h24).toHaveTextContent("↓ 31.1%");
    expect(h24).toHaveAttribute("data-direction", "down");
  });

  it("shows no arrow for a change of nothing", () => {
    table([row(A, { stats: { ...row(A).stats!, change1hBps: 0 } })]);
    const chip = cells()[7]!.firstElementChild as HTMLElement;
    expect(chip).toHaveTextContent(/^0\.0%$/);
    expect(chip).toHaveAttribute("data-direction", "flat");
  });

  it("draws how far the market cap is from its high as a bar, and says it in words", () => {
    table([row(A)]); // 5 of 10
    const bar = within(cells()[2]!).getByRole("img");
    expect(bar).toHaveAccessibleName("50% of its all-time high");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("50%");
  });

  it("keeps the bar inside its box: at the high it is full, and it never passes it", () => {
    table([row(A, { stats: { ...row(A).stats!, marketCap: 12n * ETH, athMarketCap: 10n * ETH } })]);
    expect((within(cells()[2]!).getByRole("img").firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("links the token's name to its page, and shows its ticker beside it", () => {
    table([row(A)]);
    const link = within(cells()[0]!).getByRole("link", { name: /Alpha Coin/ });
    expect(link).toHaveAttribute("href", `/sepolia/token/${A}`);
    expect(cells()[0]).toHaveTextContent("ALPHA");
  });

  it("names a token with no name by its ticker, and one with neither by its short address", () => {
    table([row(A, { name: undefined }), row(B, { name: undefined, ticker: undefined })]);
    expect(cells(0)[0]).toHaveTextContent("ALPHA");
    expect(cells(1)[0]).toHaveTextContent("0x0000…00b2");
  });

  it("says when a token has graduated or is about to", () => {
    table([row(A, { migrated: true }), row(B, { complete: true })]);
    expect(cells(0)[0]).toHaveTextContent("GRADUATED");
    expect(cells(1)[0]).toHaveTextContent("GRADUATING…");
  });

  it("draws what a stranger wrote as text, never as markup", () => {
    table([row(A, { name: "<img src=x onerror=alert(1)>", ticker: "<b>X</b>" })]);
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(cells()[0]).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});

describe("TokenTable: a row with no numbers", () => {
  it("shows a dash where a number would be, and no arrow, rather than a zero that looks like a fact", () => {
    table([row(A, { stats: undefined })]);
    const text = cells().map((c) => c.textContent);
    for (const i of [1, 2, 5, 6]) expect(text[i], String(i)).toBe("—");
    expect(text[3]).toBe("3h"); // what the row itself knows is still shown
    expect(text[4]).toBe("7,103");
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("shows a dash for a market cap that is not known yet (no reserves), and draws no bar", () => {
    table([row(A, { stats: { ...row(A).stats!, marketCap: 0n, athMarketCap: 0n } })]);
    expect(cells()[1]).toHaveTextContent("—");
    expect(within(cells()[2]!).queryByRole("img")).toBeNull();
  });
});

describe("TokenTable: sorting by a header", () => {
  it("makes each sortable header a link to that sort, keeping the search", () => {
    table([row(A)], { q: "dog" });
    const link = (name: string) => within(screen.getByRole("columnheader", { name })).getByRole("link");
    expect(link("MCAP")).toHaveAttribute("href", "/sepolia?sort=mcap&q=dog");
    expect(link("AGE")).toHaveAttribute("href", "/sepolia?q=dog");
    expect(link("TXNS")).toHaveAttribute("href", "/sepolia?sort=txns&q=dog");
    expect(link("24H VOL")).toHaveAttribute("href", "/sepolia?sort=volume24h&q=dog");
    expect(link("TRADERS")).toHaveAttribute("href", "/sepolia?sort=traders&q=dog");
    expect(link("1H")).toHaveAttribute("href", "/sepolia?sort=change1h&q=dog");
    expect(link("6H")).toHaveAttribute("href", "/sepolia?sort=change6h&q=dog");
    expect(link("24H")).toHaveAttribute("href", "/sepolia?sort=change24h&q=dog");
  });

  it("sends the headers where the page says, when it is not discover (the watchlist has its own address)", () => {
    table([row(A)], { q: "", sortHref: (sort) => `/sepolia/watchlist?sort=${sort}` });
    expect(within(screen.getByRole("columnheader", { name: "MCAP" })).getByRole("link")).toHaveAttribute("href", "/sepolia/watchlist?sort=mcap");
    expect(within(screen.getByRole("columnheader", { name: "AGE" })).getByRole("link")).toHaveAttribute("href", "/sepolia/watchlist?sort=new");
  });

  it("marks the sorted column, and only that one", () => {
    table([row(A)], { sort: "volume24h" });
    const sorted = screen.getAllByRole("columnheader").filter((h) => h.getAttribute("aria-sort"));
    expect(sorted.map((h) => h.textContent?.trim())).toEqual(["24H VOL"]);
    expect(sorted[0]).toHaveAttribute("aria-sort", "descending");
  });

  it("marks AGE when the order is newest first, the default", () => {
    table([row(A)], { sort: "new" });
    expect(screen.getByRole("columnheader", { name: "AGE" })).toHaveAttribute("aria-sort", "descending");
  });

  it("does not offer to sort the token, ATH or star columns", () => {
    table([row(A)]);
    for (const name of ["Token", "ATH", "Star"]) expect(within(screen.getByRole("columnheader", { name })).queryByRole("link"), name).toBeNull();
  });
});

describe("TokenTable: the rest", () => {
  it("says so when there is nothing to show, and says when a search found nothing", () => {
    const { unmount } = table([]);
    expect(screen.getByRole("status")).toHaveTextContent("No tokens yet. Be the first to create one.");
    unmount();
    table([], { q: "zzz" });
    expect(screen.getByRole("status")).toHaveTextContent("No tokens match that search.");
  });

  it("links to the next page with the sort and search kept", () => {
    table([row(A)], { sort: "mcap", q: "dog", nextCursor: "abc" });
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/sepolia?sort=mcap&q=dog&cursor=abc");
  });

  it("restarts the flash on a row's 24 h volume each time it changes live, and not on the others", () => {
    table([row(A), row(B)], { flashes: { [A]: 2 } });
    expect(cells(0)[5]!.querySelector("[data-tick]")).not.toBeNull();
    expect(cells(1)[5]!.querySelector("[data-tick]")).toBeNull();
  });

  it("marks the rows that arrived live, for the entrance animation", () => {
    table([row(A), row(B)], { fresh: new Set([A]) });
    expect(screen.getAllByTestId("token-row")[0]).toHaveAttribute("data-fresh", "true");
    expect(screen.getAllByTestId("token-row")[1]).not.toHaveAttribute("data-fresh");
  });

  it("gives every row a star named after its token", () => {
    table([row(A), row(B, { name: "Beta" })]);
    expect(screen.getByRole("button", { name: "Star Alpha Coin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Star Beta" })).toBeInTheDocument();
  });

  it("shows a star as on when the account has it", async () => {
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json({ address: TEST_USER })),
      http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: [B] })),
    );
    const wallet = table([row(A), row(B, { name: "Beta" })]);
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    expect(await screen.findByRole("button", { name: "Star Beta", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Star Alpha Coin", pressed: false })).toBeInTheDocument();
  });

  it("passes the list's own handlers on, for the live grid to know when the pointer is over it", () => {
    const onPointerEnter = vi.fn();
    table([row(A)], { listProps: { onPointerEnter } });
    fireEvent.pointerEnter(screen.getByRole("table"));
    expect(onPointerEnter).toHaveBeenCalledOnce();
  });
});
