"use client";

import { useQueryClient } from "@tanstack/react-query";
import { formatQuote, UI } from "@vezta/shared";
import { useState } from "react";
import type { Address } from "viem";
import { useGasPrice, usePublicClient, useSendTransaction } from "wagmi";
import { QuoteValue } from "@/components/quote-value";
import { TxToast } from "@/components/tx-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getDeployment } from "@/lib/deployment";
import { parseAmount } from "@/lib/format";
import { useTxRun } from "@/lib/tx/use-tx-run";

const SUGGESTED = ["0.1", "0.2", "0.3"];
/** A plain transfer costs 21,000 gas; twice that is left in the main wallet as headroom. */
const TRANSFER_GAS = 42_000n;

/** Moves ETH from the main wallet to the trading wallet: one prompt, in the main wallet, and then trading needs none. */
export function TopUpDialog({
  chain,
  to,
  mainBalance,
  trigger = { size: "xs", variant: "outline" },
}: {
  chain: string;
  to: Address;
  mainBalance: bigint | undefined;
  /** How the button that opens the dialog looks: small in a panel, larger in the header. */
  trigger?: { size: "xs" | "sm"; variant: "outline" | "default" };
}) {
  const deployment = getDeployment();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });
  const gasPrice = useGasPrice({ chainId: deployment?.chainId });
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();
  const { state, run } = useTxRun();
  const [text, setText] = useState("");

  const value = parseAmount(text) ?? 0n;
  const reserve = (gasPrice.data ?? 0n) * TRANSFER_GAS;
  const tooMuch = value > 0n && mainBalance !== undefined && value + reserve > mainBalance;

  function send() {
    void run(
      async () => {
        // On the app's chain: a main wallet on another network is asked to switch first, never to send there.
        const hash = await sendTransactionAsync({ to, value, chainId: deployment?.chainId });
        await publicClient!.waitForTransactionReceipt({ hash });
        // Read the balance now rather than wait for the next poll: this is the figure the person is looking for.
        const now = await publicClient!.getBalance({ address: to });
        void queryClient.invalidateQueries();
        return { hash, now };
      },
      (r) => ({ message: UI.session.toppedUp(formatQuote(value, 18, 6), formatQuote(r.now, 18, 6)), hash: r.hash }),
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={trigger.size} variant={trigger.variant}>
          {UI.session.topUp}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.session.topUpTitle}</DialogTitle>
        <DialogDescription>{UI.session.topUpWhy}</DialogDescription>
        {mainBalance !== undefined && (
          <p className="mt-2 text-sm text-muted-foreground">
            {UI.session.mainWallet} {UI.session.balance.toLowerCase()}: <QuoteValue chain={chain} raw={mainBalance} />
          </p>
        )}
        <div className="mt-4 flex gap-2">
          {SUGGESTED.map((amount) => (
            <Button key={amount} type="button" size="xs" variant={text === amount ? "default" : "outline"} onClick={() => setText(amount)}>
              {`${amount} ETH`}
            </Button>
          ))}
        </div>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          {UI.session.topUpAmount}
          <input
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="border border-border bg-background px-3 py-2 font-mono"
          />
        </label>
        {tooMuch && <p className="mt-2 text-sm text-muted-foreground">{UI.session.topUpInsufficient}</p>}
        <Button className="mt-4 w-full" disabled={value <= 0n || tooMuch || state.status === "pending"} onClick={send}>
          {UI.session.topUpSend}
        </Button>
        <div className="mt-3">
          <TxToast state={state} chain={chain} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
