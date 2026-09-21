"use client";

import { useQueryClient } from "@tanstack/react-query";
import { chainBySlug, UI } from "@vezta/shared";
import { useEffect, type ReactNode } from "react";
import type { Address } from "viem";
import { useCurve } from "@/lib/chain/use-curve";
import { TxToast } from "@/components/tx-toast";
import { uniswapSwapUrl } from "@/lib/explorer";
import { useLastTrade } from "./last-trade";

/** The curve is full and the pool is not made yet: nothing can be bought or sold here for a minute or two. */
export function Graduating() {
  return (
    <div role="status" className="flex flex-col gap-2 border border-border p-4">
      <p className="font-mono text-lg font-semibold text-warning">{UI.trade.graduating}</p>
      <p className="text-sm text-muted-foreground">{UI.trade.graduatingNote}</p>
    </div>
  );
}

/** Trading has moved to Uniswap: the way there replaces the panel. */
export function MigratedLink({ chain, token }: { chain: string; token: Address }) {
  const url = uniswapSwapUrl(chainBySlug(chain), token);
  return (
    <div className="flex flex-col gap-3 border border-border p-4">
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="border border-primary px-3 py-2 text-center text-primary hover:bg-primary hover:text-primary-foreground">
          {UI.token.tradeOnUniswap}
        </a>
      )}
    </div>
  );
}

/**
 * Re-reads every chain query when `when` becomes true. A panel that has just learned the curve completed (from a
 * revert, or a preview that reverted) must not wait for the next 5 s poll to say so.
 */
export function useRefreshCurveWhen(when: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (when) void queryClient.invalidateQueries();
  }, [when, queryClient]);
}

/**
 * Decides what the trading area shows for the curve's state, from the chain and not the indexer: the panel while it is
 * filling, GRADUATING… (polled every 2 s) while it waits for migration, and the Uniswap link once it has moved. A panel
 * that only saw the state change from its own failed call gets there without a reload, because they all read the same
 * query.
 */
export function CurveGate({ chain, token, children, graduatingPollMs = 2_000 }: { chain: string; token: Address; children: ReactNode; graduatingPollMs?: number }) {
  const { status } = useCurve(token, { graduatingMs: graduatingPollMs });
  const { last } = useLastTrade();
  if (status !== "migrated" && status !== "awaiting-migration") return <>{children}</>;
  return (
    <div className="flex flex-col gap-3">
      {/* What the person's last trade was, kept: the purchase that filled the curve is what brought them here. */}
      {last && <TxToast state={{ status: "success", message: last.message, hash: last.hash }} chain={chain} />}
      {status === "migrated" ? <MigratedLink chain={chain} token={token} /> : <Graduating />}
    </div>
  );
}
