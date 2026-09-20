import { formatCompactTokens, formatQuote, UI } from "@vezta/shared";

interface Props {
  quoteCost: bigint;
  baseFee: bigint;
  launchTax: bigint;
  total: bigint;
  amount: bigint;
  ticker: string;
  symbol: string;
  decimals: number;
}

/**
 * Where the money goes, line by line, so nothing in the total is a surprise. The launch tax is its own line and only
 * appears while it is being charged.
 */
export function CostBreakdown({ quoteCost, baseFee, launchTax, total, amount, ticker, symbol, decimals }: Props) {
  const money = (n: bigint) => `${formatQuote(n, decimals, 6)} ${symbol}`;
  return (
    <dl data-testid="cost-breakdown" className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-sm">
      <dt className="text-muted-foreground">{UI.trade.breakdown.price}</dt>
      <dd className="text-right">{formatQuote(quoteCost, decimals, 6)}</dd>
      <dt className="text-muted-foreground">{UI.trade.breakdown.fee}</dt>
      <dd className="text-right">{formatQuote(baseFee, decimals, 6)}</dd>
      {launchTax > 0n && (
        <>
          <dt className="text-warning">{UI.trade.breakdown.launchTax}</dt>
          <dd className="text-right text-warning">{formatQuote(launchTax, decimals, 6)}</dd>
        </>
      )}
      <dt className="border-t border-border pt-1 font-semibold">{UI.trade.breakdown.total}</dt>
      <dd className="border-t border-border pt-1 text-right font-semibold" title={money(total)}>
        {formatQuote(total, decimals, 6)}
      </dd>
      <dt className="text-muted-foreground">{UI.trade.breakdown.youReceive}</dt>
      <dd className="text-right">{`≈ ${formatCompactTokens(amount)} ${ticker}`}</dd>
    </dl>
  );
}
