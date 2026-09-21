import { UI } from "@vezta/shared";
import type { DiscoverView, TokenSort } from "@/lib/types";

/**
 * A plain GET form to the chain's page: searching needs no script, and the query lands in the URL where it can be
 * shared. The current sort and view are carried along; the defaults are left out so the URL stays clean.
 */
export function SearchBox({ chain, sort, q, view = "table" }: { chain: string; sort: TokenSort; q: string; view?: DiscoverView }) {
  return (
    <form role="search" method="get" action={`/${chain}`} className="min-w-0 flex-1">
      {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
      {view === "grid" && <input type="hidden" name="view" value="grid" />}
      <input
        type="search"
        name="q"
        defaultValue={q}
        maxLength={64}
        placeholder={UI.nav.search}
        aria-label={UI.nav.search}
        className="h-9 w-full border border-input-border bg-input-bg px-3 font-mono text-sm outline-none focus:border-input-focus"
      />
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  );
}
