import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SortTabs } from "@/components/sort-tabs";
import { TokenGrid } from "@/components/token-grid";
import { api } from "@/lib/api";
import { loadDiscover } from "@/lib/discover";

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
            <SortTabs chain={chain} active={data.sort} q={data.q} />
            <div className="mt-4">
              <TokenGrid chain={chain} items={data.page.items} sort={data.sort} q={data.q} nextCursor={data.page.nextCursor} />
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
