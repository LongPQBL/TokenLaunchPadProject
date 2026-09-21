"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { isUserRejection } from "../wallet/self-custody";
import { useWalletKind } from "../wallet/wallet-kind";
import { loadOrCreateSession, restoreSession, SESSION_MESSAGE, SessionMismatchError } from "./derive";
import type { SessionAccount } from "./types";

export type SessionStatus =
  /** No wallet is connected, or the wallet signs by itself (an embedded wallet IS the trading wallet): there is nothing to open. */
  | "none"
  /** The stored wallet is being opened. */
  | "restoring"
  | "ready"
  /** The browser does not have the key: one signature from the main wallet brings it back. Never a silent fallback to the main wallet. */
  | "needs-signature"
  /** The main wallet signed differently than it did the first time. Blocking: see SessionMismatchError. */
  | "mismatch";

export interface SessionValue {
  status: SessionStatus;
  account: SessionAccount | undefined;
  /** The connected wallet the trading wallet belongs to and is funded from. */
  main: Address | undefined;
  /** Opens the trading wallet. Asks the main wallet for a signature only if the key is not already stored. False if declined. */
  enable(): Promise<boolean>;
}

const NONE: SessionValue = { status: "none", account: undefined, main: undefined, enable: async () => false };
export const SessionContext = createContext<SessionValue>(NONE);
export const useSession = () => useContext(SessionContext);

/**
 * The trading wallet of the connected main wallet, and the ONLY wallet that trades: it signs in the browser, so trading needs no
 * prompt. It is opened by itself when a wallet connects (the key is found in the browser, or, if the browser has lost it, by one
 * signature from the main wallet, which the person is asked for straight away). A person who declines is not asked again in a
 * loop and is never quietly given the main wallet to trade with: the trading wallet stays unopened and says how to open it.
 * Outside this provider, and for a wallet that signs by itself, there is no session.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const kind = useWalletKind();
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<{ status: SessionStatus; account?: SessionAccount }>({ status: "none" });
  // One prompt for each wallet during a visit: a refusal is an answer, not something to keep asking about.
  const asked = useRef(new Set<string>());

  const enable = useCallback(async (): Promise<boolean> => {
    if (!address || kind !== "external") return false;
    try {
      const account = await loadOrCreateSession(address, (message) => signMessageAsync({ message }));
      setState({ status: "ready", account });
      return true;
    } catch (e) {
      if (e instanceof SessionMismatchError) {
        setState({ status: "mismatch" });
        return false;
      }
      if (isUserRejection(e)) return false;
      throw e;
    }
  }, [address, kind, signMessageAsync]);

  useEffect(() => {
    let cancelled = false;
    if (!address || kind !== "external") {
      setState({ status: "none" });
      return;
    }
    setState({ status: "restoring" });
    void restoreSession(address).then((account) => {
      if (cancelled) return;
      if (account) return setState({ status: "ready", account });
      setState({ status: "needs-signature" });
      const key = address.toLowerCase();
      if (asked.current.has(key)) return;
      asked.current.add(key);
      void enable().catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
    // `enable` changes with the signer; what decides a fresh start is the wallet, not the callback.
  }, [address, kind]);

  const value = useMemo<SessionValue>(
    () => ({ status: state.status, account: state.account, main: kind === "external" ? address : undefined, enable }),
    [state, kind, address, enable],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { SESSION_MESSAGE };
