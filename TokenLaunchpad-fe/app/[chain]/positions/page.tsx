import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { PositionsView, type PositionsTab } from "@/components/positions-view";
import { SiteHeader } from "@/components/site-header";

/**
 * The connected wallet's positions and order history. Which wallet is only known in the browser, so the lists are fetched there:
 * this page draws the frame and reads which of the two views the address asks for (anything but "orders" is the positions).
 */
export default async function PositionsPage({
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
  const raw = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: PositionsTab = raw === "orders" ? "orders" : "positions";

  return (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-[90rem] px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">{UI.positions.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{UI.positions.intro}</p>
        <div className="mt-6">
          <PositionsView chain={chain} tab={tab} />
        </div>
      </main>
    </>
  );
}
