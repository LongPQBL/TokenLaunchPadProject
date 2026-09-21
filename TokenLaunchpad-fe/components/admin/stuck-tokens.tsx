"use client";

import { chainBySlug, neutraliseBidi, UI } from "@vezta/shared";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { migrateToken } from "@/lib/admin/migrate";
import { getDeployment } from "@/lib/deployment";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import type { Health } from "@/lib/types";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useSigner } from "@/lib/wallet/use-signer";
import { ChainGuard } from "../chain-guard";
import { Button } from "../ui/button";

type Stuck = Health["stuckTokens"][number];

/** Finishes one curve from the admin's own (trading) wallet. `migrate` is permissionless, so no special right is needed, only gas. */
function MigrateButton({ token }: { token: string }) {
  const signer = useSigner();
  const publicClient = usePublicClient();
  const { state, run } = useTxRun();
  const deployment = getDeployment();
  if (!deployment || !publicClient) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="xs"
        variant="outline"
        disabled={state.status === "pending"}
        onClick={() =>
          void run(
            () =>
              migrateToken(
                {
                  launchpad: deployment.launchpad,
                  expectedChainId: deployment.chainId,
                  chainId: signer.chainId,
                  account: signer.account,
                  localAccount: signer.localAccount,
                  walletClient: signer.walletClient,
                  publicClient,
                },
                token as `0x${string}`,
              ),
            ({ hash }) => ({ message: UI.admin.stuck.migrated, hash }),
          )
        }
      >
        {state.status === "pending" ? UI.admin.stuck.migrating : UI.admin.stuck.migrate}
      </Button>
      {state.status === "success" && (
        <span role="status" className="text-xs text-muted-foreground">
          {state.message}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      )}
    </div>
  );
}

/** Curves that have filled and are still waiting for their pool. Names are a stranger's text: drawn as text, direction controls removed. */
export function StuckTokens({ chain, tokens, now }: { chain: string; tokens: Stuck[]; now: number }) {
  const chainName = chainBySlug(chain)?.name ?? chain;
  if (tokens.length === 0) {
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {UI.admin.stuck.empty}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{UI.admin.stuck.help}</p>
      <ul className="divide-y divide-border border border-border">
        {tokens.map((t) => (
          <li key={t.address} data-testid="stuck-token" className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="break-all">
                {neutraliseBidi(t.name ?? "")}{" "}
                {t.ticker && <span className="font-mono text-muted-foreground">{neutraliseBidi(t.ticker)}</span>}
              </span>
              <Link href={`/${chain}/token/${t.address}`} className="font-mono text-xs text-muted-foreground hover:underline">
                {shortAddress(t.address)}
              </Link>
              <span className="text-xs text-muted-foreground">{UI.admin.stuck.since(formatRelativeTime(t.completeSince, now))}</span>
            </div>
            <ChainGuard chainName={chainName}>
              <MigrateButton token={t.address} />
            </ChainGuard>
          </li>
        ))}
      </ul>
    </div>
  );
}
