"use client";

import { UI } from "@vezta/shared";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useSiwe } from "@/lib/auth/use-siwe";
import { getFavoritesApi } from "@/lib/favorites/client";
import type { TokenSort } from "@/lib/types";
import type { LiveClient } from "@/lib/ws/client";
import { requestLogin } from "@/lib/wallet/login-trigger";
import { LiveTokenGrid } from "./live-discover";
import { Button } from "./ui/button";

/**
 * The tokens a person has starred, as the same table discover has. It needs a session, so before one it says to log in: a
 * connected wallet signs in from here, and with no wallet the header's own login opens. The list is fetched for the signed-in
 * person only, and follows the socket like discover does (a trade moves a row); a token whose star is taken off leaves at once.
 */
export function WatchlistView({ chain, sort, client }: { chain: string; sort: TokenSort; client?: LiveClient }) {
  const { address } = useAccount();
  const { isSignedIn, isLoading, signIn } = useSiwe();
  const list = useQuery({
    queryKey: ["watchlist", chain, address?.toLowerCase()],
    queryFn: () => getFavoritesApi().watchlist(chain),
    enabled: isSignedIn,
    retry: false,
  });

  if (!isSignedIn) {
    // Whether there is a session is not known yet: not "log in" for someone who is.
    if (address && isLoading) return <p role="status" className="py-16 text-center text-muted-foreground">{UI.watchlist.loading}</p>;
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">{UI.watchlist.loggedOut}</p>
        {address ? (
          <Button variant="outline" onClick={() => void signIn().catch(() => undefined)}>
            {UI.watchlist.signIn}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => requestLogin()}>
            {UI.watchlist.login}
          </Button>
        )}
      </div>
    );
  }
  if (list.isPending) return <p role="status" className="py-16 text-center text-muted-foreground">{UI.watchlist.loading}</p>;
  if (list.isError)
    return (
      <p role="alert" className="py-16 text-center text-muted-foreground">
        {UI.errors.loadFailed}
      </p>
    );
  if (list.data.length === 0)
    return (
      <p role="status" className="py-16 text-center text-muted-foreground">
        {UI.watchlist.empty}
      </p>
    );
  return (
    // Keyed by the sort, so pressing a header starts the list afresh instead of holding the arrangement it had.
    <LiveTokenGrid
      key={sort}
      chain={chain}
      initial={list.data}
      sort={sort}
      q=""
      firstPage
      view="table"
      watchlist
      sortHref={(next) => `/${chain}/watchlist${next === "new" ? "" : `?sort=${next}`}`}
      client={client}
    />
  );
}
