"use client";

import { launchpadAbi } from "@vezta/abi";
import type { Address } from "viem";
import { useBlock, useReadContract } from "wagmi";
import { getDeployment } from "../deployment";
import { useCurve } from "./use-curve";

/**
 * The launch tax a buy pays right now, and how long until it is gone. The countdown is measured against the latest
 * BLOCK's timestamp, never the browser's clock: the contract charges by block time, and a browser whose clock is a
 * minute off would otherwise tell a person the window is over while the tax is still 90%.
 */
export function useLaunchTax(token: Address | undefined, { refetchMs = 2_000 }: { refetchMs?: number } = {}) {
  const deployment = getDeployment();
  const { curve } = useCurve(token);
  const tax = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "currentLaunchTaxBps",
    args: token ? [token] : undefined,
    chainId: deployment?.chainId,
    query: { enabled: !!deployment && !!token, refetchInterval: refetchMs },
  });
  const block = useBlock({ chainId: deployment?.chainId, query: { enabled: !!deployment, refetchInterval: refetchMs } });

  const endsAt = curve ? curve.launchTime + BigInt(curve.antiSniperWindow) : undefined;
  const now = block.data?.timestamp;
  return {
    bps: tax.data as bigint | undefined,
    endsAt,
    secondsLeft: endsAt !== undefined && now !== undefined ? Math.max(0, Number(endsAt - now)) : undefined,
  };
}
