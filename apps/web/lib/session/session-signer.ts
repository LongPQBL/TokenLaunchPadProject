import type { Address, PublicClient } from "viem";
import { createWalletClient, custom } from "viem";
import { createSelfCustody } from "../wallet/self-custody";
import type { UseTrade } from "../wallet/types";
import type { SessionAccount } from "./types";

/**
 * Trading from the session wallet: exactly the seam the person's own wallet uses, over a LOCAL key. The wallet client
 * signs in the browser and hands the node a finished raw transaction; nothing is ever sent to the main wallet, so
 * there is nothing to confirm. It is the same code path as buying with a wallet, which is why the whole trade suite runs
 * against both.
 */
export function createSessionTrade({
  account,
  deployment,
  publicClient,
}: {
  account: SessionAccount;
  deployment: { launchpad: Address; factory: Address; weth: Address };
  publicClient: PublicClient;
}): UseTrade {
  const chain = publicClient.chain;
  if (!chain) throw new Error("the public client has no chain");
  // Sends through the same transport the app already reads with, so there is one place the RPC is configured.
  const walletClient = createWalletClient({ account, chain, transport: custom({ request: publicClient.request as never }) });

  return createSelfCustody({
    kind: "session",
    deployment,
    expectedChainId: chain.id,
    account: account.address,
    signer: account,
    chainId: chain.id, // the session client is built for the app's chain: it cannot be on another one
    walletClient,
    publicClient,
    canBatch: false,
  });
}
