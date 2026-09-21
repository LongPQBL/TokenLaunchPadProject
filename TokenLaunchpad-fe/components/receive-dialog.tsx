"use client";

import { chainBySlug, safeHttpUrl, UI } from "@vezta/shared";
import { CopyButton } from "./copy-button";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

/**
 * How a wallet that has no main wallet behind it (Google, email) is filled: its whole address, a way to copy it, and a faucet if the
 * deployment has one. (A wallet with a main wallet is filled from that, by TopUpDialog.)
 */
export function ReceiveDialog({ chain, address, trigger = { size: "sm", variant: "default" } }: { chain: string; address: string; trigger?: { size: "xs" | "sm"; variant: "outline" | "default" } }) {
  const symbol = chainBySlug(chain)?.quoteSymbol ?? "ETH";
  // Written out in full: Next only inlines a NEXT_PUBLIC_ variable that way.
  const faucet = safeHttpUrl(process.env.NEXT_PUBLIC_FAUCET_URL);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={trigger.size} variant={trigger.variant}>
          {UI.session.topUp}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.session.receiveTitle}</DialogTitle>
        <DialogDescription>{UI.session.receiveBody(symbol)}</DialogDescription>
        <p className="mt-3 break-all font-mono text-xs">{address}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CopyButton text={address} />
          {faucet && (
            <a href={faucet} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
              {UI.fund.faucet}
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
