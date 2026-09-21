import { UI } from "@vezta/shared";
import type { TokenListItem } from "@/lib/types";
import { TokenCard } from "../token-card";

/** The tokens an address launched. A card draws a stranger's text as text, so nothing here needs to care. */
export function CreatedTab({ chain, tokens }: { chain: string; tokens: TokenListItem[] }) {
  if (tokens.length === 0) {
    return (
      <p role="status" className="py-12 text-center text-muted-foreground">
        {UI.profile.noCreated}
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {tokens.map((token) => (
        <li key={token.address}>
          <TokenCard chain={chain} token={token} />
        </li>
      ))}
    </ul>
  );
}
