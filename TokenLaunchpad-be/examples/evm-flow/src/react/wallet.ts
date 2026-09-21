// Wallet connection with Reown AppKit on top of wagmi. Put this in a client module and import `wagmiConfig` into the
// WagmiProvider. Only NEXT_PUBLIC_* values that are safe to publish may be used here (a project id and public RPCs).
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia, sepolia } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
export const networks = [sepolia, baseSepolia] as [typeof sepolia, typeof baseSepolia];

export const wagmiAdapter = new WagmiAdapter({ networks, projectId, ssr: true });

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: { name: "Vezta Launchpad", description: "Launch and trade tokens", url: "https://launchpad.example.com", icons: [] },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
