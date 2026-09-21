"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DiscoverView, TokenRow, TokenSort } from "@/lib/types";
import type { LiveClient } from "@/lib/ws/client";
import { applyTradeToItem, liveCreatedSchema, newTokenItem, sortItems } from "@/lib/ws/discover";
import { liveTradeSchema, tradeKey } from "@/lib/ws/live";
import { liveTokenHiddenSchema } from "@/lib/ws/moderation";
import { useLiveRoom } from "@/lib/ws/use-live-room";
import { TokenGrid } from "./token-grid";
import { TokenTable } from "./token-table";

/**
 * The discover grid, kept current. New tokens appear at the top, each trade updates its card's volume, count and progress
 * (flashing the number), and the cards re-sort as the numbers change. Nothing moves while the person is using the grid:
 * with the pointer over it or a card focused, cards stay where they are (their numbers still update), and anything that
 * would have moved waits until they let go. A reconnect or a dead socket refetches the first page.
 *
 * Only the plain "newest" view takes new tokens: in another sort, or a search, or on a later page, a token would not belong
 * where it would land.
 *
 * It draws either the grid of cards or the table (`view`); the live handling is the same for both, so it lives here once.
 */
export function LiveTokenGrid({
  chain,
  initial,
  sort,
  q,
  firstPage,
  nextCursor,
  view = "grid",
  now,
  client,
}: {
  chain: string;
  initial: TokenRow[];
  sort: TokenSort;
  q: string;
  firstPage: boolean;
  nextCursor?: string;
  view?: DiscoverView;
  /** The server's clock in unix seconds, for the ages in the table: the first draw uses it, so it matches what was rendered. */
  now?: number;
  client?: LiveClient;
}) {
  const [items, setItems] = useState<TokenRow[]>(initial);
  const [clock, setClock] = useState(now ?? 0);
  // "3h" ages while the page is open.
  useEffect(() => {
    setClock(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false); // the pointer is over the grid, or a card has focus
  const seen = useRef(new Set<string>());
  const frozenOrder = useRef<string[]>([]);
  // Tokens a moderator hid while this page was open: gone from the grid, and not to be added again by a late message.
  const hidden = useRef(new Set<string>());

  const takesNewTokens = sort === "new" && q === "" && firstPage;

  const refetch = useCallback(async () => {
    if (!firstPage || q !== "") return; // a later page or a search is not the live view
    const page = await api.tokens(chain, { sort, limit: initial.length || undefined });
    setItems(page.items);
  }, [chain, sort, q, firstPage, initial.length]);

  useLiveRoom({
    room: "trades",
    client,
    refetch,
    onMessage: (message) => {
      const parsed = liveTradeSchema.safeParse(message);
      if (!parsed.success) return;
      const key = tradeKey(`${parsed.data.txHash}-${parsed.data.logIndex}`);
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (seen.current.size > 5_000) seen.current.delete(seen.current.values().next().value!);
      const token = parsed.data.token;
      setItems((prev) => (prev.some((i) => i.address === token) ? prev.map((i) => applyTradeToItem(i, parsed.data)) : prev));
      setFlashes((prev) => (items.some((i) => i.address === token) ? { ...prev, [token]: (prev[token] ?? 0) + 1 } : prev));
    },
  });

  useLiveRoom({
    room: "tokens",
    client,
    poll: false, // the trades room already refetches this page
    refetch: async () => {},
    onMessage: (message) => {
      const gone = liveTokenHiddenSchema.safeParse(message);
      if (gone.success) {
        if (gone.data.chain !== chain) return;
        hidden.current.add(gone.data.token);
        setItems((prev) => prev.filter((i) => i.address !== gone.data.token));
        return;
      }
      const parsed = liveCreatedSchema.safeParse(message);
      if (!parsed.success || !takesNewTokens || hidden.current.has(parsed.data.token)) return;
      const token = parsed.data.token;
      if (items.some((i) => i.address === token)) return;
      const created = newTokenItem(parsed.data, Math.floor(Date.now() / 1000));
      setFresh((prev) => new Set(prev).add(token));
      // While the pointer is over the grid the arrangement is frozen (see `ordered`), so a new card is in the data but not yet
      // on screen: it appears when the pointer leaves.
      setItems((prev) => [created, ...prev]);
    },
  });

  const ordered = useMemo(() => {
    if (busy && frozenOrder.current.length > 0) {
      // Hold the arrangement the person is looking at: the same cards in the same places, with their current numbers.
      const byAddress = new Map(items.map((i) => [i.address, i]));
      return frozenOrder.current.map((a) => byAddress.get(a)).filter((i): i is TokenRow => !!i);
    }
    return sortItems(items, sort);
  }, [items, sort, busy]);

  const startHolding = () => {
    frozenOrder.current = ordered.map((i) => i.address);
    setBusy(true);
  };
  const stopHolding = () => {
    setBusy(false);
    frozenOrder.current = [];
  };

  const listProps = { onPointerEnter: startHolding, onPointerLeave: stopHolding, onFocus: startHolding, onBlur: stopHolding };
  if (view === "table") {
    return <TokenTable chain={chain} items={ordered} sort={sort} q={q} now={clock} nextCursor={nextCursor} fresh={fresh} flashes={flashes} listProps={listProps} />;
  }
  return <TokenGrid chain={chain} items={ordered} sort={sort} q={q} nextCursor={nextCursor} fresh={fresh} flashes={flashes} listProps={listProps} />;
}
