import { formatCompactTokens, UI } from "@vezta/shared";
import Link from "next/link";
import { formatPnlBps, shortAddress } from "@/lib/format";
import { pnlDirection, pnlTone } from "@/lib/pnl";
import type { Position } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QuoteValue } from "./quote-value";
import { TokenImage } from "./token-image";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const DASH = "—";
const direction = pnlDirection;
const tone = pnlTone;

/**
 * What a wallet holds now: how much, what it is worth at the price the curve is at, what it cost and what has come back, and the
 * profit or loss that makes. The names are written by strangers, so they are drawn as text. A token that came by transfer has
 * nothing spent on it, so it shows dashes and no percentage rather than a 0 that looks like a fact.
 */
export function PositionsTable({ chain, positions }: { chain: string; positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <p role="status" className="py-16 text-center text-muted-foreground">
        {UI.positions.emptyPositions}
      </p>
    );
  }

  // Dollars when the chain's price feed answers, ETH when it does not; the ETH it comes to is in the tooltip.
  const quote = (raw: bigint) => <QuoteValue chain={chain} raw={raw} />;
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0n);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0n);
  const c = UI.positions.columns;

  return (
    <div className="flex flex-col gap-4">
      <dl role="group" aria-label="Totals" className="flex flex-wrap gap-x-10 gap-y-2 font-mono">
        <div>
          <dt className="text-xs text-muted-foreground">{UI.positions.totals.value}</dt>
          <dd className="text-lg">
            <QuoteValue chain={chain} raw={totalValue} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{UI.positions.totals.pnl}</dt>
          <dd className={cn("text-lg", tone(direction(totalPnl)))}>
            <QuoteValue chain={chain} raw={totalPnl} signed />
          </dd>
        </div>
      </dl>
      <div className="overflow-x-auto border border-border">
        <Table className="min-w-[44rem] whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>{c.token}</TableHead>
              <TableHead className="text-right">{c.balance}</TableHead>
              <TableHead className="text-right">{c.value}</TableHead>
              <TableHead className="text-right">{c.bought}</TableHead>
              <TableHead className="text-right">{c.sold}</TableHead>
              <TableHead className="text-right">{c.pnl}</TableHead>
              <TableHead className="text-right">{c.action}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => {
              const title = p.token.name ?? p.token.ticker ?? shortAddress(p.token.address);
              const pct = formatPnlBps(p.pnlBps);
              const dir = direction(p.pnl);
              const href = `/${chain}/token/${p.token.address}`;
              return (
                <TableRow key={p.token.address} data-testid="position-row">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <TokenImage src={p.token.imageUrl} alt={title} initial={p.token.ticker ?? title} className="size-8 text-sm" />
                      <div className="min-w-0">
                        <Link href={href} className="block max-w-[12rem] truncate font-semibold hover:underline">
                          {title}
                        </Link>
                        {p.token.ticker && <span className="font-mono text-xs text-muted-foreground">{p.token.ticker}</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCompactTokens(p.balance)}</TableCell>
                  <TableCell className="text-right font-mono">{quote(p.value)}</TableCell>
                  <TableCell className="text-right font-mono">{p.spent > 0n ? quote(p.spent) : DASH}</TableCell>
                  <TableCell className="text-right font-mono">{p.received > 0n ? quote(p.received) : DASH}</TableCell>
                  <TableCell className="text-right font-mono">
                    <span data-testid="pnl" data-direction={dir} className={tone(dir)}>
                      <QuoteValue chain={chain} raw={p.pnl} signed />
                    </span>
                    {p.pnlBps !== null && <span className={cn("ml-2 text-xs", tone(pct.direction))}>{pct.text}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className="font-mono text-xs text-primary hover:underline">
                      {c.action}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
