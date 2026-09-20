"use client";

import { launchpadAbi } from "@vezta/abi";
import { curveStatus, progressBps, spotPrice, type Curve } from "@vezta/shared";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { getDeployment } from "../deployment";

/**
 * A token's curve, straight from the chain (never the indexer: the indexer is a few seconds behind and a price is
 * money). Refetched every 5 s, and by whoever invalidates the query after the person's own transaction lands.
 */
export function useCurve(token: Address | undefined, { refetchMs = 5_000 }: { refetchMs?: number } = {}) {
  const deployment = getDeployment();
  const query = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "getCurve",
    args: token ? [token] : undefined,
    chainId: deployment?.chainId,
    query: { enabled: !!deployment && !!token, refetchInterval: refetchMs },
  });
  const curve = query.data as Curve | undefined;
  return {
    curve,
    status: curve && curveStatus(curve),
    progressBps: curve && progressBps(curve),
    spotPrice: curve && spotPrice(curve.virtualQuoteReserves, curve.virtualTokenReserves),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
