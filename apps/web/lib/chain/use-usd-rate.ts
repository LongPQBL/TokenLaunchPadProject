"use client";

import { chainBySlug, type UsdRate } from "@vezta/shared";
import { useMemo } from "react";
import { parseAbi } from "viem";
import { useReadContract } from "wagmi";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/** A price older than this is not shown: every dollar amount on the page would be built on it. Chainlink feeds update far more often. */
export const MAX_FEED_AGE_SECONDS = 24 * 3600;

/**
 * What one ETH is worth in dollars, read on chain from the chain's Chainlink feed, so no outside service is trusted and none is
 * called. Undefined while it is being asked, when the chain has no feed, when the feed does not answer, when it says zero or a
 * negative price, and when its last update is more than a day old: the page then shows amounts in ETH only, and never a dollar
 * figure it cannot stand behind. Asked again every minute while the page is open.
 */
export function useUsdRate(chain: string): UsdRate | undefined {
  const config = chainBySlug(chain);
  const feed = config?.usdFeed;
  const chainId = config?.chainId;
  const enabled = !!feed;
  const round = useReadContract({ address: feed, abi: feedAbi, functionName: "latestRoundData", chainId, query: { enabled, staleTime: 60_000, refetchInterval: 60_000, retry: false } });
  const decimals = useReadContract({ address: feed, abi: feedAbi, functionName: "decimals", chainId, query: { enabled, staleTime: Infinity, retry: false } });

  const answer = round.data?.[1];
  const updatedAt = round.data?.[3];
  const feedDecimals = decimals.data;
  return useMemo(() => {
    if (answer === undefined || updatedAt === undefined || feedDecimals === undefined) return undefined;
    if (answer <= 0n) return undefined;
    if (Date.now() / 1000 - Number(updatedAt) > MAX_FEED_AGE_SECONDS) return undefined;
    return { answer, decimals: feedDecimals };
  }, [answer, updatedAt, feedDecimals]);
}
