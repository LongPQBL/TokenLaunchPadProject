import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { FavoriteStar } from "./favorite-star";
import { FavoritesNotice, FavoritesProvider } from "@/lib/favorites/use-favorites";

// Signing is the wallet's job; wagmi's mock connector forwards it to a live RPC, which cannot run under jsdom.
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

/** The API for someone with (or without) a session, and a server-side list of stars that PUT and DELETE change. */
function fakeApi(o: { session?: boolean; stars?: string[]; put?: () => Response | Promise<Response>; del?: () => Response | Promise<Response> } = {}) {
  const state = { session: o.session ?? true, stars: [...(o.stars ?? [])], puts: [] as string[], dels: [] as string[], lists: 0, verified: 0 };
  server.use(
    http.get(`${API}/me`, () =>
      state.session ? HttpResponse.json({ address: TEST_USER }) : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 }),
    ),
    http.get(`${API}/auth/nonce`, () => HttpResponse.json({ message: "Sign in to Vezta", nonce: "n" })),
    http.post(`${API}/auth/verify`, () => {
      state.verified += 1;
      state.session = true;
      return HttpResponse.json({ address: TEST_USER });
    }),
    http.get(`${API}/sepolia/me/favorites`, () => {
      state.lists += 1;
      return HttpResponse.json({ tokens: state.stars });
    }),
    http.put(`${API}/sepolia/me/favorites/:token`, ({ params }) => {
      if (o.put) return o.put();
      state.puts.push(String(params.token));
      state.stars = [String(params.token), ...state.stars];
      return HttpResponse.json({ token: params.token, starred: true });
    }),
    http.delete(`${API}/sepolia/me/favorites/:token`, ({ params }) => {
      if (o.del) return o.del();
      state.dels.push(String(params.token));
      state.stars = state.stars.filter((t) => t !== params.token);
      return HttpResponse.json({ token: params.token, starred: false });
    }),
  );
  return state;
}

async function show(o: { connected?: boolean; loginSpy?: () => void; onChange?: (token: string, starred: boolean) => void } = {}) {
  const wallet = renderWithWallet(
    <FavoritesProvider chain="sepolia" onChange={o.onChange}>
      {/* The header's login control, which a star asks to press when nobody is connected. */}
      <button data-login-trigger onClick={o.loginSpy}>
        Log in
      </button>
      <FavoritesNotice />
      <FavoriteStar token={A} label="Alpha" />
      <FavoriteStar token={B} label="Beta" />
    </FavoritesProvider>,
  );
  if (o.connected ?? true) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
const star = (name: string) => screen.getByRole("button", { name: `Star ${name}` });

describe("a star", () => {
  it("shows which tokens are starred: the ones the account holds", async () => {
    fakeApi({ stars: [B] });
    await show();
    await waitFor(() => expect(star("Beta")).toHaveAttribute("aria-pressed", "true"));
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "false");
  });

  it("stars a token when pressed, at once, and the account keeps it", async () => {
    const api = fakeApi();
    await show();
    await waitFor(() => expect(api.lists).toBeGreaterThan(0));
    await userEvent.click(star("Alpha"));
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.puts).toEqual([A]));
  });

  it("unstars a starred token when pressed", async () => {
    const api = fakeApi({ stars: [A] });
    await show();
    await waitFor(() => expect(star("Alpha")).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(star("Alpha"));
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(api.dels).toEqual([A]));
  });

  it("puts the star back and says why when the account is full", async () => {
    fakeApi({ put: () => HttpResponse.json({ error: "too_many", message: "x" }, { status: 409 }) });
    await show();
    await userEvent.click(star("Alpha"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can star at most 500 tokens. Remove one first.");
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "false");
  });

  it("says to wait when stars are changed too fast, and when the server cannot be reached says that", async () => {
    fakeApi({ put: () => HttpResponse.json({ error: "rate_limited", message: "x" }, { status: 429 }) });
    await show();
    await userEvent.click(star("Alpha"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are changing your stars too fast. Please wait a moment.");
  });

  it("clears the message on the next press", async () => {
    let fail = true;
    fakeApi({ put: () => (fail ? HttpResponse.json({ error: "rate_limited", message: "x" }, { status: 429 }) : HttpResponse.json({ token: A, starred: true })) });
    await show();
    await userEvent.click(star("Alpha"));
    await screen.findByRole("alert");
    fail = false;
    await userEvent.click(star("Alpha"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("sends one request for a double press", async () => {
    const api = fakeApi({ put: async () => (await delay(150), HttpResponse.json({ token: A, starred: true })) });
    await show();
    await waitFor(() => expect(api.lists).toBeGreaterThan(0));
    await userEvent.dblClick(star("Alpha"));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "true"); // pressed twice fast is still one press, not on then off
  });
});

describe("telling the page a star changed", () => {
  it("says which token, and which way, once the server has accepted it", async () => {
    fakeApi({ stars: [B] });
    const onChange = vi.fn();
    await show({ onChange });
    await waitFor(() => expect(star("Beta")).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(star("Alpha"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(A, true));
    await userEvent.click(star("Beta"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(B, false));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("says nothing when the server refused", async () => {
    fakeApi({ put: () => HttpResponse.json({ error: "too_many", message: "x" }, { status: 409 }) });
    const onChange = vi.fn();
    await show({ onChange });
    await userEvent.click(star("Alpha"));
    await screen.findByRole("alert");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("makes a watchlist that was already loaded ask again, since it is out of date now", async () => {
    fakeApi();
    const wallet = await show();
    const key = ["watchlist", "sepolia", TEST_USER];
    wallet.queryClient.setQueryData(key, []);
    await userEvent.click(star("Alpha"));
    await waitFor(() => expect(wallet.queryClient.getQueryState(key)!.isInvalidated).toBe(true));
  });
});

describe("a star pressed before logging in", () => {
  it("asks the header to log in when no wallet is connected, and changes nothing", async () => {
    const api = fakeApi({ session: false });
    const loginSpy = vi.fn();
    await show({ connected: false, loginSpy });
    await userEvent.click(star("Alpha"));
    expect(loginSpy).toHaveBeenCalledOnce();
    expect(api.puts).toEqual([]);
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "false");
  });

  it("signs in first when a wallet is connected without a session, and then stars", async () => {
    const api = fakeApi({ session: false });
    await show();
    await userEvent.click(star("Alpha"));
    await waitFor(() => expect(api.puts).toEqual([A]));
    expect(api.verified).toBe(1);
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no stars, and asks the account for none, while nobody is signed in", async () => {
    const api = fakeApi({ session: false, stars: [A] });
    await show();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(api.lists).toBe(0);
    expect(star("Alpha")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("a star after logging out", () => {
  it("is not shown any more: the stars belong to the session, not to the page", async () => {
    const api = fakeApi({ stars: [A] });
    const wallet = await show();
    await waitFor(() => expect(star("Alpha")).toHaveAttribute("aria-pressed", "true"));
    api.session = false;
    await act(() => wallet.queryClient.invalidateQueries({ queryKey: ["siwe", "me"] }));
    await waitFor(() => expect(star("Alpha")).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("stars outside a table", () => {
  it("draws nothing rather than a button that does nothing", () => {
    renderWithWallet(<FavoriteStar token={A} label="Alpha" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
