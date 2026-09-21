"use client";

import { UI } from "@vezta/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { getApi } from "@/lib/api";
import { requestLogin } from "@/lib/wallet/login-trigger";
import { cn } from "@/lib/utils";
import { OrdersTable } from "./orders-table";
import { PositionsTable } from "./positions-table";
import { Button } from "./ui/button";

export type PositionsTab = "positions" | "orders";

const TABS: { tab: PositionsTab; label: string; href: (chain: string) => string }[] = [
  { tab: "positions", label: UI.positions.tabs.positions, href: (chain) => `/${chain}/positions` },
  { tab: "orders", label: UI.positions.tabs.orders, href: (chain) => `/${chain}/positions?tab=orders` },
];

const Notice = ({ children, role = "status" }: { children: React.ReactNode; role?: "status" | "alert" }) => (
  <p role={role} className="py-16 text-center text-muted-foreground">
    {children}
  </p>
);

/**
 * The connected wallet's positions and order history. Both are what the chain shows anyone, so no session is needed: they are asked
 * for by the wallet's own address, and only for the view that is showing. Before a wallet is connected it says so, with a button that
 * opens the header's login. Both are asked for again every so often while the page is open: positions follow the market, and an order shows once the indexer has it.
 */
export function PositionsView({ chain, tab }: { chain: string; tab: PositionsTab }) {
  const { address } = useAccount();
  const holder = address?.toLowerCase();
  const api = useMemo(getApi, []);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  // "3h ago" ages while the page is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);

  const positions = useQuery({
    queryKey: ["positions", chain, holder],
    queryFn: () => api.positions(chain, holder!),
    enabled: !!holder && tab === "positions",
    refetchInterval: 15_000,
    retry: false,
  });
  const orders = useInfiniteQuery({
    queryKey: ["orders", chain, holder],
    queryFn: ({ pageParam }) => api.orders(chain, holder!, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!holder && tab === "orders",
    // The indexer is a few seconds behind the chain: an order placed a moment ago is not there yet, and would otherwise stay missing.
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={UI.positions.tabs.label} className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            href={t.href(chain)}
            aria-current={t.tab === tab ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t.tab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {!holder ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">{UI.positions.connect}</p>
          <Button variant="outline" onClick={() => requestLogin()}>
            {UI.positions.connectButton}
          </Button>
        </div>
      ) : tab === "positions" ? (
        positions.isPending ? (
          <Notice>{UI.positions.loading}</Notice>
        ) : positions.isError ? (
          <Notice role="alert">{UI.errors.loadFailed}</Notice>
        ) : (
          <PositionsTable chain={chain} positions={positions.data.items} />
        )
      ) : orders.isPending ? (
        <Notice>{UI.positions.loading}</Notice>
      ) : orders.isError ? (
        <Notice role="alert">{UI.errors.loadFailed}</Notice>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full">
            <OrdersTable chain={chain} orders={orders.data.pages.flatMap((p) => p.items)} now={now} />
          </div>
          {orders.hasNextPage && (
            <Button variant="outline" size="sm" disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>
              {UI.positions.loadMore}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
