import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { TokenHiddenWatcher } from "@/components/admin/token-hidden-watcher";
import { CommentList } from "@/components/comments/comment-list";
import { HideTokenButton } from "@/components/admin/hide-button";
import { ReportButton } from "@/components/admin/report-button";
import { GraduationProgress } from "@/components/graduation-progress";
import { IndexingNotice } from "@/components/indexing-notice";
import { HoldersTable } from "@/components/holders-table";
import { LivePriceChart, LiveTradesTable } from "@/components/live-token-data";
import { SessionBar } from "@/components/session/session-bar";
import { SiteHeader } from "@/components/site-header";
import { TokenHeader } from "@/components/token-header";
import { TokenTabs } from "@/components/token-tabs";
import { TradePanel } from "@/components/trade-panel/trade-panel";
import { api, ApiError } from "@/lib/api";
import { toChartSeries } from "@/lib/candles";
import { DEFAULT_CHART_INTERVAL } from "@/lib/chart-intervals";
import { isAddress } from "@/lib/format";

/** The candle size the page is rendered with: one minute. The chart offers the others (see lib/chart-intervals). */
const CHART_INTERVAL = DEFAULT_CHART_INTERVAL;
const TRADES_LIMIT = 30;
const HOLDERS_LIMIT = 20;
const COMMENTS_LIMIT = 30;

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

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string; address: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { chain, address } = await params;
  const justCreated = (await searchParams).new === "1";
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
  const commentsRequest = orUndefined(api.comments(chain, token, { limit: COMMENTS_LIMIT }), "comments");

  let detail;
  try {
    detail = await api.token(chain, token);
  } catch (error) {
    // A missing or hidden token is a plain "not found". Anything else is logged for the operator and shown calmly.
    // Just created: the indexer takes a few seconds to see it, so say that and keep looking.
    if (error instanceof ApiError && error.status === 404) return shell(justCreated ? <IndexingNotice /> : <NotFound />);
    console.error("token page: could not load the token", error);
    return shell(<PanelError className="py-16 text-center text-muted-foreground" />);
  }

  const [candles, trades, holders, comments] = await Promise.all([candlesRequest, tradesRequest, holdersRequest, commentsRequest]);
  const now = Math.floor(Date.now() / 1000);

  return shell(
    <div className="flex flex-col gap-6">
      <TokenHiddenWatcher chain={chain} token={token} />
      <TokenHeader chain={chain} token={detail} />
      {/* Each of these draws nothing unless the viewer may use it, so for most people this row is empty and takes no room. */}
      <div className="-mt-3 flex flex-wrap justify-end gap-2 empty:hidden">
        <ReportButton chain={chain} token={token} />
        <HideTokenButton chain={chain} token={token} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {candles ? (
            <LivePriceChart chain={chain} token={token} initial={toChartSeries(candles.items, config.quoteDecimals)} interval={CHART_INTERVAL} decimals={config.quoteDecimals} />
          ) : (
            <PanelError className="flex h-80 items-center justify-center border border-border text-muted-foreground" />
          )}
          <GraduationProgress chain={chain} token={detail} decimals={config.quoteDecimals} symbol={config.quoteSymbol} />
          <TokenTabs
            trades={trades ? <LiveTradesTable chain={chain} token={token} initial={trades.items} now={now} /> : <PanelError />}
            holders={holders ? <HoldersTable holders={holders.items} chain={chain} /> : <PanelError />}
            comments={comments ? <CommentList chain={chain} token={token} initial={comments.items} nextCursor={comments.nextCursor} now={now} /> : <PanelError />}
          />
        </div>
        {/* Trading happens on chain, straight from the person's wallet: this panel never asks the API for a price. */}
        <aside data-testid="trade-panel" className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <SessionBar chain={chain} />
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
