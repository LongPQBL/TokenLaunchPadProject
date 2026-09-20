import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
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
export function testWallet(connectors: CreateConnectorFn[] = [mock({ accounts: [TEST_USER] })]) {
  const config = createConfig({
    chains: [sepolia, mainnet],
    connectors,
    transports: { [sepolia.id]: http("http://127.0.0.1:1"), [mainnet.id]: http("http://127.0.0.1:1") },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
  return { config, queryClient, wrapper };
}

export function renderWithWallet(ui: ReactElement, connectors?: CreateConnectorFn[]) {
  const wallet = testWallet(connectors);
  return { ...render(ui, { wrapper: wallet.wrapper }), ...wallet };
}
