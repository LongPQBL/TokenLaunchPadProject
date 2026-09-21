import { act, renderHook, waitFor } from "@testing-library/react";
import { connect, disconnect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER, testWallet } from "../../test/wallet";
import { useAutoSiwe } from "./use-auto-siwe";

// What the sign-in hook says, set by each test.
const siwe = vi.hoisted(() => ({ isSignedIn: false, isLoading: false, signIn: vi.fn() }));
// Like the real hook, it hands out a NEW signIn function on every render: the effect re-runs each time, and only the
// once-per-address guard stands between a failing sign-in and a loop.
vi.mock("./use-siwe", () => ({ useSiwe: () => ({ ...siwe, signIn: () => siwe.signIn() }) }));

const named = (id: string, account: `0x${string}` = TEST_USER) => {
  const base = mock({ accounts: [account] });
  return (cfg: Parameters<typeof base>[0]) => ({ ...base(cfg), id });
};
const OTHER = "0x00000000000000000000000000000000000000b7" as const;

beforeEach(() => {
  localStorage.clear();
  Object.assign(siwe, { isSignedIn: false, isLoading: false });
  siwe.signIn.mockReset().mockResolvedValue(true);
});

async function setup(id: string, account: `0x${string}` = TEST_USER) {
  const wallet = testWallet([named(id, account)]);
  const hook = renderHook(() => useAutoSiwe(), { wrapper: wallet.wrapper });
  await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return { ...wallet, ...hook };
}

describe("useAutoSiwe", () => {
  it("signs an embedded wallet in to the API, once: it signs without asking, so this costs the person nothing", async () => {
    await setup("io.privy.wallet");
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(1));
  });

  it("does nothing when there is already a session for this address", async () => {
    siwe.isSignedIn = true;
    await setup("io.privy.wallet");
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(siwe.signIn).not.toHaveBeenCalled();
  });

  it("waits for the session lookup to finish before deciding there is none", async () => {
    siwe.isLoading = true;
    await setup("io.privy.wallet");
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(siwe.signIn).not.toHaveBeenCalled();
  });

  // An external wallet would put a signature request in front of the person: that is asked for by an action, never by a login.
  it("never signs an external wallet in by itself, and not a look-alike of the embedded one", async () => {
    for (const id of ["io.metamask", "injected", "io.privy.wallet.evil"]) {
      const { unmount } = await setup(id);
      await act(() => new Promise((r) => setTimeout(r, 60)));
      expect(siwe.signIn, id).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("tries once per address: a failure is not retried in a loop, and is handled rather than left as an unhandled rejection", async () => {
    // A failing sign-in whose rejection handler we can see being attached (a bare rejected promise cannot say whether it was handled).
    let handled = 0;
    const failing = { catch: (fn: (e: unknown) => void) => (handled++, fn(new Error("api down")), failing), then: () => failing };
    siwe.signIn.mockReturnValue(failing);
    const { rerender } = await setup("io.privy.wallet");
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(siwe.signIn).toHaveBeenCalledTimes(1);
    expect(handled).toBe(1);
  });

  it("does not ask again when the person declined", async () => {
    siwe.signIn.mockResolvedValue(false);
    const { rerender } = await setup("io.privy.wallet");
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(1));
    rerender();
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(siwe.signIn).toHaveBeenCalledTimes(1);
  });

  // Review Focus 4: a different login is a different person, and logging in again is a new sign-in.
  it("signs in again after a log out and back in, and for a different address", async () => {
    const first = await setup("io.privy.wallet");
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(1));
    await act(() => disconnect(first.config));
    await act(() => connect(first.config, { connector: first.config.connectors[0]!, chainId: sepolia.id }));
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(2));
    first.unmount();
    localStorage.clear(); // a different browser session: wagmi would otherwise restore the first wallet before the second connects

    const second = await setup("io.privy.wallet", OTHER);
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledTimes(3));
    second.unmount();
  });
});
