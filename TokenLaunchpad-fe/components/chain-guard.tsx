"use client";

import { UI } from "@vezta/shared";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useIdentity } from "@/lib/wallet/use-identity";
import { getDeployment } from "@/lib/deployment";
import { Button } from "./ui/button";

/**
 * Wraps anything that sends a transaction. On the wrong network the children are replaced by a way to switch, so a wallet that
 * signs through its own connection is never asked to sign something on a chain the app is not for. With no wallet connected the children show:
 * they carry their own connect prompt.
 */
export function ChainGuard({ chainName, children }: { chainName: string; children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { kind } = useIdentity();
  const { switchChain, isPending } = useSwitchChain();
  const expected = getDeployment()?.chainId;

  // An external wallet's trades are signed by its trading wallet, in the browser, for the app's chain: the network the main wallet
  // happens to be on does not matter to them.
  if (kind === "external") return <>{children}</>;
  if (!isConnected || expected === undefined || chainId === expected) return <>{children}</>;

  return (
    <div role="status" className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
      <p>{UI.wallet.wrongNetwork(chainName)}</p>
      <Button size="sm" disabled={isPending} onClick={() => switchChain({ chainId: expected })}>
        {UI.wallet.switchTo(chainName)}
      </Button>
    </div>
  );
}
