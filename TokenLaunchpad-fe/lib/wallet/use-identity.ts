"use client";

import type { Address, Hex } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { useSession } from "../session/use-session";
import { useWalletKind } from "./wallet-kind";

export interface Identity {
  kind: "none" | "external" | "embedded";
  /** Who the person is in this app: the trading wallet. Undefined while there is none to be (not connected, or not open yet). */
  address: Address | undefined;
  /** The connected wallet the trading wallet is funded from (the same wallet, for one that signs by itself). */
  main: Address | undefined;
  status: "none" | "opening" | "ready" | "needs-signature" | "mismatch";
  /** Signs a message AS `address`: with the trading wallet's own key, so it asks for nothing. Undefined when there is no `address`. */
  signMessage: ((message: string) => Promise<Hex>) | undefined;
}

/**
 * Who the person is in the app. Everything that is "mine" (positions, orders, comments, stars, the profile, what pays for a trade)
 * is the TRADING wallet: the wallet that holds the tokens and signs by itself. For an external wallet (MetaMask, Phantom) that is
 * the wallet opened from it (see SessionProvider), and never the main wallet, which only funds it: until the trading wallet is open
 * there is no identity, not a fallback to the main wallet. A wallet that signs by itself (Google, email) is its own trading wallet.
 */
export function useIdentity(): Identity {
  const { address } = useAccount();
  const kind = useWalletKind();
  const session = useSession();
  const { signMessageAsync } = useSignMessage();

  if (kind === "none" || !address) return { kind: "none", address: undefined, main: undefined, status: "none", signMessage: undefined };
  if (kind === "embedded") {
    return { kind, address, main: address, status: "ready", signMessage: (message) => signMessageAsync({ message }) };
  }
  if (session.status === "ready" && session.account) {
    const account = session.account;
    return { kind, address: account.address, main: address, status: "ready", signMessage: (message) => account.signMessage({ message }) };
  }
  const status = session.status === "restoring" || session.status === "none" ? "opening" : session.status;
  return { kind, address: undefined, main: address, status, signMessage: undefined };
}
