"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  budgetForMaxCost,
  centsToText,
  chainBySlug,
  formatCompactTokens,
  formatQuote,
  formatUsd,
  maxCostWithSlippage,
  parseUsd,
  quoteToUsdCents,
  UI,
  usdToQuote,
} from "@vezta/shared";
import { useState } from "react";
import type { Address } from "viem";
import { useBalance, useGasPrice } from "wagmi";
import { ChainGuard } from "@/components/chain-guard";
import { FundWallet } from "@/components/fund-wallet";
import { ConnectButton } from "@/components/connect-button";
import { LaunchTaxBanner } from "@/components/launch-tax-banner";
import { LaunchTaxGuard } from "@/components/launch-tax-dialog";
import { TxToast } from "@/components/tx-toast";
import { QuoteValue } from "@/components/quote-value";
import { Button } from "@/components/ui/button";
import { useBuyQuote } from "@/lib/chain/use-buy-quote";
import { useLaunchTax } from "@/lib/chain/use-launch-tax";
import { useUsdRate } from "@/lib/chain/use-usd-rate";
import { getDeployment } from "@/lib/deployment";
import { parseAmount } from "@/lib/format";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useSlippage } from "@/lib/use-slippage";
import { useIdentity } from "@/lib/wallet/use-identity";
import { useTrade } from "@/lib/wallet/use-trade";
import { TradingWalletNotice } from "@/components/trading-wallet-notice";
import { AmountInput } from "./amount-input";
import { CostBreakdown } from "./cost-breakdown";
import { Graduating, useRefreshCurveWhen } from "./curve-state";
import { useLastTrade } from "./last-trade";
import { SlippagePopover } from "./slippage-popover";

/** A buy costs about this much gas; the balance has to cover it on top of the most the purchase can cost. */
const BUY_GAS = 250_000n;

