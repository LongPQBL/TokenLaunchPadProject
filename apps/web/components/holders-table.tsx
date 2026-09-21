import { formatCompactTokens, UI } from "@vezta/shared";
import Link from "next/link";
import { isAddress, formatShareOfSupply, shortAddress } from "@/lib/format";
import { pnlDirection, pnlTone } from "@/lib/pnl";
import type { Holder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QuoteValue } from "./quote-value";
import { TokenImage } from "./token-image";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * Top holders, in the order the API gave them: who they are (the name and picture they chose, or their address), what their tokens are
 * worth at the price the curve is at now (their position), what they have made on the token (profit: what they hold, plus what they sold,
 * less what they bought), and their share of the supply. The API has already left out the launchpad (which keeps the unsold supply), the
 * burn address and, once graduated, the pool, so every row is a real holder and the shares can only add up to less than the whole supply.
 * Names and pictures are written by strangers: the name is drawn as text, and a picture only if its address is http(s).
 */
export function HoldersTable({ holders, chain }: { holders: Holder[]; chain: string }) {
  if (holders.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-muted-foreground">
        {UI.token.noHolders}
      </p>
    );
  }

  const columns = UI.token.columns;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{columns.holder}</TableHead>
          <TableHead className="text-right">{columns.position}</TableHead>
          <TableHead className="text-right">{columns.profit}</TableHead>
          <TableHead className="text-right">{columns.share}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holders.map((holder, index) => {
          const name = holder.username ?? shortAddress(holder.holder);
          const direction = pnlDirection(holder.pnl);
          return (
            <TableRow key={`${holder.holder}-${index}`} data-testid="holder-row">
              <TableCell>
                <div className="flex items-center gap-3">
                  <TokenImage src={holder.avatarUrl} alt={name} initial={holder.username ?? holder.holder.slice(2)} className="size-8 rounded-full text-xs" />
                  {isAddress(holder.holder) ? (
                    <Link href={`/${chain}/profile/${holder.holder}`} title={holder.holder} className="font-medium hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="font-medium">{name}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono" title={`${formatCompactTokens(holder.amount)} tokens`}>
                <QuoteValue chain={chain} raw={holder.value} compact />
              </TableCell>
              <TableCell className="text-right font-mono">
                <span data-testid="holder-pnl" data-direction={direction} className={cn(pnlTone(direction))}>
                  <QuoteValue chain={chain} raw={holder.pnl} signed compact />
                </span>
              </TableCell>
              <TableCell className="text-right font-mono">{formatShareOfSupply(holder.amount)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
