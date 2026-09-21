import { UI } from "@vezta/shared";
import Link from "next/link";
import { discoverHref } from "@/lib/discover";
import type { DiscoverView, TokenSort } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS: { sort: TokenSort; label: string }[] = [
  { sort: "new", label: UI.discover.tabs.new },
  { sort: "volume", label: UI.discover.tabs.trending },
  { sort: "progress", label: UI.discover.tabs.progress },
];

/** Plain links rather than script-driven tabs: the sort lives in the URL, so it can be shared and needs no client code. */
export function SortTabs({ chain, active, q, view = "table" }: { chain: string; active: TokenSort; q: string; view?: DiscoverView }) {
  return (
    <nav aria-label="Sort tokens" className="flex gap-1 border-b border-border">
      {TABS.map(({ sort, label }) => (
        <Link
          key={sort}
          href={discoverHref(chain, { sort, q, view })}
          aria-current={sort === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            sort === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
