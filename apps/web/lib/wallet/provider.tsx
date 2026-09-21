"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDeployment } from "../deployment";
import { SessionProvider } from "../session/use-session";
import { createWagmiConfig } from "./config";
import { privyAppId } from "./privy";
import { PrivyBoundary } from "./privy-boundary";

// Loaded only when there is an App ID: the Privy libraries are large, and a build without them must not carry or load them.
const WithPrivy = lazy(() => import("./privy-layer"));

const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

/** The wallet layer every build has: the person's own wallets, discovered from the browser. */
function Plain({ children }: { children: ReactNode }) {
  const [state] = useState(() => {
    const deployment = getDeployment();
    const config: Config = createWagmiConfig({
      chainId: deployment?.chainId ?? sepolia.id,
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    });
    return { config, queryClient: newQueryClient() };
  });

  return (
    <QueryClientProvider client={state.queryClient}>
      <WagmiProvider config={state.config} reconnectOnMount>
        <SessionProvider>{children}</SessionProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

/**
 * Wallet and query state for everything under it. Privy is an optional layer: without an App ID this is exactly the plain
 * wallet layer, and if Privy cannot start the app falls back to that layer instead of failing. A build with no deployment
 * still gets the wallet layer (every wagmi hook needs it), on the default chain; useTrade then reports trading as not
 * configured rather than the page crashing.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const appId = privyAppId();
  if (!appId) return <Plain>{children}</Plain>;
  return (
    <PrivyBoundary fallback={<Plain>{children}</Plain>}>
      {/* Nothing can render before the wallet layer exists (every wagmi hook needs it), so nothing is shown while it loads. */}
      <Suspense fallback={null}>
        <WithPrivy appId={appId}>{children}</WithPrivy>
      </Suspense>
    </PrivyBoundary>
  );
}
