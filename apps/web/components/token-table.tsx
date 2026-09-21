"use client";

import { chainBySlug, formatQuote, UI } from "@vezta/shared";
import Link from "next/link";
import { discoverHref } from "@/lib/discover";
import { FavoritesNotice, FavoritesProvider } from "@/lib/favorites/use-favorites";
import { formatAge, formatChangeBps, shortAddress } from "@/lib/format";
import type { TokenRow, TokenSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FavoriteStar } from "./favorite-star";
import { TokenImage } from "./token-image";

/** Which sort each sortable column stands for. Always biggest (or newest) first: that is what people come to a table for. */
const COLUMNS: { label: string; sort?: TokenSort; align?: "left" | "right" }[] = [
  { label: "MCAP", sort: "mcap", align: "right" },
  { label: "ATH" },
  { label: "AGE", sort: "new", align: "right" },
  { label: "TXNS", sort: "txns", align: "right" },
  { label: "24H VOL", sort: "volume24h", align: "right" },
  { label: "TRADERS", sort: "traders", align: "right" },
  { label: "1H", sort: "change1h", align: "right" },
  { label: "6H", sort: "change6h", align: "right" },
  { label: "24H", sort: "change24h", align: "right" },
];

const NUMBER = new Intl.NumberFormat("en-US");
const DASH = "—";

function Change({ bps }: { bps: number }) {
  const { text, direction } = formatChangeBps(bps);
  return (
    <span
      data-direction={direction}
      className={cn(
        "inline-block px-1.5 py-0.5 font-mono text-xs",
        direction === "up" && "bg-success/15 text-success",
        direction === "down" && "bg-destructive/15 text-destructive",
        direction === "flat" && "text-muted-foreground",
      )}
    >
      {direction === "up" ? "↑ " : direction === "down" ? "↓ " : ""}
      {text}
    </span>
  );
}

/**
 * The tokens as a table of numbers: market cap and how near it is to its high, age, trades, 24 h volume and traders, and the
 * change in price over 1, 6 and 24 hours. The name, ticker and image of a token are written by strangers, so they are drawn as
 * text and a checked image, as on a card. A row that has no numbers (one the socket just made) shows dashes, never a zero that
 * would look like a fact. The headers sort: each is a link, so the sort is in the URL and needs no script.
 */
export function TokenTable({
  chain,
  items,
  sort,
  q,
  now,
  nextCursor,
  fresh,
  flashes,
  listProps,
}: {
  chain: string;
  items: TokenRow[];
  sort: TokenSort;
  q: string;
  /** The clock the ages are counted from, in unix seconds. */
  now: number;
  nextCursor?: string;
  /** Addresses that arrived live, for the entrance animation. */
  fresh?: ReadonlySet<string>;
  /** How many times each row's 24 h volume has changed live: restarts its flash. */
  flashes?: Readonly<Record<string, number>>;
  /** Handlers for the table itself: the live grid uses them to know when the pointer is over it. */
  listProps?: React.HTMLAttributes<HTMLTableElement>;
}) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";
  const quote = (raw: bigint) => `${formatQuote(raw, decimals, 4)} ${symbol}`;

  // Not a spinner: by the time this renders the answer is in, and the answer is "nothing".
  if (items.length === 0) {
    return (
      <p role="status" className="py-16 text-center text-muted-foreground">
        {q ? UI.discover.searchEmpty : UI.discover.empty}
      </p>
    );
  }

  return (
    <FavoritesProvider chain={chain}>
      <div>
        <FavoritesNotice />
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[60rem] border-collapse whitespace-nowrap text-sm" {...listProps}>
            <thead>
              <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-normal">
                  Token
                </th>
                {COLUMNS.map(({ label, sort: key, align }) => (
                  <th
                    key={label}
                    scope="col"
                    aria-sort={key && key === sort ? "descending" : undefined}
                    className={cn("px-3 py-2 font-normal", align === "right" && "text-right")}
                  >
                    {key ? (
                      // The arrow is drawn by CSS, so it is not part of the header's name.
                      <Link
                        href={discoverHref(chain, { sort: key, q })}
                        className={cn("hover:text-foreground", key === sort && "text-foreground after:ml-1 after:content-['↓']")}
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-normal">
                  <span className="sr-only">Star</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((token) => {
                const title = token.name ?? token.ticker ?? shortAddress(token.address);
                const stats = token.stats;
                const known = !!stats && stats.marketCap > 0n;
                const ath = stats?.athMarketCap ?? 0n;
                const percent = known && ath > 0n ? Number((stats.marketCap * 100n) / ath) : 0;
                const bar = Math.min(Math.max(percent, 0), 100);
                const status = token.migrated ? UI.token.status.graduated : token.complete ? UI.token.status.graduating : undefined;
                const flash = flashes?.[token.address] ?? 0;
                return (
                  <tr
                    key={token.address}
                    data-testid="token-row"
                    data-fresh={fresh?.has(token.address) ? "true" : undefined}
                    className={cn(
                      "border-b border-border last:border-b-0 transition-colors hover:bg-accent/50",
                      fresh?.has(token.address) && "animate-in fade-in duration-500",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <TokenImage src={token.imageUrl} alt={title} initial={token.ticker ?? title} className="size-9 text-sm" />
                        <div className="min-w-0">
                          <Link href={`/${chain}/token/${token.address}`} className="block max-w-[14rem] truncate font-semibold hover:underline">
                            {title}
                          </Link>
                          <div className="flex items-baseline gap-2 font-mono text-xs text-muted-foreground">
                            {token.ticker && <span>{token.ticker}</span>}
                            {status && <span className="text-primary">{status}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{known ? quote(stats.marketCap) : DASH}</td>
                    <td className="px-3 py-2">
                      {known ? (
                        <div className="flex items-center gap-2 font-mono">
                          <div role="img" aria-label={`${bar}% of its all-time high`} className="h-1.5 w-16 shrink-0 bg-secondary">
                            <div className="h-full bg-primary" style={{ width: `${bar}%` }} />
                          </div>
                          <span>{quote(ath)}</span>
                        </div>
                      ) : (
                        <span className="font-mono">{DASH}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatAge(token.createdAt, now)}</td>
                    <td className="px-3 py-2 text-right font-mono">{NUMBER.format(token.tradeCount)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {stats ? (
                        // Keyed by the flash count, so each change is a new element and the animation starts over.
                        <span key={flash} data-tick={flash > 0 ? "up" : undefined} className={flash > 0 ? "tick-flash-primary" : undefined}>
                          {quote(stats.volume24h)}
                        </span>
                      ) : (
                        DASH
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{stats ? NUMBER.format(stats.traders24h) : DASH}</td>
                    {(["change1hBps", "change6hBps", "change24hBps"] as const).map((k) => (
                      <td key={k} className="px-3 py-2 text-right">
                        {stats ? <Change bps={stats[k]} /> : <span className="font-mono text-muted-foreground">{DASH}</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <FavoriteStar token={token.address} label={title} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div className="mt-6 text-center">
            <Link href={discoverHref(chain, { sort, q, cursor: nextCursor })} className="font-mono text-sm text-primary hover:underline">
              {UI.discover.next}
            </Link>
          </div>
        )}
      </div>
    </FavoritesProvider>
  );
}
