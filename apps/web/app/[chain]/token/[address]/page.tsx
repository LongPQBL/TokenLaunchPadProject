import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { GraduationProgress } from "@/components/graduation-progress";
import { HoldersTable } from "@/components/holders-table";
import { PriceChart } from "@/components/price-chart";
import { SiteHeader } from "@/components/site-header";
import { TokenHeader } from "@/components/token-header";
import { TokenTabs } from "@/components/token-tabs";
import { TradePanel } from "@/components/trade-panel/trade-panel";
import { TradesTable } from "@/components/trades-table";
import { api, ApiError } from "@/lib/api";
import { fillGaps, toChartSeries } from "@/lib/candles";
import { isAddress } from "@/lib/format";

/** One candle per minute. */
const CHART_INTERVAL = 60;
const TRADES_LIMIT = 30;
const HOLDERS_LIMIT = 20;

/**
 * A secondary request must not take the page down, and must not read as "nothing there" either: that would be false.
 * Undefined means "could not load", and the panel says so; the reason goes to the server log.
 */
function orUndefined<T>(request: Promise<T>, what: string): Promise<T | undefined> {
  return request.then(
    (value) => value,
    (error: unknown) => {
      console.error(`token page: could not load ${what}`, error);
      return undefined;
    },
  );
}

function PanelError({ className }: { className?: string }) {
  return (
    <p role="alert" className={className ?? "py-10 text-center text-muted-foreground"}>
      {UI.errors.loadFailed}
    </p>
  );
}

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
  const token = address.toLowerCase();

  // Everything is asked for at once. The token decides the page; the rest fill it in.
  const candlesRequest = orUndefined(api.candles(chain, token, CHART_INTERVAL), "candles");
  const tradesRequest = orUndefined(api.trades(chain, token, { limit: TRADES_LIMIT }), "trades");
  const holdersRequest = orUndefined(api.holders(chain, token, { limit: HOLDERS_LIMIT }), "holders");

  let detail;
  try {
    detail = await api.token(chain, token);
  } catch (error) {
    // A missing or hidden token is a plain "not found". Anything else is logged for the operator and shown calmly.
    if (error instanceof ApiError && error.status === 404) return shell(<NotFound />);
    console.error("token page: could not load the token", error);
    return shell(<PanelError className="py-16 text-center text-muted-foreground" />);
  }

  const [candles, trades, holders] = await Promise.all([candlesRequest, tradesRequest, holdersRequest]);
  const now = Math.floor(Date.now() / 1000);

  return shell(
    <div className="flex flex-col gap-6">
      <TokenHeader chain={chain} token={detail} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {candles ? (
            <PriceChart candles={fillGaps(toChartSeries(candles.items, config.quoteDecimals), CHART_INTERVAL)} />
          ) : (
            <PanelError className="flex h-80 items-center justify-center border border-border text-muted-foreground" />
          )}
          <GraduationProgress token={detail} decimals={config.quoteDecimals} symbol={config.quoteSymbol} />
          <TokenTabs
            trades={trades ? <TradesTable trades={trades.items} chain={chain} now={now} /> : <PanelError />}
            holders={holders ? <HoldersTable holders={holders.items} chain={chain} /> : <PanelError />}
            comments={<p className="py-10 text-center text-muted-foreground">{UI.token.commentsSoon}</p>}
          />
        </div>
        {/* Trading happens on chain, straight from the person's wallet: this panel never asks the API for a price. */}
        <aside data-testid="trade-panel" className="lg:sticky lg:top-20 lg:self-start">
          <TradePanel chain={chain} token={token as `0x${string}`} ticker={detail.ticker ?? "tokens"} />
        </aside>
      </div>
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
