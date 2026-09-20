import { tokenAbi } from "@vezta/abi";
import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { createSessionWalletClient } from "./session-signer";
import type { SessionAccount } from "./types";

/** Withdrawal was refused before anything was sent. */
export class WithdrawError extends Error {
  constructor(readonly code: "wrong_destination") {
    super("Funds can only be withdrawn to the connected main wallet.");
    this.name = "WithdrawError";
  }
}

export interface WithdrawResult {
  /** How many tokens were sent. */
  tokens: number;
  /** ETH sent, in wei. */
  ethSent: bigint;
  /** What could not be sent. Never empty when something was left behind. */
  failed: { token: Address; reason: "transfer_failed" }[];
  /** Why ETH was not swept: a token could not be sent (so the gas is kept to try again), or the rest is too small to move. */
  ethKept?: "token_failures" | "dust";
}

const ETH_TRANSFER_GAS = 21_000n;

/**
 * Empties a session wallet into the main wallet: every token that has a balance, then the ETH. The ETH goes LAST, and
 * less what the transfer itself costs, because sending it first would leave nothing to pay the token transfers' gas and
 * strand the tokens. `candidateTokens` may be any list (an index, the browser's own memory, both); each balance is read
 * from the chain, so a token that holds nothing costs nothing and a token missing from the index is still found if it is
 * in the list. A token that cannot be sent is reported and skipped, and its failure keeps the ETH in place so there is gas
 * for a second try. The destination is checked to be the connected main wallet before anything is sent. Running it
 * again after it finished sends nothing.
 */
export async function withdrawAll({
  account,
  to,
  connectedMain,
  publicClient,
  candidateTokens,
}: {
  account: SessionAccount;
  to: Address;
  connectedMain: Address;
  publicClient: PublicClient;
  candidateTokens: readonly Address[];
}): Promise<WithdrawResult> {
  if (to === zeroAddress || to.toLowerCase() !== connectedMain.toLowerCase()) throw new WithdrawError("wrong_destination");

  const wallet = createSessionWalletClient(account, publicClient);
  const result: WithdrawResult = { tokens: 0, ethSent: 0n, failed: [] };

  const unique = [...new Map(candidateTokens.map((t) => [t.toLowerCase(), getAddress(t)])).values()];
  for (const token of unique) {
    let balance: bigint;
    try {
      balance = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
    } catch {
      result.failed.push({ token, reason: "transfer_failed" });
      continue;
    }
    if (balance === 0n) continue;
    try {
      const hash = await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "transfer", args: [to, balance], account, chain: null });
      await publicClient.waitForTransactionReceipt({ hash });
      result.tokens++;
    } catch {
      result.failed.push({ token, reason: "transfer_failed" });
    }
  }

  // A token that could not be sent must still be able to pay for another attempt.
  if (result.failed.length > 0) {
    result.ethKept = "token_failures";
    return result;
  }

  const balance = await publicClient.getBalance({ address: account.address });
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? (await publicClient.getGasPrice());
  const value = balance - ETH_TRANSFER_GAS * maxFeePerGas;
  if (value <= 0n) {
    if (balance > 0n) result.ethKept = "dust";
    return result;
  }
  const hash = await wallet.sendTransaction({
    to,
    value,
    gas: ETH_TRANSFER_GAS,
    maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? maxFeePerGas,
    account,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  result.ethSent = value;
  return result;
}
