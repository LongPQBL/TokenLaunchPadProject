import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { connect } from "wagmi/actions";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { createConfig, http } from "wagmi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embeddedId } from "../../test/wallet";
import { useTrade } from "./use-trade";
import { privateKeyToAccount } from "viem/accounts";

// Which signer the person has chosen is the session provider's business; here it is simply set.
const session = vi.hoisted(() => ({ value: { status: "off", account: undefined } as { status: string; account?: unknown } }));
vi.mock("../session/use-session", () => ({ useSession: () => ({ ...session.value, enable: async () => false, disable: () => {} }) }));

const USER = "0x00000000000000000000000000000000000000a1" as const;
const TOKEN = "0x00000000000000000000000000000000000000b2" as const;
const DEPLOYMENT = JSON.stringify({
  chainId: sepolia.id,
  launchpad: "0x00000000000000000000000000000000000000c3",
  factory: "0x00000000000000000000000000000000000000d4",
  weth: "0x00000000000000000000000000000000000000e5",
});

// A wallet that lives on two chains, so a test can put it on the wrong one. Nothing here touches a network: the
// guards under test refuse before any call is made.
function harness() {
  const connector = mock({ accounts: [USER] });
  const config = createConfig({
    chains: [sepolia, mainnet],
    connectors: [connector],
    transports: { [sepolia.id]: http("http://127.0.0.1:1"), [mainnet.id]: http("http://127.0.0.1:1") },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
  return { config, connector, wrapper };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", DEPLOYMENT);
  session.value = { status: "off", account: undefined };
});
afterEach(() => vi.unstubAllEnvs());

describe("useTrade", () => {
  it("with no wallet connected: no address, and a trade rejects not_connected", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    expect(result.current.capabilities.address).toBeUndefined();
    expect(result.current.capabilities.kind).toBe("self-custody");
    await expect(result.current.buyWithEth({ token: TOKEN, amount: 1n, maxQuoteCost: 2n })).rejects.toMatchObject({
      code: "not_connected",
    });
  });

  it("with a wallet on the right chain: exposes the address and the chain", async () => {
    const { config, connector, wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.capabilities.address?.toLowerCase()).toBe(USER)); // wagmi hands back the checksummed form
    expect(result.current.capabilities.chainId).toBe(sepolia.id);
  });

  it("with a wallet on the wrong chain: rejects wrong_chain without opening the wallet", async () => {
    const { config, connector, wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: mainnet.id }));
    await waitFor(() => expect(result.current.capabilities.chainId).toBe(mainnet.id));
    await expect(result.current.buyWithEth({ token: TOKEN, amount: 1n, maxQuoteCost: 2n })).rejects.toMatchObject({ code: "wrong_chain" });
  });

  it("a wallet that cannot report its capabilities is not assumed to batch: the two-step path is the safe default", async () => {
    const { config, connector, wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.capabilities.address).toBeDefined());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.capabilities.canBatch).toBe(false);
  });

  it("with the session wallet ready, trades as the session wallet and says so", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    session.value = { status: "ready", account };
    const { config, connector, wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.capabilities.kind).toBe("session"));
    expect(result.current.capabilities).toMatchObject({ address: account.address, isZeroPrompt: true });
  });

  it("with the session wallet turned on but not available, refuses to trade rather than falling back to the main wallet", async () => {
    for (const status of ["restoring", "needs-signature", "mismatch"]) {
      session.value = { status, account: undefined };
      const { config, connector, wrapper } = harness();
      const { result, unmount } = renderHook(() => useTrade(), { wrapper });
      await act(() => connect(config, { connector, chainId: sepolia.id }));
      expect(result.current.capabilities.kind, status).toBe("session");
      expect(result.current.capabilities.address, status).toBeUndefined();
      await expect(result.current.buyWithEth({ token: TOKEN, amount: 1n, maxQuoteCost: 2n }), status).rejects.toMatchObject({
        code: "no_session",
      });
      await expect(result.current.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 1n }), status).rejects.toMatchObject({
        code: "no_session",
      });
      unmount();
    }
  });

  it("when the build has no deployment: every trade rejects not_configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", "");
    const { wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await expect(result.current.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 1n })).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("useTrade with an embedded wallet", () => {
  beforeEach(() => localStorage.clear()); // wagmi keeps the connection there, and would carry it into the next test
  /** A wallet that announces itself as Privy's embedded wallet, and hands out the provider it would sign with. */
  function embeddedHarness(id = embeddedId(USER)) {
    // Wraps the mock wallet's own provider, so connecting and reading work as they do, and records what it is asked.
    const asked: string[] = [];
    const provider = { request: vi.fn() };
    const base = mock({ accounts: [USER] });
    const connector = (cfg: Parameters<typeof base>[0]) => {
      const inner = base(cfg);
      return {
        ...inner,
        id,
        getProvider: async (p?: unknown) => {
          const real = (await inner.getProvider(p as never)) as {
            request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
          return {
            ...real,
            request: async (a: { method: string; params?: unknown[] }) => {
              asked.push(a.method);
              provider.request(a);
              return real.request(a);
            },
          };
        },
      };
    };
    const config = createConfig({
      chains: [sepolia, mainnet],
      connectors: [connector],
      transports: { [sepolia.id]: http("http://127.0.0.1:1"), [mainnet.id]: http("http://127.0.0.1:1") },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WagmiProvider config={config}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
    return { config, connector: config.connectors[0]!, wrapper, provider, asked };
  }

  it("trades as the embedded signer: no prompt, no batching, the connected address", async () => {
    const { config, connector, wrapper } = embeddedHarness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.capabilities.kind).toBe("embedded"));
    expect(result.current.capabilities).toMatchObject({ isZeroPrompt: true, canBatch: false, chainId: sepolia.id });
    expect(result.current.capabilities.address?.toLowerCase()).toBe(USER);
  });

  // Review Focus 2: an embedded user has one wallet. A session that exists or is half-open changes nothing for them.
  // (Each pass builds a new wagmi config over the same storage, so it also covers a page load, when wagmi restores the connector as a
  // bare record with no methods until it has reconnected: the guard in useTrade keeps that from crashing.)
  it("never uses a trading wallet for an embedded wallet, whatever the session says", async () => {
    for (const status of ["ready", "needs-signature", "restoring", "mismatch"]) {
      session.value = { status, account: status === "ready" ? privateKeyToAccount(`0x${"11".repeat(32)}`) : undefined };
      const { config, connector, wrapper } = embeddedHarness();
      const { result, unmount } = renderHook(() => useTrade(), { wrapper });
      await act(() => connect(config, { connector, chainId: sepolia.id }));
      await waitFor(() => expect(result.current.capabilities.kind, status).toBe("embedded"));
      unmount();
    }
  });

  it("refuses to trade from the wrong chain without signing anything", async () => {
    const { config, connector, wrapper, asked } = embeddedHarness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: mainnet.id }));
    await waitFor(() => expect(result.current.capabilities.chainId).toBe(mainnet.id));
    await expect(result.current.buyWithEth({ token: TOKEN, amount: 1n, maxQuoteCost: 2n })).rejects.toMatchObject({ code: "wrong_chain" });
    expect(asked.filter((m) => m === "eth_signTransaction")).toEqual([]);
  });

  it("treats a wallet with a look-alike id as an ordinary wallet", async () => {
    const { config, connector, wrapper } = embeddedHarness("io.privy.wallet.evil");
    const { result } = renderHook(() => useTrade(), { wrapper });
    await act(() => connect(config, { connector, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.capabilities.address?.toLowerCase()).toBe(USER));
    expect(result.current.capabilities.kind).toBe("self-custody");
  });
});
