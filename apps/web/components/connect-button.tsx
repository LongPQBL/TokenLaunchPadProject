"use client";

import { UI } from "@vezta/shared";
import { lazy, Suspense, useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";
import { usePrivyActive } from "@/lib/wallet/privy-context";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

/** A wallet announces its own icon. It is shown only if it is an inline image or https: never a URL of any other kind. */
const safeIcon = (icon: string | undefined) => (icon && /^(data:image\/|https:\/\/)/.test(icon) ? icon : undefined);

function WalletConnectButton() {
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
        <Button variant="outline" size="sm" className="shrink-0">
          {UI.wallet.connect}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.wallet.connectTitle}</DialogTitle>
        <DialogDescription>{connectors.length === 0 ? UI.wallet.noWallet : "Choose the wallet you want to use."}</DialogDescription>
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
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// Loaded only when Privy is running: it pulls in Privy's libraries, which a build without them must neither carry nor load.
const LoginButton = lazy(() => import("./login-button").then((m) => ({ default: m.LoginButton })));

/**
 * How a person gets in. With Privy running it is one Log in for Google, email and wallets; without it (no App ID, or Privy could
 * not start) it is the list of the wallets found in the browser, exactly as before.
 */
export function ConnectButton() {
  if (!usePrivyActive()) return <WalletConnectButton />;
  return (
    <Suspense
      fallback={
        <Button variant="outline" size="sm" className="shrink-0" disabled>
          {UI.wallet.login}
        </Button>
      }
    >
      <LoginButton />
    </Suspense>
  );
}
