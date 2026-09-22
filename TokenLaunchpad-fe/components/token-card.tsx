import { UI } from "@vezta/shared";
import Link from "next/link";
import { formatPercentBps, shortAddress } from "@/lib/format";
import type { TokenListItem } from "@/lib/types";
import { ProgressBar } from "./progress-bar";
import { QuoteValue } from "./quote-value";
import { TokenImage } from "./token-image";

/**
 * One token in the grid. The name, ticker, description and image URL are all written by strangers, so every one of
 * them is rendered as text or as a checked attribute: React escapes text, and the image URL must be http(s).
 * A token with no resolved metadata still shows, with what the chain says about it and a placeholder picture.
 */
export function TokenCard({ chain, token, flash = 0 }: { chain: string; token: TokenListItem; /** Bumped each time the volume changes live: a new number restarts the flash. */ flash?: number }) {

  const title = token.name ?? token.ticker ?? shortAddress(token.address);
  const status = token.migrated ? UI.token.status.graduated : token.complete ? UI.token.status.graduating : undefined;

  return (
    <Link
      href={`/${chain}/token/${token.address}`}
      data-testid="token-card"
      className="flex gap-3 border border-border bg-card p-3 transition-colors hover:border-border-hover"
    >
      <TokenImage src={token.imageUrl} alt={title} initial={token.ticker ?? title} className="size-16 rounded-full text-lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate font-semibold">{title}</h3>
          {token.ticker && token.name && <span className="shrink-0 font-mono text-xs text-muted-foreground">{token.ticker}</span>}
          {status && <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-primary">{status}</span>}
        </div>

        {token.description && <p className="line-clamp-2 text-sm text-muted-foreground">{token.description}</p>}

        <div className="mt-2 flex items-center gap-2">
          <ProgressBar bps={token.progressBps} label={UI.token.progress} className="h-1 flex-1" />
          <span className="font-mono text-xs">{formatPercentBps(token.progressBps)}</span>
        </div>

        <div className="mt-1 flex gap-3 font-mono text-xs text-muted-foreground">
          {/* Keyed by the flash count, so each change is a new element and the animation starts over. */}
          <span key={flash} data-tick={flash > 0 ? "up" : undefined} className={flash > 0 ? "tick-flash-primary" : undefined}>
            <QuoteValue chain={chain} raw={token.volumeQuote} compact />
          </span>
          <span>{UI.token.trades(token.tradeCount)}</span>
        </div>
      </div>
    </Link>
  );
}
