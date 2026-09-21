"use client";

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
 * The price chart of one token, kept current. Each live trade moves the last candle (or starts the next one); a
 * reconnect or a dead socket refetches the candles, which are then the truth. Gaps are filled for the drawing only.
 */
export function LivePriceChart({
  chain,
  token,
  initial,
  interval,
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
  const accumulator = useRef(createCandleAccumulator({ token, interval, decimals, initial }));
  const [series, setSeries] = useState<ChartCandle[]>(initial);

  const refetch = useCallback(async () => {
    const page = await api.candles(chain, token, interval);
    accumulator.current.replace(toChartSeries(page.items, decimals));
    setSeries(accumulator.current.series);
  }, [chain, token, interval, decimals]);

  useLiveRoom({
    room: roomOf(chain, token),
    client,
    refetch,
    onMessage: (message) => {
      const parsed = liveTradeSchema.safeParse(message);
      if (parsed.success && accumulator.current.apply(parsed.data)) setSeries(accumulator.current.series);
    },
  });

  const filled = useMemo(() => fillGaps(series, interval), [series, interval]);
  return useHasChain() ? <PricedChart chain={chain} candles={filled} /> : <PriceChart candles={filled} />;
}

/** The chart, told what an ETH is worth once the chain's price feed says, so it can draw in dollars (and in ETH until then). */
function PricedChart({ chain, candles }: { chain: string; candles: ChartCandle[] }) {
  const rate = useUsdRate(chain);
  const usdPerEth = rate ? Number(rate.answer) / 10 ** rate.decimals : undefined;
  return <PriceChart candles={candles} usdPerEth={usdPerEth} />;
}
