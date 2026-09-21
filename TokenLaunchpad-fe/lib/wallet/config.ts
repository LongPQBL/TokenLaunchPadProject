import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

// The chains the app can be deployed on, by chain id. Adding one is an entry here plus a chains.ts entry in shared.
const CHAINS = { [sepolia.id]: sepolia } as const;

export interface WagmiOptions {
  chainId: number;
  /** Where reads go. Without it viem's public default for the chain is used, which is fine for a demo only. */
  rpcUrl?: string;
  /** WalletConnect (phones, desktop wallets without an extension). Absent means the option is not offered. */
  walletConnectProjectId?: string;
  /** Replaces the default connectors. Tests bring a mock wallet this way. */
  connectors?: CreateConnectorFn[];
}

/**
 * One chain, EIP-6963 wallet discovery (every installed wallet announces itself, so there is no "which one is
 * window.ethereum" fight), and WalletConnect only when it has been set up.
 */
export function createWagmiConfig({ chainId, rpcUrl, walletConnectProjectId, connectors }: WagmiOptions) {
  const chain = (CHAINS as Record<number, (typeof CHAINS)[keyof typeof CHAINS]>)[chainId];
  if (!chain) throw new Error(`No wallet configuration for chain ${chainId}`);
  return createConfig({
    chains: [chain],
    connectors: connectors ?? [injected(), ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : [])],
    transports: { [chain.id]: http(rpcUrl) } as Record<number, ReturnType<typeof http>>,
    multiInjectedProviderDiscovery: true,
    ssr: true,
  });
}
