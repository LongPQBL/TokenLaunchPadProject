"use client";

import { UI } from "@vezta/shared";
import { useSession } from "@/lib/session/use-session";
import { useIdentity } from "@/lib/wallet/use-identity";
import { Button } from "./ui/button";

/**
 * What to say when a wallet is connected but its trading wallet is not open yet (an external wallet, whose trading wallet is who
 * trades): it is opening, or it needs the one signature that opens it, or the main wallet signed differently than before. Nothing
 * when it is open, when the wallet signs by itself, or when no wallet is connected (the panel has its own connect prompt).
 */
export function TradingWalletNotice() {
  const identity = useIdentity();
  const session = useSession();
  if (identity.kind !== "external" || identity.status === "ready") return null;

  if (identity.status === "mismatch") {
    return (
      <div role="alert" className="flex flex-col gap-1 border border-destructive p-3 text-sm">
        <p className="font-semibold">{UI.session.mismatchTitle}</p>
        <p className="text-xs text-muted-foreground">{UI.session.mismatchBody}</p>
      </div>
    );
  }
  if (identity.status === "needs-signature") {
    return (
      <div role="status" className="flex flex-col gap-2 border border-warning p-3 text-sm">
        <p className="font-semibold">{UI.session.needsTitle}</p>
        <p className="text-xs text-muted-foreground">{UI.session.needsBody}</p>
        <Button size="sm" onClick={() => void session.enable()}>
          {UI.session.open}
        </Button>
      </div>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {UI.session.openingTitle}
    </p>
  );
}
