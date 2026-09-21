"use client";

import { formatQuoteApprox, formatUsdValue, UI } from "@vezta/shared";
import { useHasChain } from "@/lib/chain/use-has-chain";
import { roundQuote } from "@/lib/format";
import { useUsdRate } from "@/lib/chain/use-usd-rate";

function Line({ collected, target, decimals, symbol, dollars }: { collected: bigint; target: bigint; decimals: number; symbol: string; dollars: ((raw: bigint) => string) | undefined }) {
  const text = dollars
    ? `${dollars(collected)} / ${dollars(target)} collected`
    : UI.token.collected(formatQuoteApprox(collected, decimals, 4), formatQuoteApprox(target, decimals, 4), symbol);
  return <p className="mt-1 font-mono text-xs text-muted-foreground">{text}</p>;
}

function PricedLine(props: { chain: string; collected: bigint; target: bigint; decimals: number; symbol: string }) {
  const rate = useUsdRate(props.chain);
  // Rounded to the nearest first: the target is worked out from the reserves and is a wei or two off a round number, which cut down
  // to cents would read as a cent short ($149.99).
  return <Line {...props} dollars={rate ? (raw) => formatUsdValue(roundQuote(raw, props.decimals, 6), rate, props.decimals) : undefined} />;
}

/** "$15.71 / $150.00 collected" once the chain's price feed says what a dollar is, and "0.0052 / 0.05 ETH collected" until then. */
export function CollectedLine(props: { chain: string; collected: bigint; target: bigint; decimals: number; symbol: string }) {
  return useHasChain() ? <PricedLine {...props} /> : <Line {...props} dollars={undefined} />;
}
