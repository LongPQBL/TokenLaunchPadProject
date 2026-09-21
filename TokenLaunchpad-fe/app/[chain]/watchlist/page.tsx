import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { WatchlistView } from "@/components/watchlist-view";
import { parseSort } from "@/lib/discover";

/**
 * The tokens the person has starred. What is starred is the account's, so the list is fetched in the browser with the session,
 * not here: this page only draws the frame and hands over which column the address says to sort by.
 */
export default async function WatchlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { chain } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();
  const query = await searchParams;

  return (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-[90rem] px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">{UI.watchlist.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{UI.watchlist.intro}</p>
        <div className="mt-6">
          <WatchlistView chain={chain} sort={parseSort(query.sort)} />
        </div>
      </main>
    </>
  );
}
