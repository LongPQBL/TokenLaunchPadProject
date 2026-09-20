import { launchpadAbi } from "@vezta/abi";
import type { Address, Hash, PublicClient, WalletClient } from "viem";
import { TradeError } from "../wallet/types";

export interface MigrateDeps {
  launchpad: Address;
  /** The chain the app is deployed for. A wallet on any other chain is refused before it is asked anything. */
  expectedChainId: number;
  chainId: number | undefined;
  account: Address | undefined;
  walletClient: Pick<WalletClient, "writeContract"> | undefined;
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">;
}

/**
 * Finishes a curve that has filled, from the admin's own wallet. `migrate` is permissionless (the bot only makes it happen
 * sooner), so nothing about this needs the API or a special key: the person pays the gas, and if the bot or anyone else got
 * there first the transaction reverts and they are told so. A missing wallet or the wrong network is refused before the
 * wallet is asked to sign anything.
 */
export async function migrateToken(deps: MigrateDeps, token: Address): Promise<{ hash: Hash }> {
  if (!deps.account || !deps.walletClient) throw new TradeError("not_connected", "Connect a wallet first.");
  if (deps.chainId !== deps.expectedChainId) throw new TradeError("wrong_chain", "Switch your wallet to the right network.");
  const hash = await deps.walletClient.writeContract({
    address: deps.launchpad,
    abi: launchpadAbi,
    functionName: "migrate",
    args: [token],
    account: deps.account,
    chain: null,
  });
  const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TradeError("reverted", "The transaction was reverted.");
  return { hash };
}
