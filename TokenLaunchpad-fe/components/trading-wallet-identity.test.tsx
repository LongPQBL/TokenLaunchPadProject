import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLiveClient } from "@/test/fake-live-client";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { ChainGuard } from "./chain-guard";
import { PositionsView } from "./positions-view";
import { SideNav } from "./side-nav";
import { WalletConnectButton } from "./wallet-connect-button";
import { WatchlistView } from "./watchlist-view";

// Where the trading wallet is who the person is: every page that says "mine" asks for the TRADING wallet's address, never the main one.
vi.mock("next/navigation", () => ({ usePathname: () => "/sepolia" }));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

const TRADING = privateKeyToAccount(generatePrivateKey());
const ready: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };
const notOpen = (over: Partial<SessionValue> = {}): SessionValue => ({ status: "needs-signature", account: undefined, main: TEST_USER, enable: vi.fn(async () => true), ...over });

async function show(ui: React.ReactElement, session: SessionValue, connected = true) {
  const wallet = renderWithWallet(<SessionContext.Provider value={session}>{ui}</SessionContext.Provider>, [externalConnector()]);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

describe("the side nav's Profile", () => {
  it("is the trading wallet's profile", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })));
    await show(<SideNav chain="sepolia" />, ready);
    expect(await screen.findByRole("link", { name: "Profile" })).toHaveAttribute("href", `/sepolia/profile/${TRADING.address}`);
  });

  it("opens the trading wallet when it is not open yet, rather than sending someone to the main wallet's page", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })));
    const session = notOpen();
    await show(<SideNav chain="sepolia" />, session);
    expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(session.enable).toHaveBeenCalledOnce();
  });
});

describe("positions and the watchlist", () => {
  it("ask for the trading wallet's positions, in lower case, and never the main wallet's", async () => {
    const asked: string[] = [];
    server.use(http.get(`${API}/sepolia/addresses/:address/positions`, ({ params }) => (asked.push(String(params.address)), HttpResponse.json({ items: [] }))));
    await show(<PositionsView chain="sepolia" tab="positions" />, ready);
    await screen.findByText("You hold no tokens yet. Buy one and it will show here.");
    expect(asked).toEqual([TRADING.address.toLowerCase()]);
  });

  it("say the trading wallet is not open, and how to open it, instead of showing the main wallet's or a connect prompt", async () => {
    const calls: string[] = [];
    server.use(http.get(`${API}/sepolia/addresses/:address/positions`, ({ params }) => (calls.push(String(params.address)), HttpResponse.json({ items: [] }))));
    await show(<PositionsView chain="sepolia" tab="positions" />, notOpen());
    expect(await screen.findByRole("button", { name: "Open trading wallet" })).toBeInTheDocument();
    expect(screen.queryByText("Connect a wallet to see your positions and orders.")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("the watchlist says the same, and asks the API for nothing", async () => {
    const calls: string[] = [];
    server.use(http.get(`${API}/sepolia/me/watchlist`, () => (calls.push("list"), HttpResponse.json({ items: [] }))));
    await show(<WatchlistView chain="sepolia" sort="new" client={fakeLiveClient().client} />, notOpen());
    expect(await screen.findByRole("button", { name: "Open trading wallet" })).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe("the network the main wallet is on", () => {
  it("does not stop a trade: the trading wallet signs in the browser, for the app's chain", async () => {
    const wallet = renderWithWallet(
      <SessionContext.Provider value={ready}>
        <ChainGuard chainName="Sepolia">
          <p>the buy button</p>
        </ChainGuard>
      </SessionContext.Provider>,
      [externalConnector()],
    );
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: 1 as never }).catch(() => undefined));
    expect(await screen.findByText("the buy button")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });
});

describe("the header", () => {
  it("shows the trading wallet's address once it is open, and the connected wallet's until then", async () => {
    const { unmount } = await show(<WalletConnectButton />, ready);
    expect(await screen.findByText(new RegExp(`^${TRADING.address.slice(0, 6)}`, "i"))).toBeInTheDocument();
    unmount();
    localStorage.clear();
    await show(<WalletConnectButton />, notOpen());
    expect(await screen.findByText(new RegExp(`^${TEST_USER.slice(0, 6)}`, "i"))).toBeInTheDocument();
  });
});
