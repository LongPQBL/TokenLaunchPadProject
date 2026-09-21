import { chainBySlug, marketCap, safeHttpUrl, spotPrice, UI } from "@vezta/shared";
import { explorerAddressUrl, uniswapSwapUrl } from "@/lib/explorer";
import { shortAddress } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";
import { StatusBadge } from "./status-badge";
import { PriceValue, QuoteValue } from "./quote-value";
import { TokenImage } from "./token-image";

const SOCIALS = [
  ["website", "Website"],
  ["twitter", "Twitter"],
  ["telegram", "Telegram"],
] as const;

// Every link that leaves the site: no handle back to this page, no referrer, and no search-engine credit for a
// link a stranger chose.
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow ugc" } as const;

/**
 * The top of a token's page. Name, ticker, description, image and links are all written by the token's author, so
 * text is rendered as text and every URL is scheme-checked here, at the point an href is written. The contract
 * address is shown in full with an explorer link: that is how a visitor verifies they are looking at the real token.
 */
export function TokenHeader({ chain, token }: { chain: string; token: TokenDetail }) {
  const config = chainBySlug(chain);

  const title = token.name ?? token.ticker ?? shortAddress(token.address);
  const price = spotPrice(token.virtualQuoteReserves, token.virtualTokenReserves);
  const cap = marketCap(token.virtualQuoteReserves, token.virtualTokenReserves);

  const links = SOCIALS.flatMap(([key, label]) => {
    const href = safeHttpUrl(token.socials[key]);
    return href ? [{ label, href }] : [];
  });

  const uniswap = token.migrated ? uniswapSwapUrl(config, token.address) : undefined;

  const contract = explorerAddressUrl(config, token.address);
  const creator = explorerAddressUrl(config, token.creator);

  return (
    <header className="flex flex-col gap-4 sm:flex-row">
      <TokenImage src={token.imageUrl} alt={title} initial={token.ticker ?? title} className="size-24 text-3xl" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {token.ticker && token.name && <span className="font-mono text-sm text-muted-foreground">{token.ticker}</span>}
          <StatusBadge complete={token.complete} migrated={token.migrated} />
        </div>

        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {contract ? (
            <a href={contract} {...EXTERNAL} className="hover:text-foreground hover:underline">
              {token.address}
            </a>
          ) : (
            token.address
          )}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {UI.token.creator}{" "}
          {creator ? (
            <a href={creator} {...EXTERNAL} className="hover:text-foreground hover:underline">
              {shortAddress(token.creator)}
            </a>
          ) : (
            shortAddress(token.creator)
          )}
        </p>

        <dl className="mt-3 flex gap-6 font-mono text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{UI.token.price}</dt>
            <dd>
              <PriceValue chain={chain} raw={price} secondary />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{UI.token.marketCap}</dt>
            <dd>
              <QuoteValue chain={chain} raw={cap} secondary compact />
            </dd>
          </div>
        </dl>

        {token.description && <p className="mt-3 text-sm">{token.description}</p>}

        {(links.length > 0 || uniswap) && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {links.map(({ label, href }) => (
              <a key={label} href={href} {...EXTERNAL} className="text-primary hover:underline">
                {label}
              </a>
            ))}
            {uniswap && (
              <a href={uniswap} {...EXTERNAL} className="border border-primary px-3 py-1 text-primary hover:bg-primary hover:text-primary-foreground">
                {UI.token.tradeOnUniswap}
              </a>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
