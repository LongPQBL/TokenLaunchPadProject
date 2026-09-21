"use client";

import { formatQuote, UI } from "@vezta/shared";
import { useState, type ReactNode } from "react";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import { explainModerationError } from "@/lib/moderation/explain";
import type { Health } from "@/lib/types";
import { Button } from "../ui/button";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-testid="health-row"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-b-0"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-mono">{children}</span>
    </div>
  );
}

/**
 * What an operator needs to see at a glance. A figure the server could not get is "Unknown", never zero and never fine: the
 * indexer that cannot be reached must not read as "in sync", nor a balance nobody could read as an empty wallet.
 */
export function HealthPanel({
  health,
  now,
  decimals,
  symbol,
  onRetryMetadata,
}: {
  health: Health;
  now: number;
  decimals: number;
  symbol: string;
  onRetryMetadata: () => Promise<{ count: number }>;
}) {
  const t = UI.admin.health;
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function retry() {
    setRetrying(true);
    setResult(undefined);
    setProblem(undefined);
    try {
      setResult(t.retried((await onRetryMetadata()).count));
    } catch (e) {
      setProblem(explainModerationError(e));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section aria-label={t.title} className="border border-border px-4 py-2">
      <Row label={t.indexer}>
        {health.indexerLagBlocks === null ? t.unknown : health.indexerLagBlocks === 0 ? t.inSync : t.behind(health.indexerLagBlocks)}
      </Row>
      <Row label={t.watcher}>
        {health.watcherAliveSince === null ? t.notRunning : t.running(formatRelativeTime(health.watcherAliveSince, now))}
      </Row>
      <Row label={t.bot}>
        {health.botAddress && <span>{shortAddress(health.botAddress)}</span>}
        <span>{health.botBalance === null ? t.unknown : `${formatQuote(health.botBalance, decimals, 4)} ${symbol}`}</span>
      </Row>
      <Row label={t.failedMetadata}>
        {health.failedMetadataCount === 0 ? (
          t.none
        ) : (
          <>
            <span>{health.failedMetadataCount}</span>
            <Button size="xs" variant="outline" disabled={retrying} onClick={() => void retry()}>
              {retrying ? t.retrying : t.retry}
            </Button>
          </>
        )}
        {result && <span role="status">{result}</span>}
        {problem && (
          <span role="alert" className="text-destructive">
            {problem}
          </span>
        )}
      </Row>
    </section>
  );
}
