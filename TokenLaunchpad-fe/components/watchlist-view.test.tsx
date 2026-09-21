import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLiveClient } from "../test/fake-live-client";
import { wireToken } from "../test/msw/fixtures";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { WatchlistView } from "./watchlist-view";

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
});
afterEach(() => vi.unstubAllEnvs());

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const stats = (marketCap: string) => ({ marketCap, athMarketCap: marketCap, volume24h: "0", traders24h: 0, change1hBps: 0, change6hBps: 0, change24hBps: 0 });
const wire = (address: string, name: string, marketCap: string, createdAt = "100") =>
  wireToken({ address, name, ticker: name.slice(0, 3).toUpperCase(), stats: stats(marketCap), createdAt });

function fakeApi(o: { session?: boolean; items?: unknown[]; fail?: boolean } = {}) {
  const state = { session: o.session ?? true, lists: 0, verified: 0 };
  server.use(
    http.get(`${API}/me`, () => (state.session ? HttpResponse.json({ address: TEST_USER }) : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 }))),
    http.get(`${API}/auth/nonce`, () => HttpResponse.json({ message: "Sign in to Vezta", nonce: "n" })),
    http.post(`${API}/auth/verify`, () => {
      state.verified += 1;
      state.session = true;
      return HttpResponse.json({ address: TEST_USER });
    }),
    http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: (o.items ?? []).map((i) => (i as { address: string }).address) })),
    http.get(`${API}/sepolia/me/watchlist`, () => {
      state.lists += 1;
      return o.fail ? HttpResponse.json({ error: "internal", message: "x" }, { status: 500 }) : HttpResponse.json({ items: o.items ?? [] });
    }),
  );
  return state;
}

async function show(o: { connected?: boolean; sort?: "new" | "mcap"; loginSpy?: () => void } = {}) {
  const fake = fakeLiveClient();
  const tree = (sort: "new" | "mcap") => (
    <>
      <button data-login-trigger onClick={o.loginSpy}>
        Header login
      </button>
      <WatchlistView chain="sepolia" sort={sort} client={fake.client} />
    </>
  );
  const wallet = renderWithWallet(tree(o.sort ?? "new"));
  if (o.connected ?? true) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return { fake, ...wallet, resort: (sort: "new" | "mcap") => wallet.rerender(tree(sort)) };
}
const names = () => screen.queryAllByTestId("token-row").map((r) => r.querySelector('a[href*="/token/"]')!.textContent);

describe("WatchlistView: before anyone is logged in", () => {
  it("says to log in, offers a button that opens the header's login, and asks the account for nothing", async () => {
    const api = fakeApi({ session: false });
    const loginSpy = vi.fn();
    await show({ connected: false, loginSpy });
    expect(screen.getByText("Log in to see the tokens you have starred.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(loginSpy).toHaveBeenCalledOnce();
    expect(api.lists).toBe(0);
  });

  it("signs in for a connected wallet that has no session, and then shows the list", async () => {
    const api = fakeApi({ session: false, items: [wire(A, "Alpha", "5")] });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(names()).toEqual(["Alpha"]));
    expect(api.verified).toBe(1);
  });
});

describe("WatchlistView: signed in", () => {
  it("shows the starred tokens as a table", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5"), wire(B, "Beta", "9")] });
    await show();
    await waitFor(() => expect(names().sort()).toEqual(["Alpha", "Beta"]));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says it is loading while it waits, and not that the list is empty", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5")] });
    await show();
    expect(screen.queryByText(/No starred tokens/)).toBeNull();
    await screen.findByRole("table");
  });

  it("says so, and how to add one, when nothing is starred", async () => {
    fakeApi({ items: [] });
    await show();
    expect(await screen.findByText("No starred tokens yet. Press the star beside a token to keep it here.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says it could not load, rather than an empty list, when the server fails", async () => {
    fakeApi({ fail: true });
    await show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this. Please try again in a moment.");
  });

  it("orders the rows by the sort the address asks for", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5"), wire(B, "Beta", "9")] });
    await show({ sort: "mcap" });
    await waitFor(() => expect(names()).toEqual(["Beta", "Alpha"]));
  });

  it("shows the new order at once when a header is pressed, even with the pointer still over the table", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5", "200"), wire(B, "Beta", "9", "100")] }); // newest first is Alpha, biggest is Beta
    const { resort } = await show({ sort: "new" });
    await waitFor(() => expect(names()).toEqual(["Alpha", "Beta"]));
    fireEvent.pointerEnter(screen.getByRole("table")); // the pointer is where the header was
    resort("mcap");
    await waitFor(() => expect(names()).toEqual(["Beta", "Alpha"]));
  });

  it("puts the header links on the watchlist's own address", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5")] });
    await show();
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "MCAP" }).querySelector("a")).toHaveAttribute("href", "/sepolia/watchlist?sort=mcap");
  });

  it("takes a token off the list when its star is taken off", async () => {
    fakeApi({ items: [wire(A, "Alpha", "5"), wire(B, "Beta", "9")] });
    server.use(http.delete(`${API}/sepolia/me/favorites/:token`, ({ params }) => HttpResponse.json({ token: params.token, starred: false })));
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Star Alpha", pressed: true }));
    await waitFor(() => expect(names()).toEqual(["Beta"]));
  });
});
