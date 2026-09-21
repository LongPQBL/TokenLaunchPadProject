"use client";

import { useEffect, useRef } from "react";
import { useIdentity } from "../wallet/use-identity";
import { useSiwe } from "./use-siwe";

/**
 * Signs the person in to our API as soon as their wallet is there (an embedded wallet, or an external wallet's trading wallet once
 * it is open), so comments, stars, reports and profile edits work straight away. Both sign with a key in the browser, without
 * asking, so this costs the person nothing. One attempt per address: a failure or a refusal is not retried in a loop. Logging out
 * forgets the attempts, so logging in again is a new sign-in, and a different address is a different person.
 */
export function useAutoSiwe() {
  const { address } = useIdentity();
  const { isSignedIn, isLoading, signIn } = useSiwe();
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!address) {
      tried.current.clear();
      return;
    }
    if (isLoading || isSignedIn) return;
    const key = address.toLowerCase();
    if (tried.current.has(key)) return;
    tried.current.add(key);
    void signIn().catch(() => undefined);
  }, [address, isLoading, isSignedIn, signIn]);
}
