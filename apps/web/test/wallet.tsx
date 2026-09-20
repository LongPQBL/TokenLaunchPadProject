import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { Transport } from "viem";
import { createConfig, http, WagmiProvider, type CreateConnectorFn } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";

export const TEST_USER = "0x00000000000000000000000000000000000000a1" as const;

export const TEST_DEPLOYMENT = JSON.stringify({
  chainId: sepolia.id,
  launchpad: "0x00000000000000000000000000000000000000c3",
  factory: "0x00000000000000000000000000000000000000d4",
  weth: "0x00000000000000000000000000000000000000e5",
});

/** A real wagmi config with a mock wallet, on two chains so a test can put the wallet on the wrong one. */
export function testWallet(connectors: CreateConnectorFn[] = [mock({ accounts: [TEST_USER] })], transport?: Transport) {
  const nowhere = http("http://127.0.0.1:1"); // nothing listens: a test that reaches for the network fails loudly
  const config = createConfig({
    chains: [sepolia, mainnet],
    connectors,
    // wagmi bundles reads into one multicall3 call by default; the fake chain answers each call itself.
    batch: { multicall: false },
    transports: { [sepolia.id]: transport ?? nowhere, [mainnet.id]: nowhere },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
  return { config, queryClient, wrapper };
}

export function renderWithWallet(ui: ReactElement, connectors?: CreateConnectorFn[], transport?: Transport) {
  const wallet = testWallet(connectors, transport);
  return { ...render(ui, { wrapper: wallet.wrapper }), ...wallet };
}
