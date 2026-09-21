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
  fresh,
  flashes,
  listProps,
}: {
  chain: string;
  items: TokenListItem[];
  sort: TokenSort;
  q: string;
  nextCursor?: string;
  /** Addresses that arrived live, for the entrance animation. */
  fresh?: ReadonlySet<string>;
  /** How many times each card's volume has changed live: restarts its flash. */
  flashes?: Readonly<Record<string, number>>;
  /** Handlers for the list itself: the live grid uses them to know when the pointer is over it. */
  listProps?: React.HTMLAttributes<HTMLUListElement>;
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
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" {...listProps}>
        {items.map((token) => (
          <li key={token.address} data-fresh={fresh?.has(token.address) ? "true" : undefined} className={fresh?.has(token.address) ? "animate-in fade-in slide-in-from-top-2 duration-500" : undefined}>
            <TokenCard chain={chain} token={token} flash={flashes?.[token.address]} />
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
