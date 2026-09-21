import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { PositionsView } from "./positions-view";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

const A = "0x00000000000000000000000000000000000000a1";
const HASH = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const wirePosition = (name: string, value = "3000000000000000000") => ({
  token: { address: A, name, ticker: name.slice(0, 3).toUpperCase() },
  balance: "1000000000000000000000",
  spent: "2000000000000000000",
  received: "0",
  buys: 1,
  sells: 0,
  value,
  pnl: "1000000000000000000",
  pnlBps: 5000,
});
const wireOrder = (n: number, name = "Alpha") => ({
  id: `11155111-${HASH(n)}-0`,
  txHash: HASH(n),
  token: { address: A, name, ticker: "ALP" },
  isBuy: n % 2 === 1,
  quoteAmount: "1000000000000000000",
  fee: "10000000000000000",
  total: "1010000000000000000",
  tokenAmount: "1000000000000000000000",
  price: "1000000000000000",
  timestamp: "1700000000",
  blockNumber: String(n),
  logIndex: 0,
});

function fakeApi(o: { positions?: unknown[]; pages?: unknown[][]; failPositions?: boolean; failOrders?: boolean } = {}) {
  const calls = { positions: [] as string[], orders: [] as { address: string; cursor: string | null }[] };
  server.use(
    http.get(`${API}/sepolia/addresses/:address/positions`, ({ params }) => {
      calls.positions.push(String(params.address));
      return o.failPositions ? HttpResponse.json({ error: "internal", message: "x" }, { status: 500 }) : HttpResponse.json({ items: o.positions ?? [] });
    }),
    http.get(`${API}/sepolia/addresses/:address/orders`, ({ params, request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      calls.orders.push({ address: String(params.address), cursor });
      if (o.failOrders) return HttpResponse.json({ error: "internal", message: "x" }, { status: 500 });
      const pages = o.pages ?? [[]];
      const index = cursor ? Number(cursor) : 0;
      return HttpResponse.json({ items: pages[index] ?? [], ...(index + 1 < pages.length ? { nextCursor: String(index + 1) } : {}) });
    }),
  );
  return calls;
}

async function show(o: { tab?: "positions" | "orders"; connected?: boolean; loginSpy?: () => void } = {}) {
  const wallet = renderWithWallet(
    <>
      <button data-login-trigger onClick={o.loginSpy}>
        Header login
      </button>
      <PositionsView chain="sepolia" tab={o.tab ?? "positions"} />
    </>,
  );
  if (o.connected ?? true) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

describe("PositionsView: before a wallet is connected", () => {
  it("says to connect one, opens the header's login from the button, and asks the API for nothing", async () => {
    const calls = fakeApi();
    const loginSpy = vi.fn();
    await show({ connected: false, loginSpy });
    expect(screen.getByText("Connect a wallet to see your positions and orders.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(loginSpy).toHaveBeenCalledOnce();
    expect(calls.positions).toEqual([]);
    expect(calls.orders).toEqual([]);
  });

  it("still shows the two views to choose between, since they are the page", async () => {
    fakeApi();
    await show({ connected: false });
    expect(screen.getByRole("navigation", { name: "Positions views" })).toBeInTheDocument();
  });
});

describe("PositionsView: the two views", () => {
  it("offers Positions and Order history as links, keeping the tab in the address, and marks the one that is showing", async () => {
    fakeApi();
    await show({ tab: "orders" });
    const nav = screen.getByRole("navigation", { name: "Positions views" });
    expect(within(nav).getByRole("link", { name: "Positions" })).toHaveAttribute("href", "/sepolia/positions");
    expect(within(nav).getByRole("link", { name: "Order history" })).toHaveAttribute("href", "/sepolia/positions?tab=orders");
    expect(within(nav).getByRole("link", { name: "Order history" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Positions" })).not.toHaveAttribute("aria-current");
  });
});

describe("PositionsView: positions", () => {
  it("shows what the connected wallet holds, asked for by its own address in lower case, and orders for nobody", async () => {
    const calls = fakeApi({ positions: [wirePosition("Alpha Coin")] });
    await show();
    expect(await screen.findByTestId("position-row")).toHaveTextContent("Alpha Coin");
    expect(calls.positions).toEqual([TEST_USER]);
    expect(calls.orders).toEqual([]);
  });

  it("says it is loading while it waits, then that nothing is held when nothing is", async () => {
    fakeApi({ positions: [] });
    await show();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByText("You hold no tokens yet. Buy one and it will show here.")).toBeInTheDocument();
  });

  it("says it could not load, not that nothing is held, when the server fails", async () => {
    fakeApi({ failPositions: true });
    await show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this. Please try again in a moment.");
  });
});

describe("PositionsView: order history", () => {
  it("shows the wallet's orders, and asks for positions of nobody", async () => {
    const calls = fakeApi({ pages: [[wireOrder(1), wireOrder(2, "Beta")]] });
    await show({ tab: "orders" });
    await waitFor(() => expect(screen.getAllByTestId("order-row")).toHaveLength(2));
    expect(calls.orders).toEqual([{ address: TEST_USER, cursor: null }]);
    expect(calls.positions).toEqual([]);
  });

  it("offers to load more when there is another page, and adds it below, once, without repeating the first", async () => {
    const calls = fakeApi({ pages: [[wireOrder(1), wireOrder(2)], [wireOrder(3)]] });
    await show({ tab: "orders" });
    await waitFor(() => expect(screen.getAllByTestId("order-row")).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("order-row")).toHaveLength(3));
    expect(calls.orders.map((c) => c.cursor)).toEqual([null, "1"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(); // that was the last page
  });

  it("offers no Load more when everything fits in one page", async () => {
    fakeApi({ pages: [[wireOrder(1)]] });
    await show({ tab: "orders" });
    await screen.findByTestId("order-row");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says there are no orders when there are none", async () => {
    fakeApi({ pages: [[]] });
    await show({ tab: "orders" });
    expect(await screen.findByText("You have not placed an order yet.")).toBeInTheDocument();
  });

  it("says it could not load when the server fails", async () => {
    fakeApi({ failOrders: true });
    await show({ tab: "orders" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this. Please try again in a moment.");
  });
});
