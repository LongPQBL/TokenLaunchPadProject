"use client";

import { tokenAbi } from "@vezta/abi";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { getDeployment } from "../deployment";

/** The connected person's balance of a token, and how much of it the launchpad may already take. From the chain. */
export function useTokenAccount(token: Address | undefined) {
  const deployment = getDeployment();
  const { address } = useAccount();
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
