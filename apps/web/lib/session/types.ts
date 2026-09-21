import type { PrivateKeyAccount } from "viem/accounts";

/** The wallet a person trades from without prompts. It is an ordinary local account: it signs in the browser. */
export type SessionAccount = PrivateKeyAccount;

/** Signs a message with the person's MAIN wallet. Supplied by the caller (wagmi), so this module never touches a connector. */
export type SignWithMainWallet = (message: string) => Promise<`0x${string}`>;
