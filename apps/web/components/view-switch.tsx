import { UI } from "@vezta/shared";
import Link from "next/link";
import { discoverHref } from "@/lib/discover";
import type { DiscoverView, TokenSort } from "@/lib/types";
import { cn } from "@/lib/utils";

const VIEWS: { view: DiscoverView; label: string }[] = [
  { view: "table", label: UI.discover.view.table },
  { view: "grid", label: UI.discover.view.grid },
];

/** Table or grid: plain links, so the choice is in the URL, can be shared, and needs no script. The sort and search are kept. */
export function ViewSwitch({ chain, view, sort, q }: { chain: string; view: DiscoverView; sort: TokenSort; q: string }) {
  return (
    <nav aria-label={UI.discover.view.label} className="flex shrink-0 border border-border">
      {VIEWS.map((v) => (
        <Link
          key={v.view}
          href={discoverHref(chain, { sort, q, view: v.view })}
          aria-current={v.view === view ? "page" : undefined}
          className={cn("px-3 py-1.5 font-mono text-xs", v.view === view ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
