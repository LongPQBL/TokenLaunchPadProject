"use client";

import { useQueryClient } from "@tanstack/react-query";
import { centsToText, chainBySlug, formatCompactTokens, formatQuote, formatUsd, minPayoutWithSlippage, parseUsd, quoteToUsdCents, UI, usdToQuote } from "@vezta/shared";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount } from "wagmi";
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
import { useTrade } from "@/lib/wallet/use-trade";
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
  const { isConnected } = useAccount();
  // The wallet that HOLDS the tokens: the trading wallet when one is in use, with its own balance and its own approval.
  const { balance, allowance } = useTokenAccount(token, trade.capabilities.address);
  const { bps: slippageBps, setBps: setSlippage } = useSlippage();
  const { state, run } = useTxRun();
  const { setLast } = useLastTrade();

  // What the person types is dollars when there is a price to turn them into tokens (the dollar price of ETH, and the curve's own
  // price of the token), and tokens when there is not, or when they choose it.
  const rate = useUsdRate(chain);
  const { curve } = useCurve(token);
  const priced = !!rate && !!curve && curve.virtualQuoteReserves > 0n && curve.virtualTokenReserves > 0n;
  const [chosen, setChosen] = useState<"usd" | "token">("usd");
  const mode = priced ? chosen : "token";
  const [text, setText] = useState("");
  // "Sell everything" is the whole balance to the last unit, not a dollar figure turned back into tokens, which would leave dust.
  const [maxed, setMaxed] = useState(false);
  const [exactApproval, setExactApproval] = useState(false);
  const [stage, setStage] = useState<"approving" | "selling">("approving");

  /** What tokens are worth in the quote, at the price the curve is at now; and the reverse. */
  const quoteOf = (tokens: bigint) => (priced ? (tokens * curve!.virtualQuoteReserves) / curve!.virtualTokenReserves : 0n);
  const tokensOf = (quoteAmount: bigint) => (priced ? (quoteAmount * curve!.virtualTokenReserves) / curve!.virtualQuoteReserves : 0n);
  const usdOf = (tokens: bigint) => (priced ? quoteToUsdCents(quoteOf(tokens), rate!, decimals) : 0n);
  const amount =
    mode === "usd" ? (maxed && balance !== undefined ? balance : tokensOf(usdToQuote(parseUsd(text) ?? 0n, rate!, decimals))) : (parseAmount(text, TOKEN_DECIMALS) ?? 0n);
  const quote = useSellQuote({ token, amount });
  const minQuoteOutput = minPayoutWithSlippage(quote.payout, slippageBps);

  const tooMuch = balance !== undefined && amount > balance;
  // Two prompts only when the wallet cannot batch: with EIP-5792 the seam sends approve + sell as one.
  const needsApproval = allowance !== undefined && amount > allowance && !trade.capabilities.canBatch;
  // A bound of zero would accept any price at all, so a sale too small to pay anything is not offered.
  const canSell = amount > 0n && !tooMuch && minQuoteOutput > 0n && allowance !== undefined && state.status !== "pending";

  const graduating = state.status === "error" && state.code === "CurveCompleted";
  useRefreshCurveWhen(graduating);

  function type(value: string) {
    setMaxed(false);
    setText(value);
  }

  /** The same amount in the other unit, so switching does not change what is about to be sold. */
  function switchMode() {
    if (!priced) return;
    if (mode === "usd") setText(amount > 0n ? formatUnits(amount, TOKEN_DECIMALS) : "");
    else setText(amount > 0n ? centsToText(usdOf(amount)) : "");
    setChosen(mode === "usd" ? "token" : "usd");
  }

  function useMax() {
    if (balance === undefined || balance === 0n) return;
    setMaxed(true);
    setText(mode === "usd" ? centsToText(usdOf(balance)) : formatUnits(balance, TOKEN_DECIMALS));
  }

  function sell() {
    void run(
      async () => {
        if (needsApproval) {
          setStage("approving");
          await trade.approveIfNeeded({ token, amount, exact: exactApproval });
          void queryClient.invalidateQueries(); // the allowance just changed
          setStage("selling");
        }
        return trade.sell({ token, amount, minQuoteOutput, exactApproval });
      },
      (r) => {
        setText("");
        setMaxed(false);
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

  const label = !needsApproval ? UI.trade.sell : state.status === "pending" && stage === "selling" ? UI.trade.approve.sellStep : UI.trade.approve.step;

  return (
    <section aria-label={UI.trade.sell} className="flex flex-col gap-4 border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        {priced ? (
          <Button type="button" variant="ghost" size="xs" onClick={switchMode}>
            {UI.trade.enterIn(mode === "usd" ? ticker : "USD")}
          </Button>
        ) : (
          <span />
        )}
        <SlippagePopover bps={slippageBps} onChange={setSlippage} />
      </div>
      <AmountInput
        id="sell-amount"
        label={mode === "usd" ? UI.trade.amountToSell("USD") : UI.trade.amountToSell(ticker)}
        prefix={mode === "usd" ? "$" : ""}
        value={text}
        onChange={type}
        className={mode === "usd" ? undefined : "text-3xl"}
      />
      {priced && (
        <p data-testid="equivalent" className="-mt-2 text-center text-sm text-muted-foreground">
          {mode === "usd" ? `≈ ${formatCompactTokens(amount)} ${ticker}` : `≈ ${formatUsd(usdOf(amount))}`}
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

      {needsApproval && (
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={exactApproval} onChange={(e) => setExactApproval(e.target.checked)} />
            {UI.trade.approve.exact}
          </label>
          <p className="text-xs text-muted-foreground">{UI.trade.approve.explain}</p>
        </div>
      )}

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
