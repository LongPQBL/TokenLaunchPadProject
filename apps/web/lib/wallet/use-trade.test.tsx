import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { connect } from "wagmi/actions";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { createConfig, http } from "wagmi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrade } from "./use-trade";

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

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

describe("useTrade", () => {
  it("with no wallet connected: no address, and a trade rejects not_connected", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    expect(result.current.capabilities.address).toBeUndefined();
    expect(result.current.capabilities.kind).toBe("self-custody");
    await expect(result.current.buyWithEth({ token: TOKEN, amount: 1n, maxQuoteCost: 2n })).rejects.toMatchObject({ code: "not_connected" });
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

  it("when the build has no deployment: every trade rejects not_configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", "");
    const { wrapper } = harness();
    const { result } = renderHook(() => useTrade(), { wrapper });
    await expect(result.current.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 1n })).rejects.toMatchObject({ code: "not_configured" });
  });
});
