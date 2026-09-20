import { chainBySlug, formatQuote, safeHttpUrl, UI } from "@vezta/shared";
import Link from "next/link";
import { formatPercentBps, shortAddress } from "@/lib/format";
import type { TokenListItem } from "@/lib/types";

/**
 * One token in the grid. The name, ticker, description and image URL are all written by strangers, so every one of
 * them is rendered as text or as a checked attribute: React escapes text, and the image URL must be http(s).
 * A token with no resolved metadata still shows, with what the chain says about it and a placeholder picture.
 */
export function TokenCard({ chain, token }: { chain: string; token: TokenListItem }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  const title = token.name ?? token.ticker ?? shortAddress(token.address);
  const image = safeHttpUrl(token.imageUrl);
  const bps = Math.min(Math.max(token.progressBps, 0), 10_000);
  const status = token.migrated ? UI.token.status.graduated : token.complete ? UI.token.status.graduating : undefined;

  return (
    <Link
      href={`/${chain}/token/${token.address}`}
      data-testid="token-card"
      className="flex gap-3 border border-border bg-card p-3 transition-colors hover:border-border-hover"
    >
      {image ? (
        // A plain <img>: the image host is a deploy-time setting, so next/image's allow-list cannot be written yet.
        // The URL has been scheme-checked above, and the referrer is withheld so the host learns nothing about us.
        <img src={image} alt={title} referrerPolicy="no-referrer" loading="lazy" className="size-16 shrink-0 bg-secondary object-cover" />
      ) : (
        <div
          data-testid="token-image-placeholder"
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center bg-secondary font-mono text-lg text-muted-foreground"
        >
          {(token.ticker ?? title).slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate font-semibold">{title}</h3>
          {token.ticker && token.name && <span className="shrink-0 font-mono text-xs text-muted-foreground">{token.ticker}</span>}
          {status && <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-primary">{status}</span>}
        </div>

        {token.description && <p className="line-clamp-2 text-sm text-muted-foreground">{token.description}</p>}

        <div className="mt-2 flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={UI.token.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(bps / 100)}
            className="h-1 flex-1 bg-secondary"
          >
            <div className="h-full bg-primary" style={{ width: `${bps / 100}%` }} />
          </div>
          <span className="font-mono text-xs">{formatPercentBps(token.progressBps)}</span>
        </div>

        <div className="mt-1 flex gap-3 font-mono text-xs text-muted-foreground">
          <span>{`${formatQuote(token.volumeQuote, decimals, 4)} ${symbol}`}</span>
          <span>{UI.token.trades(token.tradeCount)}</span>
        </div>
      </div>
    </Link>
  );
}
