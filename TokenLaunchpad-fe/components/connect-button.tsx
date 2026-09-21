"use client";

import { UI } from "@vezta/shared";
import { lazy, Suspense } from "react";
import { usePrivyActive } from "@/lib/wallet/privy-context";
import { Button } from "./ui/button";
import { WalletConnectButton } from "./wallet-connect-button";

// Loaded only when Privy is running: it pulls in Privy's libraries, which a build without them must neither carry nor load.
const LoginButton = lazy(() => import("./login-button").then((m) => ({ default: m.LoginButton })));

/**
 * How a person gets in. With Privy running it is one Log in for Google, email and wallets; without it (no App ID, or Privy could
 * not start) it is the list of the wallets found in the browser, exactly as before.
 */
/** `chain` is given by the header, which is where the wallet menu (address, balance, withdraw) is drawn; elsewhere it is only how to get in. */
export function ConnectButton({ chain }: { chain?: string } = {}) {
  if (!usePrivyActive()) return <WalletConnectButton chain={chain} />;
  return (
    <Suspense
      fallback={
        <Button variant="outline" size="sm" className="shrink-0" disabled>
          {UI.wallet.login}
        </Button>
      }
    >
      <LoginButton chain={chain} />
    </Suspense>
  );
}
