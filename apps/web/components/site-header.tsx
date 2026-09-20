import { chainBySlug, UI } from "@vezta/shared";
import Link from "next/link";
import type { TokenSort } from "@/lib/types";
import { Button } from "./ui/button";
import { SearchBox } from "./search-box";

export function SiteHeader({ chain, sort, q, isTestnet }: { chain: string; sort: TokenSort; q: string; isTestnet: boolean }) {
  const chainName = chainBySlug(chain)?.name ?? chain;

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
      <Link href={`/${chain}`} className="shrink-0 font-semibold tracking-tight">
        Vezta <span className="text-primary">Launchpad</span>
      </Link>
      <SearchBox chain={chain} sort={sort} q={q} />
      {isTestnet && (
        // Not decoration: it is what stops someone taking this for real money.
        <span className="shrink-0 border border-warning px-2 py-1 font-mono text-[0.65rem] text-warning">{UI.badge.testnet(chainName)}</span>
      )}
      <Button asChild size="sm" className="shrink-0">
        <Link href={`/${chain}/create`}>{UI.nav.create}</Link>
      </Button>
    </header>
  );
}
