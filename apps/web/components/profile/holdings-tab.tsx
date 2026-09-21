import { formatCompactTokens, UI } from "@vezta/shared";
import { shortAddress } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { TokenCard } from "../token-card";

/** What an address holds, biggest first as the API sent it. The ticker is a stranger's text: it is drawn as text. */
export function HoldingsTab({ chain, holdings }: { chain: string; holdings: Profile["holdings"] }) {
  if (holdings.length === 0) {
    return (
      <p role="status" className="py-12 text-center text-muted-foreground">
        {UI.profile.noHoldings}
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {holdings.map(({ token, amount }) => (
        <li key={token.address} data-testid="holding-row" className="flex flex-col gap-1">
          <TokenCard chain={chain} token={token} />
          <p data-testid="holding-balance" className="break-all px-1 font-mono text-xs text-muted-foreground">
            {UI.profile.balance(formatCompactTokens(amount), token.ticker ?? shortAddress(token.address))}
          </p>
        </li>
      ))}
    </ul>
  );
}
