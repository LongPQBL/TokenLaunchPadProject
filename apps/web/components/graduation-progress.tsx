import { collectedQuote, graduationAmountFromReserves, UI } from "@vezta/shared";
import { formatPercentBps } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";
import { CollectedLine } from "./collected-line";

/**
 * How close the curve is to graduating: a bar from the indexer's progress, and "collected / target" in the quote
 * currency (in dollars when the chain has a price feed). The target is not stored anywhere; it is worked out from the reserves (see graduationAmountFromReserves),
 * so it is a wei or two off a round number and is shown rounded, not truncated.
 */
export function GraduationProgress({ chain, token, decimals, symbol }: { chain?: string; token: TokenDetail; decimals: number; symbol: string }) {
  const bps = Math.min(Math.max(token.progressBps, 0), 10_000);
  const collected = collectedQuote(token.virtualQuoteReserves, token.virtualTokenReserves);
  const target = graduationAmountFromReserves(token.virtualQuoteReserves, token.virtualTokenReserves);

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{UI.token.progress}</span>
        <span className="font-mono">{formatPercentBps(token.progressBps)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={UI.token.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bps / 100)}
        className="h-2 bg-secondary"
      >
        <div className="h-full bg-primary" style={{ width: `${bps / 100}%` }} />
      </div>
      <CollectedLine chain={chain ?? ""} collected={collected} target={target} decimals={decimals} symbol={symbol} />
    </section>
  );
}
