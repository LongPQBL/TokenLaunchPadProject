import { chainBySlug, formatCompactTokens, UI } from "@vezta/shared";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatShareOfSupply, shortAddress } from "@/lib/format";
import type { Holder } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * Top holders, in the order the API gave them. The API has already left out the launchpad (which keeps the unsold
 * supply), the burn address and, once graduated, the pool, so every row is a real holder and the shares can only add
 * up to less than the whole supply.
 */
export function HoldersTable({ holders, chain }: { holders: Holder[]; chain: string }) {
  if (holders.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-muted-foreground">
        {UI.token.noHolders}
      </p>
    );
  }

  const config = chainBySlug(chain);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{UI.token.columns.rank}</TableHead>
          <TableHead>{UI.token.columns.holder}</TableHead>
          <TableHead className="text-right">{UI.token.columns.balance}</TableHead>
          <TableHead className="text-right">{UI.token.columns.share}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holders.map((holder, index) => {
          const explorer = explorerAddressUrl(config, holder.holder);
          return (
            <TableRow key={`${holder.holder}-${index}`} data-testid="holder-row">
              <TableCell className="font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-mono text-xs">
                {explorer ? (
                  <a href={explorer} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {shortAddress(holder.holder)}
                  </a>
                ) : (
                  shortAddress(holder.holder)
                )}
              </TableCell>
              <TableCell className="text-right font-mono">{formatCompactTokens(holder.amount)}</TableCell>
              <TableCell className="text-right font-mono">{formatShareOfSupply(holder.amount)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
