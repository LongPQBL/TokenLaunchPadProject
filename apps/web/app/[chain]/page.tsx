import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SortTabs } from "@/components/sort-tabs";
import { LiveTokenGrid } from "@/components/live-discover";
import { TradeTicker } from "@/components/trade-ticker";
import { api } from "@/lib/api";
import { loadDiscover } from "@/lib/discover";
import { shortAddress } from "@/lib/format";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { chain } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  const query = await searchParams;
  const cursorGiven = !!(Array.isArray(query.cursor) ? query.cursor[0] : query.cursor);
  // The visitor sees a calm message; the operator still gets the reason (an unreachable API, or a response that no
  // longer matches the schema) in the server log rather than a silent blank page.
  const data = await loadDiscover(api, chain, query).catch((error: unknown) => {
    console.error("discover: could not load tokens", error);
    return undefined;
  });

  return (
    <>
      <SiteHeader chain={chain} sort={data?.sort ?? "new"} q={data?.q ?? ""} isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {data ? (
          <>
            <TradeTicker chain={chain} labels={Object.fromEntries(data.page.items.map((t) => [t.address, t.ticker ?? shortAddress(t.address)]))} />
            <div className="mt-4">
              <SortTabs chain={chain} active={data.sort} q={data.q} />
            </div>
            <div className="mt-4">
              <LiveTokenGrid
                chain={chain}
                initial={data.page.items}
                sort={data.sort}
                q={data.q}
                firstPage={!cursorGiven}
                nextCursor={data.page.nextCursor}
              />
            </div>
          </>
        ) : (
          <p role="alert" className="py-16 text-center text-muted-foreground">
            {UI.errors.loadFailed}
          </p>
        )}
      </main>
    </>
  );
}
