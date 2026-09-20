"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { isUserRejection } from "../wallet/self-custody";
import { loadOrCreateSession, restoreSession, SESSION_MESSAGE, SessionMismatchError } from "./derive";
import type { SessionAccount } from "./types";

export type SessionStatus =
  /** Trading is with the person's own wallet. */
  | "off"
  /** It is on, and the stored wallet is being opened. */
  | "restoring"
  | "ready"
  /** It is on, but the browser no longer has the key: one signature brings it back. Never a silent fallback to the main wallet. */
  | "needs-signature"
  /** The main wallet signed differently than it did the first time. Blocking: see SessionMismatchError. */
  | "mismatch";

export interface SessionValue {
  status: SessionStatus;
  account: SessionAccount | undefined;
  /** Turns the session wallet on. Asks the main wallet for a signature only if the key is not already stored. False if declined. */
  enable(): Promise<boolean>;
  /** Back to the main wallet. The session wallet, and what it holds, stay where they are. */
  disable(): void;
}

const OFF: SessionValue = { status: "off", account: undefined, enable: async () => false, disable: () => {} };
const SessionContext = createContext<SessionValue>(OFF);
export const useSession = () => useContext(SessionContext);

const activeKey = (main: string) => `vezta.session.${main.toLowerCase()}.active`;
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Whether the person trades from a session wallet, per main wallet. "On" is a flag in this browser; the wallet itself is
 * found by restoreSession (no signature) or, if the browser has lost it, by one signature. Outside this provider the
 * session is simply off, so nothing that does not know about it changes.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<{ status: SessionStatus; account?: SessionAccount }>({ status: "off" });

  useEffect(() => {
    let cancelled = false;
    if (!address || read(activeKey(address)) !== "1") {
      setState({ status: "off" });
      return;
    }
    setState({ status: "restoring" });
    void restoreSession(address).then((account) => {
      if (!cancelled) setState(account ? { status: "ready", account } : { status: "needs-signature" });
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    try {
      const account = await loadOrCreateSession(address, (message) => signMessageAsync({ message }));
      localStorage.setItem(activeKey(address), "1");
      setState({ status: "ready", account });
      return true;
    } catch (e) {
      if (e instanceof SessionMismatchError) {
        localStorage.setItem(activeKey(address), "1");
        setState({ status: "mismatch" });
        return false;
      }
      if (isUserRejection(e)) return false;
      throw e;
    }
  }, [address, signMessageAsync]);

  const disable = useCallback(() => {
    if (address) localStorage.removeItem(activeKey(address));
    setState({ status: "off" });
  }, [address]);

  const value = useMemo<SessionValue>(() => ({ ...state, account: state.account, enable, disable }), [state, enable, disable]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { SESSION_MESSAGE };