export function BuyPanel({ chain, token, ticker }: { chain: string; token: Address; ticker: string }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  const trade = useTrade();
  const queryClient = useQueryClient();
  const identity = useIdentity();
  const isConnected = identity.kind !== "none";
  const deployment = getDeployment();
  // The wallet that PAYS: the trading wallet. Its balance, not the main wallet's, is what has to cover the buy.
  const payer = identity.address;
  const balance = useBalance({ address: payer, chainId: deployment?.chainId, query: { enabled: !!payer } });
  const gasPrice = useGasPrice({ chainId: deployment?.chainId });
  const { bps: slippageBps, setBps: setSlippage } = useSlippage();
  const { state, run } = useTxRun();
  const { setLast } = useLastTrade();

  // What the person types is dollars when there is a price to turn them into ETH, and ETH when there is not (or when they choose it).
  const rate = useUsdRate(chain);
  const [chosen, setChosen] = useState<"usd" | "eth">("usd");
  const mode = rate ? chosen : "eth";
  const [text, setText] = useState("");
  // What was typed is the most that may ever leave the wallet, refund included — not the quote itself. The quote is worked
  // backwards from it, so that padding it with slippage for the trade never asks for more than this ceiling.
  const ceiling = mode === "usd" ? (rate ? usdToQuote(parseUsd(text) ?? 0n, rate, decimals) : 0n) : (parseAmount(text, decimals) ?? 0n);
  const budget = budgetForMaxCost(ceiling, slippageBps);
  const quote = useBuyQuote({ token, budget });
  const { secondsLeft } = useLaunchTax(token);

  const maxQuoteCost = maxCostWithSlippage(quote.total, slippageBps);
  const gasReserve = (gasPrice.data ?? 0n) * BUY_GAS;
  const canAfford = balance.data === undefined || balance.data.value >= maxQuoteCost + gasReserve;
  const wantsToBuy = quote.amount > 0n;
  // Nothing is said about an empty or zero budget: an unfinished form is not an error.
  // A wallet with nothing in it is a different situation from one that is a little short: it is told to add ETH, and how.
  const empty = isConnected && balance.data?.value === 0n;
  const blocker = empty ? UI.fund.addFirst : wantsToBuy && !canAfford ? UI.trade.insufficientEth : undefined;
  const canBuy = !!payer && wantsToBuy && canAfford && !quote.isLoading && !quote.curveCompleted && state.status !== "pending";

  // The curve completing is a state, not a mistake: whether the preview noticed or the transaction reverted with it.
  const graduating = quote.curveCompleted || (state.status === "error" && state.code === "CurveCompleted");
  useRefreshCurveWhen(graduating);

  /** The same amount in the other unit, so switching does not change what is about to be bought. */
  function switchMode() {
    if (!rate) return;
    if (mode === "usd") setText(ceiling > 0n ? formatQuote(ceiling, decimals) : "");
    else setText(ceiling > 0n ? centsToText(quoteToUsdCents(ceiling, rate, decimals)) : "");
    setChosen(mode === "usd" ? "eth" : "usd");
  }

  /** The most that can be spent: everything that is held, less only the network fee. Slippage headroom is not the box's
   * problem — it comes out of the quote (see budgetForMaxCost), so the ceiling can be the whole rest of the balance. */
  function useMax() {
    const held = balance.data?.value;
    if (held === undefined) return;
    const spendable = held > gasReserve ? held - gasReserve : 0n;
    if (spendable === 0n) return;
    setText(mode === "usd" && rate ? centsToText(quoteToUsdCents(spendable, rate, decimals)) : formatQuote(spendable, decimals));
  }

  function buy() {
    void run(
      () => trade.buyWithEth({ token, amount: quote.amount, maxQuoteCost }),
      (r) => {
        setText("");
        void queryClient.invalidateQueries(); // the curve, the balance, the allowance: all of it just changed
        // What the Trade event says, never what was asked for: the last buy on a curve is clipped.
        const done = {
          message: UI.trade.bought(formatCompactTokens(r.tokenAmount), ticker, formatQuote(r.quoteAmount + r.fee, decimals, 6), symbol),
          hash: r.hash,
        };
        setLast(done);
        return done;
      },
    );
  }

  if (graduating) return <Graduating />;

  return (
    <section aria-label={UI.trade.buy} className="flex flex-col gap-4 border border-border p-4">
      <LaunchTaxBanner taxBps={quote.taxBps} multiplier={quote.taxMultiplier} secondsLeft={secondsLeft} />

      <div className="flex items-center justify-between gap-2">
        {rate ? (
          <Button type="button" variant="ghost" size="xs" onClick={switchMode}>
            {UI.trade.enterIn(mode === "usd" ? symbol : "USD")}
          </Button>
        ) : (
          <span />
        )}
        <SlippagePopover bps={slippageBps} onChange={setSlippage} />
      </div>
      <AmountInput
        id="buy-amount"
        label={UI.trade.amountToSpend(mode === "usd" ? "USD" : symbol)}
        prefix={mode === "usd" ? "$" : ""}
        value={text}
        onChange={setText}
        className={mode === "usd" ? undefined : "text-3xl"}
      />
      {rate && (
        <p data-testid="equivalent" className="-mt-2 text-center text-sm text-muted-foreground">
          {mode === "usd" ? `≈ ${formatQuote(ceiling, decimals, 6)} ${symbol}` : `≈ ${formatUsd(quoteToUsdCents(ceiling, rate, decimals))}`}
        </p>
      )}

      {isConnected && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span data-testid="balance" className="font-mono text-muted-foreground">
            {balance.data ? (
              <>
                {UI.trade.balanceLabel} <QuoteValue chain={chain} raw={balance.data.value} />
              </>
            ) : null}
          </span>
          <Button type="button" variant="ghost" size="xs" disabled={balance.data === undefined || balance.data.value === 0n} onClick={useMax}>
            {UI.trade.max}
          </Button>
        </div>
      )}

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

      {isConnected && payer && <FundWallet address={payer} balance={balance.data?.value} chain={chain} />}
      <TradingWalletNotice />

      <ChainGuard chainName={config?.name ?? chain}>
        {isConnected ? (
          <LaunchTaxGuard taxBps={quote.taxBps ?? 0n} multiplier={quote.taxMultiplier}>
            <Button className="w-full bg-buy text-black hover:bg-buy/90" disabled={!canBuy} onClick={buy}>
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
