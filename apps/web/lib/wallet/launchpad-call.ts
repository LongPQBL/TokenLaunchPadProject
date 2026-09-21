import { launchpadAbi } from "@vezta/abi";
import type { Address, Hash, PublicClient, WalletClient } from "viem";
import { TradeError } from "./types";

export interface LaunchpadCallDeps {
  launchpad: Address;
  /** The chain the app is deployed for. A wallet on any other chain is refused before it is asked anything. */
  expectedChainId: number;
  chainId: number | undefined;
  account: Address | undefined;
  walletClient: Pick<WalletClient, "writeContract"> | undefined;
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">;
}

/**
 * Sends one call to the launchpad from the connected wallet and waits for it. The guards run first, so a wallet that is
 * missing or on the wrong network is never asked to sign. A mined-but-reverted transaction is an error, not a success. A
 * refusal in the wallet passes through untouched, for the caller to treat as a person's choice.
 */
export async function callLaunchpad(
  deps: LaunchpadCallDeps,
  functionName: "migrate" | "claimCreatorFees",
  args: readonly Address[],
): Promise<{ hash: Hash }> {
  if (!deps.account || !deps.walletClient) throw new TradeError("not_connected", "Connect a wallet first.");
  if (deps.chainId !== deps.expectedChainId) throw new TradeError("wrong_chain", "Switch your wallet to the right network.");
  const hash = await deps.walletClient.writeContract({
    address: deps.launchpad,
    abi: launchpadAbi,
    functionName,
    args: args as never,
    account: deps.account,
    chain: null,
  });
  const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TradeError("reverted", "The transaction was reverted.");
  return { hash };
}
