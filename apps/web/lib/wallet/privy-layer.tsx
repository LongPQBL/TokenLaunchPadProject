"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createConfig as createPrivyWagmiConfig, WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDeployment } from "../deployment";
import { SessionProvider } from "../session/use-session";
import { privyConfig } from "./privy";
import { PrivyActiveProvider } from "./privy-context";

/** The same, plus Privy: email and Google logins (an embedded wallet), and the person's own wallets through the same modal. */
export default function WithPrivy({ appId, children }: { appId: string; children: ReactNode }) {
  const [state] = useState(() => {
    const chainId = getDeployment()?.chainId ?? sepolia.id;
    const config = createPrivyWagmiConfig({ chains: [sepolia], transports: { [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL) } });
    return { chainId, config, queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }) };
  });

  return (
    <PrivyProvider appId={appId} config={privyConfig(state.chainId)}>
      <QueryClientProvider client={state.queryClient}>
        <PrivyWagmiProvider config={state.config} reconnectOnMount>
          <SessionProvider>
            <PrivyActiveProvider value>{children}</PrivyActiveProvider>
          </SessionProvider>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
