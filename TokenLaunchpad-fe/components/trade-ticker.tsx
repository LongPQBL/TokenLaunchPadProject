"use client";

import { formatCompactTokens } from "@vezta/shared";
import Link from "next/link";
import { useRef, useState } from "react";
import { shortAddress } from "@/lib/format";
import type { LiveClient } from "@/lib/ws/client";
import { liveTradeSchema, tradeKey, type LiveTrade } from "@/lib/ws/live";
import { liveTokenHiddenSchema } from "@/lib/ws/moderation";
import { useLiveRoom } from "@/lib/ws/use-live-room";
import { QuoteValue } from "./quote-value";

const SHOWN = 20;

/**
 * The global trade feed as a strip: the last 20 trades across every token, newest first. It starts empty and fills as
 * trades happen. While the pointer is over it, or something in it has focus, it holds still (a strip that shifts under
 * a click is a strip nobody can click) and shows what it missed when they let go.
 */
export function TradeTicker({ chain, labels, client }: { chain: string; labels: Record<string, string>; client?: LiveClient }) {
  const [shown, setShown] = useState<LiveTrade[]>([]);
  const held = useRef<LiveTrade[]>([]); // arrived while the pointer was over the strip
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  // Tokens a moderator hid while this page was open: their trades are gone from the strip and stay out.
  const hidden = useRef(new Set<string>());

  useLiveRoom({
    room: "trades",
    client,
    poll: false, // a strip of "what just happened" has nothing to refetch
    refetch: async () => {},
    onMessage: (message) => {
      const gone = liveTokenHiddenSchema.safeParse(message);
      if (gone.success) {
        if (gone.data.chain !== chain) return;
        hidden.current.add(gone.data.token);
        held.current = held.current.filter((t) => t.token !== gone.data.token);
        setShown((prev) => prev.filter((t) => t.token !== gone.data.token));
        return;
      }
      const parsed = liveTradeSchema.safeParse(message);
      if (!parsed.success || hidden.current.has(parsed.data.token)) return;
      const key = tradeKey(`${parsed.data.txHash}-${parsed.data.logIndex}`);
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (seen.current.size > 1_000) seen.current.delete(seen.current.values().next().value!);
      if (busy.current) held.current = [parsed.data, ...held.current].slice(0, SHOWN);
      else setShown((prev) => [parsed.data, ...prev].slice(0, SHOWN));
    },
  });

  const hold = () => {
    busy.current = true;
  };
  const release = () => {
    busy.current = false;
    const missed = held.current;
    held.current = [];
    if (missed.length > 0) setShown((prev) => [...missed, ...prev].slice(0, SHOWN));
  };

  return (
    <section aria-label="Recent trades" onPointerEnter={hold} onPointerLeave={release} onFocus={hold} onBlur={release} className="overflow-x-auto border border-border px-3 py-2">
      {shown.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">Waiting for trades…</p>
      ) : (
        <ul className="flex gap-6 whitespace-nowrap font-mono text-xs">
          {shown.map((t) => (
            <li key={`${t.txHash}-${t.logIndex}`} data-testid="ticker-item">
              <Link href={`/${chain}/token/${t.token}`} className="hover:underline">
                <span className={t.isBuy ? "text-buy" : "text-sell"}>{t.isBuy ? "Buy" : "Sell"}</span>{" "}
                {formatCompactTokens(t.tokenAmount)} {labels[t.token] ?? shortAddress(t.token)} · <QuoteValue chain={chain} raw={t.quoteAmount} compact />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
