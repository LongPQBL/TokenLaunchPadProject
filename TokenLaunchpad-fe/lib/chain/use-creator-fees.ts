"use client";

import { launchpadAbi } from "@vezta/abi";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { getDeployment } from "../deployment";

/** What a creator has earned and not yet claimed, from the chain (never from our database). Undefined until it has been read. */
export function useCreatorFees(creator: Address | undefined) {
  const deployment = getDeployment();
  const result = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "creatorFees",
    args: creator && deployment ? [creator, deployment.weth] : undefined,
    chainId: deployment?.chainId,
    query: { enabled: !!deployment && !!creator, refetchInterval: 15_000 },
  });
  return { fees: result.data as bigint | undefined, refetch: result.refetch };
}
