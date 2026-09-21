"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chainBySlug, UI } from "@vezta/shared";
import { useEffect, useState, type ReactNode } from "react";
import { useIdentity } from "@/lib/wallet/use-identity";
import { useSiwe } from "@/lib/auth/use-siwe";
import { getModerationApi } from "@/lib/moderation/client";
import { Button } from "../ui/button";
import { BanForm } from "./ban-form";
import { HealthPanel } from "./health-panel";
import { ReportsTable } from "./reports-table";
import { StuckTokens } from "./stuck-tokens";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Failed = () => (
  <p role="alert" className="py-4 text-sm text-muted-foreground">
    {UI.admin.loadFailed}
  </p>
);

/**
 * The operator's page. For anyone who is not a signed-in admin it draws what any missing page draws, and asks the admin API
 * for nothing: the routes refuse such a person anyway, and this way there is no trace of them here either. A section that
 * cannot be loaded says so without taking the others down.
 */
export function AdminPanel({ chain }: { chain: string }) {
  const { address } = useIdentity();
  const { isAdmin, isSignedIn, isLoading, signIn } = useSiwe();
  const queryClient = useQueryClient();
  const config = chainBySlug(chain);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);

  const api = getModerationApi();
  const healthKey = ["admin", "health", chain, address];
  const reportsKey = ["admin", "reports", chain, address];
  const health = useQuery({
    queryKey: healthKey,
    queryFn: () => api.health(chain),
    enabled: isAdmin,
    refetchInterval: 15_000,
    retry: false,
  });
  const reports = useQuery({
    queryKey: reportsKey,
    queryFn: () => api.reports(chain),
    enabled: isAdmin,
    refetchInterval: 30_000,
    retry: false,
  });

  if (address && isLoading) return null;
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
        <p role="alert">{UI.errors.pageNotFound}</p>
        {/* A wallet with no session cannot be told from an admin's until it signs in. (The API is what keeps this page's data
            from anyone else; this route exists for everyone.) Someone already signed in has no need of it. */}
        {address && !isSignedIn && (
          <Button size="xs" variant="ghost" onClick={() => void signIn().catch(() => undefined)}>
            {UI.comments.signIn}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{UI.admin.title}</h1>
      <Section title={UI.admin.health.title}>
        {health.data ? (
          <HealthPanel
            health={health.data}
            now={now}
            decimals={config?.quoteDecimals ?? 18}
            symbol={config?.quoteSymbol ?? "ETH"}
            onRetryMetadata={async () => {
              const result = await api.reResolveMetadata(chain);
              await queryClient.invalidateQueries({ queryKey: healthKey });
              return result;
            }}
          />
        ) : health.isError ? (
          <Failed />
        ) : null}
      </Section>
      <Section title={UI.admin.stuck.title}>
        {health.data ? <StuckTokens chain={chain} tokens={health.data.stuckTokens} now={now} /> : health.isError ? <Failed /> : null}
      </Section>
      <Section title={UI.admin.reports.title}>
        {reports.data ? (
          <ReportsTable
            chain={chain}
            items={reports.data.items}
            now={now}
            onResolve={async (id) => {
              await api.resolveReport(chain, id);
              await queryClient.invalidateQueries({ queryKey: reportsKey });
            }}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: reportsKey })}
          />
        ) : reports.isError ? (
          <Failed />
        ) : null}
      </Section>
      <Section title={UI.admin.ban.title}>
        <BanForm chain={chain} />
      </Section>
    </div>
  );
}
