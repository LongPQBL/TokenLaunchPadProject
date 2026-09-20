"use client";

import { useQueryClient } from "@tanstack/react-query";
import { chainBySlug, formatCompactTokens, formatQuote, minPayoutWithSlippage, UI } from "@vezta/shared";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import { ChainGuard } from "@/components/chain-guard";
import { ConnectButton } from "@/components/connect-button";
import { TxToast } from "@/components/tx-toast";
import { Button } from "@/components/ui/button";
import { useSellQuote } from "@/lib/chain/use-sell-quote";
import { useTokenAccount } from "@/lib/chain/use-token-account";
import { parseAmount } from "@/lib/format";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useSlippage } from "@/lib/use-slippage";
import { useTrade } from "@/lib/wallet/use-trade";
import { Graduating, useRefreshCurveWhen } from "./curve-state";
import { SlippagePopover } from "./slippage-popover";

const TOKEN_DECIMALS = 18;

export function SellPanel({ chain, token, ticker }: { chain: string; token: Address; ticker: string }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";

  const trade = useTrade();
  const queryClient = useQueryClient();
  const { isConnected } = useAccount();
  const { balance, allowance } = useTokenAccount(token);
  const { bps: slippageBps, setBps: setSlippage } = useSlippage();
  const { state, run } = useTxRun();

  const [text, setText] = useState("");
  const [exactApproval, setExactApproval] = useState(false);
  const [stage, setStage] = useState<"approving" | "selling">("approving");

  const amount = parseAmount(text, TOKEN_DECIMALS) ?? 0n;
  const quote = useSellQuote({ token, amount });
  const minQuoteOutput = minPayoutWithSlippage(quote.payout, slippageBps);

  const tooMuch = balance !== undefined && amount > balance;
  // Two prompts only when the wallet cannot batch: with EIP-5792 the seam sends approve + sell as one.
  const needsApproval = allowance !== undefined && amount > allowance && !trade.capabilities.canBatch;
  // A bound of zero would accept any price at all, so a sale too small to pay anything is not offered.
  const canSell = amount > 0n && !tooMuch && minQuoteOutput > 0n && allowance !== undefined && state.status !== "pending";

  const graduating = state.status === "error" && state.code === "CurveCompleted";
  useRefreshCurveWhen(graduating);

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
        void queryClient.invalidateQueries();
        // What the Trade event says: the payout is the curve price less the fee.
        return {
          message: UI.trade.sold(formatCompactTokens(r.tokenAmount), ticker, formatQuote(r.quoteAmount - r.fee, decimals, 6), symbol),
          hash: r.hash,
        };
      },
    );
  }

  if (graduating) return <Graduating />;

  const label = !needsApproval ? UI.trade.sell : state.status === "pending" && stage === "selling" ? UI.trade.approve.sellStep : UI.trade.approve.step;

  return (
    <section aria-label={UI.trade.sell} className="flex flex-col gap-4 border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="sell-amount" className="text-sm text-muted-foreground">
          {UI.trade.amountToSell(ticker)}
        </label>
        <SlippagePopover bps={slippageBps} onChange={setSlippage} />
      </div>
      <div className="flex gap-2">
        <input
          id="sell-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 border border-border bg-background px-3 py-2 font-mono text-lg"
        />
        <Button type="button" variant="outline" disabled={balance === undefined || balance === 0n} onClick={() => balance !== undefined && setText(formatUnits(balance, TOKEN_DECIMALS))}>
          {UI.trade.max}
        </Button>
      </div>

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
          <Button className="w-full" disabled={!canSell} onClick={sell}>
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
