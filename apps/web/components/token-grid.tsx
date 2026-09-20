import { UI } from "@vezta/shared";
import Link from "next/link";
import { discoverHref } from "@/lib/discover";
import type { TokenListItem, TokenSort } from "@/lib/types";
import { TokenCard } from "./token-card";

export function TokenGrid({
  chain,
  items,
  sort,
  q,
  nextCursor,
}: {
  chain: string;
  items: TokenListItem[];
  sort: TokenSort;
  q: string;
  nextCursor?: string;
}) {
  // Not a spinner: by the time this renders the answer is in, and the answer is "nothing".
  if (items.length === 0) {
    return (
      <p role="status" className="py-16 text-center text-muted-foreground">
        {q ? UI.discover.searchEmpty : UI.discover.empty}
      </p>
    );
  }

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((token) => (
          <li key={token.address}>
            <TokenCard chain={chain} token={token} />
          </li>
        ))}
      </ul>
      {nextCursor && (
        <div className="mt-6 text-center">
          <Link href={discoverHref(chain, { sort, q, cursor: nextCursor })} className="font-mono text-sm text-primary hover:underline">
            {UI.discover.next}
          </Link>
        </div>
      )}
    </div>
  );
}
