"use client";

import { UI } from "@vezta/shared";
import { usePrivy } from "@privy-io/react-auth";
import { useRef } from "react";
import { useAccount } from "wagmi";
import { useSiwe } from "@/lib/auth/use-siwe";
import { shortAddress } from "@/lib/format";
import { Button } from "./ui/button";

/**
 * The one entry point when Privy is on: Google, email and any wallet, in Privy's own screen. Logged in, it shows who and a
 * way out. Logging out ends OUR API session first and then Privy's, and a failure of the first never keeps a person logged in
 * to the second. It is only ever drawn inside the Privy layer (its hooks need it); ConnectButton decides that.
 */
export function LoginButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const { signOut } = useSiwe();
  const leaving = useRef(false);

  async function leave() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      await signOut().catch(() => undefined);
      await logout();
    } finally {
      leaving.current = false;
    }
  }

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
      <Button variant="outline" size="sm" onClick={() => void leave()}>
        {UI.wallet.logout}
      </Button>
    </div>
  );
}
