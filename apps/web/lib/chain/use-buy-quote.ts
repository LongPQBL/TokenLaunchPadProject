"use client";

import { launchpadAbi } from "@vezta/abi";
import { previewBuyLocal } from "@vezta/shared";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { getDeployment } from "../deployment";
import { errorName } from "../tx/errors";
import { useDebounced } from "../use-debounced";
import { computeBuyQuote, type BuyQuote } from "./buy-quote";
import { useCurve } from "./use-curve";
import { useLaunchTax } from "./use-launch-tax";

const NOTHING: BuyQuote = { amount: 0n, quoteCost: 0n, baseFee: 0n, launchTax: 0n, total: 0n, taxMultiplier: 1 };
const differs = (a: bigint, b: bigint) => (a > b ? a - b : b - a) > 1n;

/**
 * The price of "spend this much", updated on every keystroke from the local replica of the contract's maths, then
 * checked against the contract's own previewBuy once typing pauses. Disagreement is `isStale`: someone else traded, and
 * the person should not trust the figure without a refresh.
 *
 * Once the curve has completed there is nothing to buy: the hook stops quoting and says `curveCompleted`, whether the
 * curve read noticed first or previewBuy reverted with CurveCompleted, so the panel can show GRADUATING instead of a
 * revert.
 */
export function useBuyQuote({ token, budget, debounceMs = 300 }: { token: Address | undefined; budget: bigint; debounceMs?: number }) {
  const deployment = getDeployment();
  const { curve, isLoading: curveLoading } = useCurve(token);
  const { bps: taxBps } = useLaunchTax(token);
  const feeBps = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "tradeFeeBps",
    chainId: deployment?.chainId,
    query: { enabled: !!deployment, staleTime: Infinity },
  }).data;

  const curveDone = curve?.complete ?? false;
  const ready = !!curve && feeBps !== undefined && taxBps !== undefined && !curveDone;

  const quote = useMemo(
    () => (ready ? computeBuyQuote(curve, feeBps, taxBps, budget) : NOTHING),
    [ready, curve, feeBps, taxBps, budget],
  );

  // Only what the person has stopped typing is worth an RPC call.
  const settled = useDebounced(quote.amount, debounceMs);
  const preview = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "previewBuy",
    args: token ? [token, settled] : undefined,
    chainId: deployment?.chainId,
    query: { enabled: ready && settled > 0n, retry: false },
  });

  const curveCompleted = curveDone || errorName(preview.error) === "CurveCompleted";

  let isStale = false;
  if (ready && preview.data && settled > 0n) {
    const [amountOut, quoteCost, fee] = preview.data;
    const local = previewBuyLocal(curve, { feeBps, taxBps }, settled);
    // The tax changes every second, so a fee that differs while it is active is expected, not staleness.
    isStale = differs(amountOut, local.amountOut) || differs(quoteCost, local.quoteCost) || (taxBps === 0n && differs(fee, local.fee));
  }

  return {
    ...(curveCompleted ? NOTHING : quote),
    /** The tax rate the quote assumed, in bps, so the panel can decide whether to ask for a confirmation. */
    taxBps,
    isStale,
    curveCompleted,
    isLoading: curveLoading || (!ready && !curveDone),
  };
}
