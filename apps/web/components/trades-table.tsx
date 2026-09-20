import { chainBySlug, formatCompactTokens, formatQuote, UI } from "@vezta/shared";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/** An ISO date for a <time> element, or undefined: new Date(1e33).toISOString() throws, and one bad row must not take the page down. */
function isoOrUndefined(seconds: bigint): string | undefined {
  const ms = Number(seconds) * 1000;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : undefined;
}

/** The trade feed, newest first, in the order the API gave it. `now` is passed in so the same page always reads the same. */
export function TradesTable({ trades, chain, now }: { trades: Trade[]; chain: string; now: number }) {
  if (trades.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-muted-foreground">
        {UI.token.noTrades}
      </p>
    );
  }

  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{UI.token.columns.type}</TableHead>
          <TableHead className="text-right">{UI.token.columns.amount}</TableHead>
          <TableHead className="text-right">{UI.token.columns.value}</TableHead>
          <TableHead>{UI.token.columns.trader}</TableHead>
          <TableHead className="text-right">{UI.token.columns.time}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => {
          const explorer = explorerAddressUrl(config, trade.trader);
          return (
            <TableRow key={trade.id} data-testid="trade-row">
              <TableCell>
                <span className={cn("font-semibold", trade.isBuy ? "text-buy" : "text-sell")}>{trade.isBuy ? UI.token.side.buy : UI.token.side.sell}</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono">{formatCompactTokens(trade.tokenAmount)}</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono">{`${formatQuote(trade.quoteAmount, decimals, 6)} ${symbol}`}</span>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {explorer ? (
                  <a href={explorer} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {shortAddress(trade.trader)}
                  </a>
                ) : (
                  shortAddress(trade.trader)
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                <time dateTime={isoOrUndefined(trade.timestamp)}>{formatRelativeTime(trade.timestamp, now)}</time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
