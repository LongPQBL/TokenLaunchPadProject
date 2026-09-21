"use client";

import { useQueryClient } from "@tanstack/react-query";
import { chainBySlug, formatCompactTokens, formatQuote, formatUsd, minPayoutWithSlippage, quoteToUsdCents, UI } from "@vezta/shared";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { ChainGuard } from "@/components/chain-guard";
import { ConnectButton } from "@/components/connect-button";
import { TxToast } from "@/components/tx-toast";
import { Button } from "@/components/ui/button";
import { useCurve } from "@/lib/chain/use-curve";
import { useSellQuote } from "@/lib/chain/use-sell-quote";
import { useTokenAccount } from "@/lib/chain/use-token-account";
import { useUsdRate } from "@/lib/chain/use-usd-rate";
import { parseAmount } from "@/lib/format";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useSlippage } from "@/lib/use-slippage";
import { useIdentity } from "@/lib/wallet/use-identity";
import { useTrade } from "@/lib/wallet/use-trade";
import { TradingWalletNotice } from "@/components/trading-wallet-notice";
import { AmountInput } from "./amount-input";
import { Graduating, useRefreshCurveWhen } from "./curve-state";
import { useLastTrade } from "./last-trade";
import { SlippagePopover } from "./slippage-popover";

const TOKEN_DECIMALS = 18;

