import { chainBySlug, formatCompactTokens, formatQuote, formatTokenPrice, UI } from "@vezta/shared";
import Link from "next/link";
import { explorerTxUrl } from "@/lib/explorer";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import type { Order } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/** An ISO date for a <time> element, or undefined: new Date(1e33).toISOString() throws, and one bad row must not take the page down. */
function isoOrUndefined(seconds: bigint): string | undefined {
  const ms = Number(seconds) * 1000;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : undefined;
}

/**
 * Every order a wallet made, newest first as the API sent them. The total is what was really paid (a buy: the price plus the fee)
 * or received (a sell: the price less the fee). `now` is passed in so the same page always reads the same. The token's name is a
 * stranger's text, drawn as text; the transaction links to the explorer only if the hash is a real one.
 */
export function OrdersTable({ chain, orders, now }: { chain: string; orders: Order[]; now: number }) {
  if (orders.length === 0) {
    return (
      <p role="status" className="py-16 text-center text-muted-foreground">
        {UI.positions.emptyOrders}
      </p>
    );
  }
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";
  const c = UI.positions.columns;

  return (
    <div className="overflow-x-auto border border-border">
      <Table className="min-w-[44rem] whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>{c.time}</TableHead>
            <TableHead>{c.token}</TableHead>
            <TableHead>{c.type}</TableHead>
            <TableHead className="text-right">{c.total}</TableHead>
            <TableHead className="text-right">{c.amount}</TableHead>
            <TableHead className="text-right">{c.price}</TableHead>
            <TableHead className="text-right">{c.tx}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => {
            const title = o.token.name ?? o.token.ticker ?? shortAddress(o.token.address);
            const tx = explorerTxUrl(config, o.txHash);
            return (
              <TableRow key={o.id} data-testid="order-row">
                <TableCell className="font-mono text-xs text-muted-foreground">
                  <time dateTime={isoOrUndefined(o.timestamp)}>{formatRelativeTime(o.timestamp, now)}</time>
                </TableCell>
                <TableCell>
                  <Link href={`/${chain}/token/${o.token.address}`} className="block max-w-[12rem] truncate font-semibold hover:underline">
                    {title}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className={cn("font-semibold", o.isBuy ? "text-buy" : "text-sell")}>{o.isBuy ? UI.token.side.buy : UI.token.side.sell}</span>
                </TableCell>
                <TableCell className="text-right font-mono">{`${formatQuote(o.total, decimals, 6)} ${symbol}`}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCompactTokens(o.tokenAmount)}
                  {o.token.ticker && <span className="ml-1 text-xs text-muted-foreground">{o.token.ticker}</span>}
                </TableCell>
                <TableCell className="text-right font-mono">{`${formatTokenPrice(o.price, decimals)} ${symbol}`}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {tx && (
                    <a href={tx} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {UI.positions.viewTx}
                    </a>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
