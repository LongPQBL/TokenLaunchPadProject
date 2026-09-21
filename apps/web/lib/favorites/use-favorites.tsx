"use client";

import { UI } from "@vezta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { ApiError } from "../api";
import { useSiwe } from "../auth/use-siwe";
import { requestLogin } from "../wallet/login-trigger";
import { getFavoritesApi } from "./client";

interface Stars {
  starred: ReadonlySet<string>;
  /** Stars the token if it is not starred and unstars it if it is; logs in first if nobody is. */
  toggle: (token: string) => Promise<void>;
  error?: string;
}

const StarsContext = createContext<Stars | undefined>(undefined);

/** What to tell someone whose star could not be saved. The server's own text is never shown: only its code is read. */
function explain(error: unknown): string {
  const e = UI.favorites.errors;
  if (!(error instanceof ApiError)) return e.generic;
  if (error.code === "too_many") return e.tooMany;
  if (error.code === "rate_limited") return e.rateLimited;
  if (error.code === "network") return e.network;
  if (error.status === 401) return e.signedOut;
  return e.generic;
}

/**
 * The account's stars for one chain, shared by every star under it: one list is fetched, and each press changes it at once and
 * is put back if the server refuses. The list is asked for only while someone is signed in, and shown only then. Pressing a star
 * when nobody is signed in gets them in first: a connected wallet signs in, and with no wallet the header's own login opens.
 */
export function FavoritesProvider({ chain, children, onChange }: { chain: string; children: ReactNode; /** Told after the server accepted a change: which token, and whether it is now starred. */ onChange?: (token: string, starred: boolean) => void }) {
  const { address } = useAccount();
  const { isSignedIn, signIn } = useSiwe();
  const queryClient = useQueryClient();
  const api = useMemo(getFavoritesApi, []);
  const [error, setError] = useState<string>();
  const working = useRef(new Set<string>());
  const key = useMemo(() => ["favorites", chain, address?.toLowerCase()] as const, [chain, address]);
  const fetchList = useCallback(() => api.list(chain), [api, chain]);

  const list = useQuery({ queryKey: key, queryFn: fetchList, enabled: isSignedIn, staleTime: 30_000, retry: false });
  const starred = useMemo<ReadonlySet<string>>(() => new Set(isSignedIn ? list.data : []), [isSignedIn, list.data]);

  const toggle = useCallback(
    async (token: string) => {
      // A double press is one press: the second finds the first still on its way.
      if (working.current.has(token)) return;
      working.current.add(token);
      setError(undefined);
      try {
        if (!isSignedIn) {
          if (!address) {
            requestLogin();
            return;
          }
          try {
            if (!(await signIn())) return; // they declined to sign: their choice, not an error
          } catch {
            setError(UI.favorites.errors.signIn);
            return;
          }
        }
        let current: string[];
        try {
          current = await queryClient.fetchQuery({ queryKey: key, queryFn: fetchList, staleTime: 30_000 });
        } catch (e) {
          setError(explain(e));
          return;
        }
        const has = current.includes(token);
        queryClient.setQueryData(key, has ? current.filter((t) => t !== token) : [token, ...current]);
        try {
          await (has ? api.unstar(chain, token) : api.star(chain, token));
          // A watchlist that was loaded before this is out of date now: it asks again the next time it is looked at.
          void queryClient.invalidateQueries({ queryKey: ["watchlist", chain] });
          onChange?.(token, !has);
        } catch (e) {
          queryClient.setQueryData(key, current);
          setError(explain(e));
        }
      } finally {
        working.current.delete(token);
      }
    },
    [isSignedIn, address, signIn, queryClient, key, fetchList, api, chain, onChange],
  );

  const value = useMemo(() => ({ starred, toggle, error }), [starred, toggle, error]);
  return <StarsContext.Provider value={value}>{children}</StarsContext.Provider>;
}

/** The stars of the nearest FavoritesProvider, or nothing outside one. */
export const useStars = () => useContext(StarsContext);

/** Why the last press did not work, in words, for as long as it is the last thing that happened. */
export function FavoritesNotice() {
  const stars = useStars();
  if (!stars?.error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {stars.error}
    </p>
  );
}
