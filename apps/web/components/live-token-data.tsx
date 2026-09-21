"use client";

import { UI } from "@vezta/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fillGaps, toChartSeries, type ChartCandle } from "@/lib/candles";
import type { Trade } from "@/lib/types";
import type { LiveClient } from "@/lib/ws/client";
import { createCandleAccumulator, liveTradeSchema, mergeTrades, type LiveTrade } from "@/lib/ws/live";
import { useLiveRoom } from "@/lib/ws/use-live-room";
import { useHasChain } from "@/lib/chain/use-has-chain";
import { useUsdRate } from "@/lib/chain/use-usd-rate";
import { PriceChart } from "./price-chart";
import { TradesTable } from "./trades-table";

const TRADES_SHOWN = 30;

const roomOf = (chain: string, token: string) => `token:${chain}:${token.toLowerCase()}`;

/**
 * The trade feed of one token, kept current. It starts from what the server rendered, adds each trade the moment the
 * socket delivers it, and refetches after a reconnect or when the socket is down. A trade is listed once however many
 * ways it arrives. Everything from the socket is checked before it is drawn.
 */
export function LiveTradesTable({ chain, token, initial, now, client }: { chain: string; token: string; initial: Trade[]; now: number; client?: LiveClient }) {
  const [fetched, setFetched] = useState<Trade[]>(initial);
  const [live, setLive] = useState<LiveTrade[]>([]);
  const [clock, setClock] = useState(now);

  // "2s ago" ages while the page is open. (The first render uses the server's clock, so it matches what was rendered.)
  useEffect(() => {
    const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(timer);
  }, []);

  const refetch = useCallback(async () => {
    const page = await api.trades(chain, token, { limit: TRADES_SHOWN });
    setFetched(page.items);
    setLive([]); // what the server has now includes everything the socket had told us
  }, [chain, token]);

  useLiveRoom({
    room: roomOf(chain, token),
    client,
    refetch,
    onMessage: (message) => {
      const parsed = liveTradeSchema.safeParse(message);
      if (!parsed.success || parsed.data.token !== token.toLowerCase()) return;
      setLive((prev) => [...prev.slice(-TRADES_SHOWN * 2), parsed.data]);
    },
  });

  const trades = useMemo(() => mergeTrades(fetched, live, TRADES_SHOWN), [fetched, live]);
  return <TradesTable trades={trades} chain={chain} now={clock} />;
}

/**
 * The price chart of one token, kept current, in the candle size the person picks. It starts in the size the page was rendered with
 * (`interval`, one minute) and asks for the candles of another when it is chosen; until they arrive, and if they cannot be had, the
 * size on show stays. Each live trade moves the last candle (or starts the next) of the size on show; a reconnect or a dead socket
 * refetches the candles of that size, which are then the truth. Gaps are filled for the drawing only. Answers that come back for a
 * size no longer wanted are dropped.
 */
export function LivePriceChart({
  chain,
  token,
  initial,
  interval: initialInterval,
  decimals,
  client,
}: {
  chain: string;
  token: string;
  initial: ChartCandle[];
  interval: number;
  decimals: number;
  client?: LiveClient;
}) {
  const accumulator = useRef(createCandleAccumulator({ token, interval: initialInterval, decimals, initial }));
  const [shown, setShown] = useState({ interval: initialInterval, series: initial });
  const [error, setError] = useState<string>();
  // What is on show, and which choice is the latest: read by answers that arrive later, to tell whether they are still wanted.
  const onShow = useRef(initialInterval);
  const latestChoice = useRef(0);

  const fetchSeries = useCallback(async (size: number) => toChartSeries((await api.candles(chain, token, size)).items, decimals), [chain, token, decimals]);

  const refetch = useCallback(async () => {
    const size = onShow.current;
    const series = await fetchSeries(size);
    if (onShow.current !== size) return; // another size was chosen while this was on its way
    accumulator.current.replace(series);
    setShown({ interval: size, series: accumulator.current.series });
  }, [fetchSeries]);

  const choose = useCallback(
    async (size: number) => {
      if (size === onShow.current) return;
      const choice = ++latestChoice.current;
      setError(undefined);
      try {
        const series = await fetchSeries(size);
        if (choice !== latestChoice.current) return; // a later choice took over
        accumulator.current.switchTo(size, series);
        onShow.current = size;
        setShown({ interval: size, series });
      } catch {
        if (choice === latestChoice.current) setError(UI.token.chartIntervalFailed);
      }
    },
    [fetchSeries],
  );

  useLiveRoom({
    room: roomOf(chain, token),
    client,
    refetch,
    onMessage: (message) => {
      const parsed = liveTradeSchema.safeParse(message);
      if (parsed.success && accumulator.current.apply(parsed.data)) setShown((prev) => ({ ...prev, series: accumulator.current.series }));
    },
  });

  const filled = useMemo(() => fillGaps(shown.series, shown.interval), [shown]);
  const chart =
    // (Keyed by the size: a new size is a new chart, with its own view and its own marks.)
    useHasChain() ? (
      <PricedChart key={shown.interval} chain={chain} candles={filled} interval={shown.interval} onIntervalChange={(size) => void choose(size)} />
    ) : (
      <PriceChart key={shown.interval} candles={filled} interval={shown.interval} onIntervalChange={(size) => void choose(size)} />
    );
  return (
    <div className="flex flex-col gap-1">
      {chart}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The chart, told what an ETH is worth once the chain's price feed says, so it can draw in dollars (and in ETH until then). */
function PricedChart({ chain, ...chart }: { chain: string } & Omit<React.ComponentProps<typeof PriceChart>, "usdPerEth">) {
  const rate = useUsdRate(chain);
  const usdPerEth = rate ? Number(rate.answer) / 10 ** rate.decimals : undefined;
  return <PriceChart {...chart} usdPerEth={usdPerEth} />;
}
