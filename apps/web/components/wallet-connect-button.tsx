"use client";

import { UI } from "@vezta/shared";
import { useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect, type CreateConnectorFn } from "wagmi";
import { shortAddress } from "@/lib/format";
import { LOGIN_TRIGGER } from "@/lib/wallet/login-trigger";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

/** A wallet announces its own icon. It is shown only if it is an inline image or https: never a URL of any other kind. */
const safeIcon = (icon: string | undefined) => (icon && /^(data:image\/|https:\/\/)/.test(icon) ? icon : undefined);

/**
 * A way to reach a wallet that is not one of the config's own connectors: offered only when the config has none. Privy's wagmi
 * config carries no connectors (it strips them and turns wallet discovery off), so when this list is the emergency route out of a
 * Privy that would not load, the caller brings its own.
 */
export interface FallbackWallet {
  name: string;
  connector: CreateConnectorFn;
}

export function WalletConnectButton({ fallback = [] }: { fallback?: FallbackWallet[] } = {}) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();
  const { connect } = useConnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-xs">{shortAddress(address)}</span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          {UI.wallet.disconnect}
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0" {...LOGIN_TRIGGER}>
          {UI.wallet.connect}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.wallet.connectTitle}</DialogTitle>
        <DialogDescription>
          {connectors.length === 0 && fallback.length === 0 ? UI.wallet.noWallet : "Choose the wallet you want to use."}
        </DialogDescription>
        <ul className="mt-4 flex flex-col gap-2">
          {connectors.map((connector) => {
            const icon = safeIcon(connector.icon);
            return (
              <li key={connector.uid}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() =>
                    // Declining in the wallet is the person's choice, not an error: the dialog just stays open.
                    connect({ connector }, { onSuccess: () => setOpen(false), onError: () => undefined })
                  }
                >
                  {icon && <img src={icon} alt="" className="size-5" referrerPolicy="no-referrer" />}
                  {connector.name}
                </Button>
              </li>
            );
          })}
          {connectors.length === 0 &&
            fallback.map((wallet) => (
              <li key={wallet.name}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => connect({ connector: wallet.connector }, { onSuccess: () => setOpen(false), onError: () => undefined })}
                >
                  {wallet.name}
                </Button>
              </li>
            ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
