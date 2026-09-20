import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { testWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { useSiwe } from "./use-siwe";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear(); // wagmi remembers a connection there, which would leak from one test into the next
  signer.signMessageAsync.mockReset().mockResolvedValue(`0x${"11".repeat(65)}`);
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

// Signing is the wallet's job and wagmi's; what is under test is what useSiwe does around it. (wagmi's mock connector
// forwards signing to a live RPC, which cannot run under jsdom.)
const signer = vi.hoisted(() => ({ signMessageAsync: vi.fn() }));
vi.mock("wagmi", async (importOriginal) => ({ ...(await importOriginal<typeof import("wagmi")>()), useSignMessage: () => signer }));

/** A tiny fake of the API's sign-in: remembers whether a session exists, like the real one's cookie would. */
function fakeApi(opts: { sessionFor?: string } = {}) {
  const state = { session: opts.sessionFor as string | undefined, calls: [] as string[], verified: undefined as unknown };
  server.use(
    http.get(`${API}/me`, () => {
      state.calls.push("me");
      return state.session ? HttpResponse.json({ address: state.session }) : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 });
    }),
    http.get(`${API}/auth/nonce`, ({ request }) => {
      state.calls.push(`nonce:${new URL(request.url).searchParams.get("address")}`);
      return HttpResponse.json({ message: "Sign in to Vezta", nonce: "abc" });
    }),
    http.post(`${API}/auth/verify`, async ({ request }) => {
      state.calls.push("verify");
      state.verified = await request.json();
      state.session = TEST_USER;
      return HttpResponse.json({ address: TEST_USER });
    }),
    http.post(`${API}/auth/logout`, () => {
      state.calls.push("logout");
      state.session = undefined;
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

async function setup(connected = true) {
  const wallet = testWallet();
  const hook = renderHook(() => useSiwe(), { wrapper: wallet.wrapper });
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return { ...hook, ...wallet };
}

describe("useSiwe", () => {
  it("is not signed in without a session", async () => {
    fakeApi();
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSignedIn).toBe(false);
  });

  it("does not ask the API who is signed in while no wallet is connected: there is nobody to ask about", async () => {
    const api = fakeApi();
    const { result } = await setup(false);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.isSignedIn).toBe(false);
    expect(api.calls).not.toContain("me");
  });

  it("is signed in when the session belongs to the connected wallet", async () => {
    fakeApi({ sessionFor: TEST_USER });
    const { result } = await setup();
    await waitFor(() => expect(result.current.isSignedIn).toBe(true));
  });

  it("is NOT signed in when the session belongs to a different address than the connected wallet", async () => {
    fakeApi({ sessionFor: "0x00000000000000000000000000000000000000ff" });
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSignedIn).toBe(false);
  });

  it("signs in: asks for a challenge for the wallet, has the wallet sign it, and sends the result", async () => {
    const api = fakeApi();
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.signIn();
    });
    expect(outcome).toBe(true);
    expect(api.calls.filter((c) => c !== "me").map((c) => c.toLowerCase())).toEqual([`nonce:${TEST_USER}`, "verify"]);
    expect(api.verified).toMatchObject({ message: "Sign in to Vezta" });
    expect((api.verified as { signature: string }).signature).toMatch(/^0x[0-9a-f]+$/i);
    await waitFor(() => expect(result.current.isSignedIn).toBe(true));
  });

  it("hands the wallet the server's message exactly, and nothing else to sign", async () => {
    fakeApi();
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => void (await result.current.signIn()));
    expect(signer.signMessageAsync).toHaveBeenCalledWith({ message: "Sign in to Vezta" });
  });

  it("returns false, quietly, when the person declines to sign, and never calls the server's verify", async () => {
    const api = fakeApi();
    const { UserRejectedRequestError } = await import("viem");
    signer.signMessageAsync.mockRejectedValue(new UserRejectedRequestError(new Error("no")));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.signIn();
    });
    expect(outcome).toBe(false);
    expect(api.calls).not.toContain("verify");
  });

  it("does nothing, and says no, when there is no wallet to sign with", async () => {
    const api = fakeApi();
    const { result } = await setup(false);
    await expect(result.current.signIn()).rejects.toMatchObject({ code: "not_connected" });
    expect(api.calls.filter((c) => c.startsWith("nonce"))).toEqual([]);
  });

  it("signs out on the server and forgets the session", async () => {
    const api = fakeApi({ sessionFor: TEST_USER });
    const { result } = await setup();
    await waitFor(() => expect(result.current.isSignedIn).toBe(true));
    await act(async () => {
      await result.current.signOut();
    });
    expect(api.calls).toContain("logout");
    await waitFor(() => expect(result.current.isSignedIn).toBe(false));
  });

  it("lets a server refusal reach the caller, so the form can say sign-in failed", async () => {
    fakeApi();
    server.use(http.post(`${API}/auth/verify`, () => HttpResponse.json({ error: "invalid_signin", message: "nope" }, { status: 401 })));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.signIn()).rejects.toMatchObject({ code: "invalid_signin" });
  });
});
