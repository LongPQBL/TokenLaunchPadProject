import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { GraduationProgress } from "@/components/graduation-progress";
import { PriceChart } from "@/components/price-chart";
import { SiteHeader } from "@/components/site-header";
import { TokenHeader } from "@/components/token-header";
import { api, ApiError } from "@/lib/api";
import { fillGaps, toChartSeries } from "@/lib/candles";
import { isAddress } from "@/lib/format";

/** One candle per minute. */
const CHART_INTERVAL = 60;

export default async function TokenPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
    </>
  );

  // The address comes from the URL. Anything that is not an address is "not found" without asking the API.
  if (!isAddress(address)) return shell(<NotFound />);

  // Asked for alongside the token rather than after it. A chart that fails to load must not take the page down, and
  // must not read as "no trades yet" either: that would be false. Undefined means "could not load".
  const candlesRequest = api.candles(chain, address.toLowerCase(), CHART_INTERVAL).then(
    (result) => result.items,
    (error: unknown) => {
      console.error("token page: could not load candles", error);
      return undefined;
    },
  );

  let token;
  try {
    token = await api.token(chain, address.toLowerCase());
  } catch (error) {
    // A missing or hidden token is a plain "not found". Anything else is logged for the operator and shown calmly.
    if (error instanceof ApiError && error.status === 404) return shell(<NotFound />);
    console.error("token page: could not load the token", error);
    return shell(
      <p role="alert" className="py-16 text-center text-muted-foreground">
        {UI.errors.loadFailed}
      </p>,
    );
  }

  const candles = await candlesRequest;

  return shell(
    <div className="flex flex-col gap-6">
      <TokenHeader chain={chain} token={token} />
      {candles ? (
        <PriceChart candles={fillGaps(toChartSeries(candles, config.quoteDecimals), CHART_INTERVAL)} />
      ) : (
        <p role="alert" className="flex h-80 items-center justify-center border border-border text-muted-foreground">
          {UI.errors.loadFailed}
        </p>
      )}
      <GraduationProgress token={token} decimals={config.quoteDecimals} symbol={config.quoteSymbol} />
    </div>,
  );
}

function NotFound() {
  return (
    <p role="alert" className="py-16 text-center text-muted-foreground">
      {UI.errors.notFound}
    </p>
  );
}