export function SellPanel({ chain, token, ticker }: { chain: string; token: Address; ticker: string }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  const trade = useTrade();
  const queryClient = useQueryClient();
  const identity = useIdentity();
  const isConnected = identity.kind !== "none";
  // The wallet that HOLDS the tokens: the trading wallet when one is in use, with its own balance and its own approval.
  const { balance, allowance } = useTokenAccount(token, identity.address);
  const { bps: slippageBps, setBps: setSlippage } = useSlippage();
  const { state, run } = useTxRun();
  const { setLast } = useLastTrade();

  // What the person types is a number of TOKENS. When there is a dollar price (the dollar price of ETH, and the curve's own price of the
  // token) what they are worth is said beside it; without one, only tokens are shown.
  const rate = useUsdRate(chain);
  const { curve } = useCurve(token);
  const priced = !!rate && !!curve && curve.virtualQuoteReserves > 0n && curve.virtualTokenReserves > 0n;
  const [text, setText] = useState("");
  const [exactApproval, setExactApproval] = useState(false);
  const [stage, setStage] = useState<"approving" | "selling">("approving");
  // A wallet that signs by itself (the trading wallet, an embedded one) sends the approval and the sale without asking anyone anything, so
  // the person is shown none of it: one press of Sell, and the approval (the most it can be, so later sales need none) is part of it.
  const silent = trade.capabilities.isZeroPrompt;
  const [twoStep, setTwoStep] = useState(false); // this sale began with an approval

  /** What tokens are worth in the quote, at the price the curve is at now, and in dollars. */
  const quoteOf = (tokens: bigint) => (priced ? (tokens * curve!.virtualQuoteReserves) / curve!.virtualTokenReserves : 0n);
  const usdOf = (tokens: bigint) => (priced ? quoteToUsdCents(quoteOf(tokens), rate!, decimals) : 0n);
  const amount = parseAmount(text, TOKEN_DECIMALS) ?? 0n;
  const quote = useSellQuote({ token, amount });
  const minQuoteOutput = minPayoutWithSlippage(quote.payout, slippageBps);

  const tooMuch = balance !== undefined && amount > balance;
  // Two prompts only when the wallet cannot batch: with EIP-5792 the seam sends approve + sell as one.
  const needsApproval = allowance !== undefined && amount > allowance && !trade.capabilities.canBatch;
  // A bound of zero would accept any price at all, so a sale too small to pay anything is not offered.
  const canSell = !!identity.address && amount > 0n && !tooMuch && minQuoteOutput > 0n && allowance !== undefined && state.status !== "pending";

  const graduating = state.status === "error" && state.code === "CurveCompleted";
  useRefreshCurveWhen(graduating);

  /** The whole balance, to the last unit: it is written out in full, so nothing is left behind as dust. */
  function useMax() {
    if (balance === undefined || balance === 0n) return;
    setText(formatUnits(balance, TOKEN_DECIMALS));
  }

  function sell() {
    const exact = exactApproval; // (the choice is only offered to a wallet that asks, so a wallet that signs by itself always approves the most)
    setTwoStep(needsApproval);
    void run(
      async () => {
        if (needsApproval) {
          setStage("approving");
          await trade.approveIfNeeded({ token, amount, exact });
          void queryClient.invalidateQueries(); // the allowance just changed
          setStage("selling");
        }
        return trade.sell({ token, amount, minQuoteOutput, exactApproval: exact });
      },
      (r) => {
        setText("");
        void queryClient.invalidateQueries();
        // What the Trade event says: the payout is the curve price less the fee.
        const done = {
          message: UI.trade.sold(formatCompactTokens(r.tokenAmount), ticker, formatQuote(r.quoteAmount - r.fee, decimals, 6), symbol),
          hash: r.hash,
        };
        setLast(done);
        return done;
      },
    );
  }

  if (graduating) return <Graduating />;

  const label = silent || !needsApproval ? UI.trade.sell : state.status === "pending" && stage === "selling" ? UI.trade.approve.sellStep : UI.trade.approve.step;

  return (
    <section aria-label={UI.trade.sell} className="flex flex-col gap-4 border border-border p-4">
      <div className="flex items-center justify-end gap-2">
        <SlippagePopover bps={slippageBps} onChange={setSlippage} />
      </div>
      <AmountInput id="sell-amount" label={UI.trade.amountToSell(ticker)} prefix="" value={text} onChange={setText} className="text-3xl" />
      {priced && (
        <p data-testid="equivalent" className="-mt-2 text-center text-sm text-muted-foreground">
          {`≈ ${formatUsd(usdOf(amount))}`}
        </p>
      )}

      {isConnected && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span data-testid="balance" className="font-mono text-muted-foreground">
            {balance === undefined ? "" : UI.trade.balanceLine(`${formatCompactTokens(balance)} ${ticker}${priced ? ` ≈ ${formatUsd(usdOf(balance))}` : ""}`)}
          </span>
          <Button type="button" variant="ghost" size="xs" disabled={balance === undefined || balance === 0n} onClick={useMax}>
            {UI.trade.max}
          </Button>
        </div>
      )}

      {amount > 0n && quote.payout > 0n && (
        <p data-testid="receive" className="text-sm text-muted-foreground">
          {UI.trade.youReceiveQuote(`${formatQuote(quote.payout, decimals, 6)} ${symbol}${priced ? ` ≈ ${formatUsd(quoteToUsdCents(quote.payout, rate!, decimals))}` : ""}`)}
        </p>
      )}

      {amount > 0n && quote.payout > 0n && (
        <dl data-testid="cost-breakdown" className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-sm">
          <dt className="text-muted-foreground">{UI.trade.breakdown.price}</dt>
          <dd className="text-right">{formatQuote(quote.quoteOut, decimals, 6)}</dd>
          <dt className="text-muted-foreground">{UI.trade.breakdown.fee}</dt>
          <dd className="text-right">{formatQuote(quote.fee, decimals, 6)}</dd>
          <dt className="border-t border-border pt-1 font-semibold">{UI.trade.breakdown.youGet}</dt>
          <dd className="border-t border-border pt-1 text-right font-semibold">{formatQuote(quote.payout, decimals, 6)}</dd>
          <dt className="text-muted-foreground">{UI.trade.breakdown.minimum}</dt>
          <dd className="text-right">{formatQuote(minQuoteOutput, decimals, 6)}</dd>
        </dl>
      )}

      {needsApproval && !silent && (
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={exactApproval} onChange={(e) => setExactApproval(e.target.checked)} />
            {UI.trade.approve.exact}
          </label>
          <p className="text-xs text-muted-foreground">{UI.trade.approve.explain}</p>
        </div>
      )}

      {silent && twoStep && state.status === "pending" && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {stage === "approving" ? UI.trade.approve.approving : UI.trade.approve.selling}
        </p>
      )}
      <TradingWalletNotice />
      <ChainGuard chainName={config?.name ?? chain}>
        {isConnected ? (
          <Button className="w-full bg-sell text-white hover:bg-sell/90" disabled={!canSell} onClick={sell}>
            {label}
          </Button>
        ) : (
          <ConnectButton />
        )}
      </ChainGuard>

      {tooMuch && <p className="text-sm text-muted-foreground">{UI.trade.insufficientTokens}</p>}
      <TxToast state={state} chain={chain} />
    </section>
  );
}
