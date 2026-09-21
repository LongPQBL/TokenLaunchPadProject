"use client";

import { useMemo } from "react";
import type { Address, LocalAccount, WalletClient } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { getDeployment } from "../deployment";
import { createSessionWalletClient } from "../session/session-signer";
import { useSession } from "../session/use-session";
import { useWalletKind } from "./wallet-kind";

export interface Signer {
  account: Address | undefined;
  /** Set for a wallet that signs in the browser (the trading wallet): pass it as the account, or the client would ask a node to sign. */
  localAccount: LocalAccount | undefined;
  walletClient: WalletClient | undefined;
  chainId: number | undefined;
}

/**
 * Who sends a one-off transaction (claiming fees, finishing a curve): the same wallet that trades. An external wallet's TRADING
 * wallet signs in the browser, for the app's chain; a wallet that signs by itself signs through its own client. Until the trading
 * wallet is open there is nobody: it is never the main wallet, which would ask for a confirmation the person did not expect.
 */
export function useSigner(): Signer {
  const kind = useWalletKind();
  const session = useSession();
  const { address, chainId } = useAccount();
  const { data: connectedClient } = useWalletClient();
  const deployment = getDeployment();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });
  const account = session.account;

  const sessionClient = useMemo(
    () => (kind === "external" && session.status === "ready" && account && publicClient ? createSessionWalletClient(account, publicClient as never) : undefined),
    [kind, session.status, account, publicClient],
  );

  if (kind === "external") {
    if (!sessionClient || !account) return { account: undefined, localAccount: undefined, walletClient: undefined, chainId: undefined };
    return { account: account.address, localAccount: account, walletClient: sessionClient as WalletClient, chainId: deployment?.chainId };
  }
  if (kind === "embedded") return { account: address, localAccount: undefined, walletClient: connectedClient, chainId };
  return { account: undefined, localAccount: undefined, walletClient: undefined, chainId: undefined };
}
