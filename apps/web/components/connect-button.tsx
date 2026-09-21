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
