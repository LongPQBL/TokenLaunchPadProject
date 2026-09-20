"use client";

import { launchpadAbi } from "@vezta/abi";
import { previewSellLocal } from "@vezta/shared";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { getDeployment } from "../deployment";
import { useCurve } from "./use-curve";

/** The proceeds of selling `amount` tokens, from the local replica of the contract's maths. A sale is never taxed. */
export function useSellQuote({ token, amount }: { token: Address | undefined; amount: bigint }) {
  const deployment = getDeployment();
  const { curve, isLoading: curveLoading } = useCurve(token);
  const feeBps = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "tradeFeeBps",
    chainId: deployment?.chainId,
    query: { enabled: !!deployment, staleTime: Infinity },
  }).data;

  const quote = useMemo(
    () => (curve && feeBps !== undefined && amount > 0n ? previewSellLocal(curve, feeBps, amount) : { quoteOut: 0n, fee: 0n, payout: 0n }),
    [curve, feeBps, amount],
  );
  return { ...quote, isLoading: curveLoading || feeBps === undefined };
}
