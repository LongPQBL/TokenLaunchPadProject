"use client";

import { UI } from "@vezta/shared";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useSiwe } from "@/lib/auth/use-siwe";
import { shortAddress } from "@/lib/format";
import { useAutoSiwe } from "@/lib/auth/use-auto-siwe";
import { ExportKeyButton } from "./export-key-button";
import { Button } from "./ui/button";
import { injected } from "wagmi/connectors";
import { WalletConnectButton, type FallbackWallet } from "./wallet-connect-button";

/** The browser's own wallet (window.ethereum), for when Privy cannot be reached. */
const BROWSER_WALLET: FallbackWallet[] = [{ name: "Browser wallet", connector: injected() }];

/** How long a Privy that is not ready gets before the plain wallet list is offered instead. */
export const PRIVY_PATIENCE_MS = 8_000;

/**
 * The one entry point when Privy is on: Google, email and any wallet, in Privy's own screen. Logged in, it shows who and a
 * way out. Logging out ends OUR API session first and then Privy's, and a failure of the first never keeps a person logged in
 * to the second. It is only ever drawn inside the Privy layer (its hooks need it); ConnectButton decides that.
 */
export function LoginButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signOut } = useSiwe();
  const leaving = useRef(false);
  useAutoSiwe();
  // A Privy that never becomes ready (blocked, offline) must not take every way of getting in with it: after a few seconds the plain
  // wallet list is offered, and Log in returns the moment Privy does become ready.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (ready) {
      setGaveUp(false);
      return;
    }
    const timer = setTimeout(() => setGaveUp(true), PRIVY_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  async function leave() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      await signOut().catch(() => undefined);
      await logout();
    } catch {
      /* Privy could not log out: the page still lets go of the wallet below */
    } finally {
      // Privy letting go does not make wagmi let go (found by logging out for real): the page went on showing the wallet and its
      // Sell button. Whatever happened above, nothing here may still think someone is connected.
      disconnect();
      leaving.current = false;
    }
  }

  if (!authenticated && !ready && gaveUp) return <WalletConnectButton fallback={BROWSER_WALLET} />;
  if (!authenticated) {
    return (
      <Button variant="outline" size="sm" className="shrink-0" disabled={!ready} onClick={() => login()}>
        {UI.wallet.login}
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      {address && <span className="font-mono text-xs">{shortAddress(address)}</span>}
      <ExportKeyButton />
      <Button variant="outline" size="sm" onClick={() => void leave()}>
        {UI.wallet.logout}
      </Button>
    </div>
  );
}
