import { collectedQuote, formatQuote, graduationAmountFromReserves, UI } from "@vezta/shared";
import { formatPercentBps } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";

/**
 * How close the curve is to graduating: a bar from the indexer's progress, and "collected / target" in the quote
 * currency. The target is not stored anywhere; it is worked out from the reserves (see graduationAmountFromReserves).
 */
export function GraduationProgress({ token, decimals, symbol }: { token: TokenDetail; decimals: number; symbol: string }) {
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
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {UI.token.collected(formatQuote(collected, decimals, 4), formatQuote(target, decimals, 4), symbol)}
      </p>
    </section>
  );
}
