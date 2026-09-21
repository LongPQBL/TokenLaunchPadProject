import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { PrivyActiveProvider } from "@/lib/wallet/privy-context";
import { ConnectButton } from "./connect-button";
import { LoginButton, PRIVY_PATIENCE_MS } from "./login-button";

// What Privy says, set by each test. Privy itself is not started: its own screens are Privy's to test.
const privy = vi.hoisted(() => ({ ready: true, authenticated: false, login: vi.fn(), logout: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy, useExportWallet: () => ({ exportWallet: vi.fn() }) }));

const order: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  order.length = 0;
  Object.assign(privy, { ready: true, authenticated: false });
  privy.login.mockReset();
  privy.logout.mockReset().mockImplementation(async () => void order.push("privy-logout"));
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  server.use(
    http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })),
    http.post(`${API}/auth/logout`, () => {
      order.push("api-logout");
      return HttpResponse.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

async function show(ui = <LoginButton />, connected = false) {
  const wallet = renderWithWallet(ui);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

describe("LoginButton", () => {
  it("offers Log in when nobody is logged in, and the click opens Privy's login, not a wallet list of ours", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(privy.login).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Review Focus 1 (the UI half): a Privy that is not ready yet must not crash or send anyone anywhere.
  it("is disabled, not broken, while Privy is not ready", async () => {
    privy.ready = false;
    await show();
    const button = screen.getByRole("button", { name: "Log in" });
    expect(button).toBeDisabled();
    await userEvent.click(button).catch(() => undefined);
    expect(privy.login).not.toHaveBeenCalled();
  });

  // Review Focus 1: a Privy that never becomes ready (blocked, offline) must not take every way of getting in with it.
  describe("when Privy never becomes ready", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("keeps Log in (disabled) for a few seconds, then offers the plain wallet list instead", async () => {
      privy.ready = false;
      await show();
      expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(PRIVY_PATIENCE_MS + 100));
      expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    });

    it("goes back to Log in the moment Privy does become ready", async () => {
      privy.ready = false;
      const view = await show();
      await act(() => vi.advanceTimersByTimeAsync(PRIVY_PATIENCE_MS + 100));
      expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
      privy.ready = true;
      view.rerender(<LoginButton />);
      expect(await screen.findByRole("button", { name: "Log in" })).toBeEnabled();
    });

    it("does not give up on a Privy that is ready, however long the page stays open", async () => {
      await show();
      await act(() => vi.advanceTimersByTimeAsync(PRIVY_PATIENCE_MS * 3));
      expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
    });
  });

  it("shows who is logged in and a Log out, once there is an address", async () => {
    privy.authenticated = true;
    await show(<LoginButton />, true);
    expect(await screen.findByText(/^0x0000…00a1$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("still offers Log out while the wallet address is not there yet", async () => {
    privy.authenticated = true;
    await show();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  // Review Focus 4: logging out ends BOTH sessions, ours first.
  it("ends our API session, and then Privy's", async () => {
    privy.authenticated = true;
    await show(<LoginButton />, true);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(order).toEqual(["api-logout", "privy-logout"]));
  });

  // Found by logging out for real: Privy let go, but wagmi still held the wallet, so the page went on showing it (and its Sell button).
  it("also lets go of the wallet in wagmi, so nothing on the page still thinks someone is connected", async () => {
    privy.authenticated = true;
    const wallet = await show(<LoginButton />, true);
    expect(wallet.config.state.status).toBe("connected");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(wallet.config.state.status).toBe("disconnected"));
  });

  it("lets go of the wallet even when both ends of the log out fail", async () => {
    privy.authenticated = true;
    privy.logout.mockRejectedValue(new Error("privy down"));
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    const wallet = await show(<LoginButton />, true);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(wallet.config.state.status).toBe("disconnected"));
  });

  it("logs out of Privy even when ending our session fails, so a person is never stuck logged in", async () => {
    privy.authenticated = true;
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    await show(<LoginButton />, true);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(privy.logout).toHaveBeenCalledTimes(1));
  });

  it("logs out once however fast it is clicked", async () => {
    privy.authenticated = true;
    await show(<LoginButton />, true);
    const button = await screen.findByRole("button", { name: "Log out" });
    const { fireEvent } = await import("@testing-library/react");
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(privy.logout).toHaveBeenCalled());
    expect(privy.logout).toHaveBeenCalledTimes(1);
  });
});

describe("WalletConnectButton's fallback connector", () => {
  // Privy's wagmi config carries no connectors of its own (it strips them and turns wallet discovery off), so when the plain list is
  // the emergency route it must bring its own way to reach the browser's wallet.
  it("lists the fallback wallet when the config has no connectors, and connects it", async () => {
    const { WalletConnectButton } = await import("./wallet-connect-button");
    const fallback = [{ name: "Browser wallet", connector: mock({ accounts: [TEST_USER] }) }];
    renderWithWallet(<WalletConnectButton fallback={fallback} />, []);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.queryByText(/No wallet found/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Browser wallet" }));
    expect(await screen.findByText(/^0x0000…00a1$/i)).toBeInTheDocument();
  });

  it("does not add the fallback when the config already has wallets to list", async () => {
    const { WalletConnectButton } = await import("./wallet-connect-button");
    const fallback = [{ name: "Browser wallet", connector: mock({ accounts: [TEST_USER] }) }];
    renderWithWallet(<WalletConnectButton fallback={fallback} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.queryByRole("button", { name: "Browser wallet" })).toBeNull();
    expect(screen.getByRole("button", { name: /mock/i })).toBeInTheDocument();
  });

  it("says there is no wallet when there is neither", async () => {
    const { WalletConnectButton } = await import("./wallet-connect-button");
    renderWithWallet(<WalletConnectButton fallback={[]} />, []);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByText(/No wallet found/)).toBeInTheDocument();
  });

  it("is what LoginButton offers once Privy has not come ready in time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      privy.ready = false;
      renderWithWallet(<LoginButton />, []); // a config with no connectors, as Privy's is
      await act(() => vi.advanceTimersByTimeAsync(PRIVY_PATIENCE_MS + 100));
      await userEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
      expect(screen.queryByText(/No wallet found/)).toBeNull(); // the fallback is what is listed
      expect(screen.getByRole("button", { name: "Browser wallet" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConnectButton with and without Privy", () => {
  it("is the wallet dialog, as ever, when Privy is not running", async () => {
    await show(<ConnectButton />);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("is Log in when Privy is running", async () => {
    await show(
      <PrivyActiveProvider value>
        <ConnectButton />
      </PrivyActiveProvider>,
    );
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
  });
});
