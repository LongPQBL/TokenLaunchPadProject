"use client";

import { tokenAbi } from "@vezta/abi";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useIdentity } from "../wallet/use-identity";
import { getDeployment } from "../deployment";

/**
 * An account's balance of a token, and how much of it the launchpad may already take. From the chain. `owner` is the
 * account that TRADES: the trading wallet when one is in use, whose balance and approval are its own and not the main
 * wallet's. It defaults to the connected wallet.
 */
export function useTokenAccount(token: Address | undefined, owner?: Address) {
  const deployment = getDeployment();
  const connected = useIdentity().address;
  const address = owner ?? connected;
  const enabled = !!deployment && !!token && !!address;
  const common = { address: token, abi: tokenAbi, chainId: deployment?.chainId } as const;

  const balance = useReadContract({ ...common, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled, refetchInterval: 5_000 } });
  const allowance = useReadContract({
    ...common,
    functionName: "allowance",
    args: address && deployment ? [address, deployment.launchpad] : undefined,
    query: { enabled, refetchInterval: 5_000 },
  });
  return { balance: balance.data, allowance: allowance.data, isLoading: balance.isLoading || allowance.isLoading };
}
