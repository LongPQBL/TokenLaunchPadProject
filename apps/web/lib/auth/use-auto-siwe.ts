"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useWalletKind } from "../wallet/wallet-kind";
import { useSiwe } from "./use-siwe";

/**
 * Signs an EMBEDDED wallet in to our API as soon as it is there, so comments, reports and profile edits work straight away.
 * The embedded wallet signs without asking, so this costs the person nothing. It never does this for an external wallet: that
 * would put a signature request in front of someone who only logged in, and there it stays a thing an action asks for.
 * One attempt per address: a failure or a refusal is not retried in a loop. Logging out forgets the attempts, so logging in
 * again is a new sign-in, and a different address is a different person.
 */
export function useAutoSiwe() {
  const { address } = useAccount();
  const kind = useWalletKind();
  const { isSignedIn, isLoading, signIn } = useSiwe();
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!address) {
      tried.current.clear();
      return;
    }
    if (kind !== "embedded" || isLoading || isSignedIn) return;
    const key = address.toLowerCase();
    if (tried.current.has(key)) return;
    tried.current.add(key);
    void signIn().catch(() => undefined);
  }, [address, kind, isLoading, isSignedIn, signIn]);
}
