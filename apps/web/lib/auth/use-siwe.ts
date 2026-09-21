"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { isUserRejection } from "../wallet/self-custody";
import { TradeError } from "../wallet/types";
import { getAuthApi } from "./client";

const ME = ["siwe", "me"] as const;

/**
 * Whether the connected wallet has a session with the API, and how to get one. The session is a cookie the browser
 * keeps and this code never sees. Being signed in means the session belongs to the wallet that is connected NOW: a
 * session for another address (the person switched accounts) counts as signed out.
 */
export function useSiwe() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const api = useMemo(getAuthApi, []);

  // null, not undefined, for "nobody": react-query refuses a query that resolves to undefined and keeps the old answer,
  // which would leave a person looking signed in after they signed out.
  const session = useQuery({ queryKey: [...ME, address], queryFn: async () => (await api.me()) ?? null, staleTime: 60_000, enabled: !!address });
  const isSignedIn = !!address && session.data?.address.toLowerCase() === address.toLowerCase();
  /** For drawing controls only: the API decides who may actually moderate, on every request. */
  const isAdmin = isSignedIn && session.data?.admin === true;

  /** True once signed in, false if the person declined to sign. Any other failure is thrown for the caller to explain. */
  async function signIn(): Promise<boolean> {
    if (!address) throw new TradeError("not_connected", "Connect a wallet first.");
    const { message } = await api.nonce(address);
    let signature: `0x${string}`;
    try {
      signature = await signMessageAsync({ message });
    } catch (e) {
      if (isUserRejection(e)) return false;
      throw e;
    }
    await api.verify(message, signature);
    await queryClient.invalidateQueries({ queryKey: ME });
    return true;
  }

  async function signOut(): Promise<void> {
    await api.logout();
    await queryClient.invalidateQueries({ queryKey: ME });
  }

  return { isSignedIn, isAdmin, isLoading: session.isLoading, signIn, signOut };
}
