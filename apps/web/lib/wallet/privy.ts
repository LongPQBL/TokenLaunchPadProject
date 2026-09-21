import type { PrivyClientConfig } from "@privy-io/react-auth";
import { sepolia } from "viem/chains";

/** The App ID is public (it ships in the page by design); an empty or missing one means Privy is not part of this build. */
export const privyAppId = (raw: string | undefined = process.env.NEXT_PUBLIC_PRIVY_APP_ID): string | undefined => raw?.trim() || undefined;

export const PRIVY_LOGIN_METHODS = ["email", "google", "wallet"] as const;
const CHAINS = { [sepolia.id]: sepolia } as const;

/**
 * What Privy is asked for. `showWalletUIs: false` is the setting that makes the embedded wallet sign with no confirmation
 * screen: it is the whole point of this path, and it is what the spike verified. Nothing here delegates signing to a server.
 */
export function privyConfig(chainId: number): PrivyClientConfig {
  const chain = (CHAINS as Record<number, (typeof CHAINS)[keyof typeof CHAINS]>)[chainId];
  if (!chain) throw new Error(`No Privy configuration for chain ${chainId}`);
  return {
    loginMethods: [...PRIVY_LOGIN_METHODS],
    // What the first screen of the login shows, in this order: the four ways in that people look for. Without it wallets sit behind one
    // "Continue with a wallet" button. (This is the only setting that orders them; it takes precedence over `loginMethods`, which stays
    // as the statement of what is allowed.) Any other wallet in the browser is one screen further.
    loginMethodsAndOrder: { primary: ["email", "google", "metamask", "phantom"], overflow: ["detected_ethereum_wallets"] },
    appearance: { walletList: ["metamask", "phantom", "detected_ethereum_wallets"] },
    embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
    defaultChain: chain,
    supportedChains: [chain],
  };
}
