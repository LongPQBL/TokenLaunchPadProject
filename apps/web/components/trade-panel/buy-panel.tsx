"use client";

import { useQueryClient } from "@tanstack/react-query";
import { chainBySlug, formatCompactTokens, formatQuote, maxCostWithSlippage, UI } from "@vezta/shared";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useBalance, useGasPrice } from "wagmi";
import { ChainGuard } from "@/components/chain-guard";
import { ConnectButton } from "@/components/connect-button";
import { LaunchTaxBanner } from "@/components/launch-tax-banner";
import { LaunchTaxGuard } from "@/components/launch-tax-dialog";
import { TxToast } from "@/components/tx-toast";
import { Button } from "@/components/ui/button";
import { useBuyQuote } from "@/lib/chain/use-buy-quote";
import { useLaunchTax } from "@/lib/chain/use-launch-tax";
import { getDeployment } from "@/lib/deployment";
import { parseAmount } from "@/lib/format";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useSlippage } from "@/lib/use-slippage";
import { useTrade } from "@/lib/wallet/use-trade";
import { CostBreakdown } from "./cost-breakdown";
import { Graduating, useRefreshCurveWhen } from "./curve-state";
import { SlippagePopover } from "./slippage-popover";

/** A buy costs about this much gas; the balance has to cover it on top of the most the purchase can cost. */
const BUY_GAS = 250_000n;

export function BuyPanel({ chain, token, ticker }: { chain: string; token: Address; ticker: string }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  const trade = useTrade();
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const deployment = getDeployment();
  const balance = useBalance({ address, chainId: deployment?.chainId, query: { enabled: !!address } });
  const gasPrice = useGasPrice({ chainId: deployment?.chainId });
  const { bps: slippageBps, setBps: setSlippage } = useSlippage();
  const { state, run } = useTxRun();

  const [text, setText] = useState("");
  const budget = parseAmount(text, decimals) ?? 0n;
  const quote = useBuyQuote({ token, budget });
  const { secondsLeft } = useLaunchTax(token);

  const maxQuoteCost = maxCostWithSlippage(quote.total, slippageBps);
  const gasReserve = (gasPrice.data ?? 0n) * BUY_GAS;
  const canAfford = balance.data === undefined || balance.data.value >= maxQuoteCost + gasReserve;
  const wantsToBuy = quote.amount > 0n;
  // Nothing is said about an empty or zero budget: an unfinished form is not an error.
  const blocker = wantsToBuy && !canAfford ? UI.trade.insufficientEth : undefined;
  const canBuy = wantsToBuy && canAfford && !quote.isLoading && !quote.curveCompleted && state.status !== "pending";

  // The curve completing is a state, not a mistake: whether the preview noticed or the transaction reverted with it.
  const graduating = quote.curveCompleted || (state.status === "error" && state.code === "CurveCompleted");
  useRefreshCurveWhen(graduating);

  function buy() {
    void run(
      () => trade.buyWithEth({ token, amount: quote.amount, maxQuoteCost }),
      (r) => {
        setText("");
        void queryClient.invalidateQueries(); // the curve, the balance, the allowance: all of it just changed
        // What the Trade event says, never what was asked for: the last buy on a curve is clipped.
        return {
          message: UI.trade.bought(formatCompactTokens(r.tokenAmount), ticker, formatQuote(r.quoteAmount + r.fee, decimals, 6), symbol),
          hash: r.hash,
        };
      },
    );
  }

  if (graduating) return <Graduating />;

  return (
    <section aria-label={UI.trade.buy} className="flex flex-col gap-4 border border-border p-4">
      <LaunchTaxBanner taxBps={quote.taxBps} multiplier={quote.taxMultiplier} secondsLeft={secondsLeft} />

      <div className="flex items-center justify-between gap-2">
        <label htmlFor="buy-amount" className="text-sm text-muted-foreground">
          {UI.trade.amountToSpend(symbol)}
        </label>
        <SlippagePopover bps={slippageBps} onChange={setSlippage} />
      </div>
      <input
        id="buy-amount"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.0"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="border border-border bg-background px-3 py-2 font-mono text-lg"
      />

      {wantsToBuy && (
        <CostBreakdown
          quoteCost={quote.quoteCost}
          baseFee={quote.baseFee}
          launchTax={quote.launchTax}
          total={quote.total}
          amount={quote.amount}
          ticker={ticker}
          symbol={symbol}
          decimals={decimals}
        />
      )}
      {quote.isStale && <p className="text-xs text-muted-foreground">{UI.trade.stale}</p>}

      <ChainGuard chainName={config?.name ?? chain}>
        {isConnected ? (
          <LaunchTaxGuard taxBps={quote.taxBps ?? 0n} multiplier={quote.taxMultiplier}>
            <Button className="w-full" disabled={!canBuy} onClick={buy}>
              {UI.trade.buy}
            </Button>
          </LaunchTaxGuard>
        ) : (
          <ConnectButton />
        )}
      </ChainGuard>

      {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}
      <TxToast state={state} chain={chain} />
    </section>
  );
}
