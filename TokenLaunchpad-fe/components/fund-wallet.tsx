"use client";

import { chainBySlug, safeHttpUrl, UI } from "@vezta/shared";
import { CopyButton } from "./copy-button";

/**
 * What a new person sees when their wallet holds nothing: the whole address to send ETH to, a way to copy it, and a faucet if
 * the deployment has one. It draws nothing while the balance is unknown (an unread balance is not an empty one) and nothing
 * once there is any ETH at all. The faucet address is scheme-checked before it is a link.
 */
export function FundWallet({ address, balance, chain }: { address: string; balance: bigint | undefined; chain: string }) {
  if (balance !== 0n) return null;

  const symbol = chainBySlug(chain)?.quoteSymbol ?? "ETH";
  // Written out in full: Next only inlines a NEXT_PUBLIC_ variable that way.
  const faucet = safeHttpUrl(process.env.NEXT_PUBLIC_FAUCET_URL);

  return (
    <section aria-label={UI.fund.title} className="flex flex-col gap-2 border border-border p-3 text-sm">
      <p className="font-semibold">{UI.fund.title}</p>
      <p className="text-xs text-muted-foreground">{UI.fund.body(symbol)}</p>
      <p className="break-all font-mono text-xs">{address}</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={address} />
        {faucet && (
          <a href={faucet} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
            {UI.fund.faucet}
          </a>
        )}
      </div>
    </section>
  );
}
