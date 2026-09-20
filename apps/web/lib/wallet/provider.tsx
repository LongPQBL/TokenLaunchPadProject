"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDeployment } from "../deployment";
import { createWagmiConfig } from "./config";

/**
 * Wallet and query state for everything under it. The config is built once per browser session. A build with no
 * deployment still gets the wallet layer (every wagmi hook needs it), on the default chain; useTrade then reports
 * trading as not configured rather than the page crashing.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [state] = useState(() => {
    const deployment = getDeployment();
    const config: Config = createWagmiConfig({
      chainId: deployment?.chainId ?? sepolia.id,
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    });
    return { config, queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }) };
  });

  return (
    <QueryClientProvider client={state.queryClient}>
      <WagmiProvider config={state.config} reconnectOnMount>
        {children}
      </WagmiProvider>
    </QueryClientProvider>
  );
}
