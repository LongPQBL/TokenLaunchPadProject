"use client";

import { neutraliseBidi, UI } from "@vezta/shared";
import Link from "next/link";
import { useState } from "react";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import { getModerationApi } from "@/lib/moderation/client";
import { explainModerationError } from "@/lib/moderation/explain";
import type { Report } from "@/lib/types";
import { Button } from "../ui/button";
import { ConfirmAction } from "./confirm-action";

function ReportRow({
  chain,
  report,
  now,
  onResolve,
  onChanged,
}: {
  chain: string;
  report: Report;
  now: number;
  onResolve: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function dismiss() {
    setBusy(true);
    setProblem(undefined);
    try {
      await onResolve(report.id);
    } catch (e) {
      setProblem(explainModerationError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="report-row" className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all">
          {neutraliseBidi(report.name ?? "")}{" "}
          {report.ticker && <span className="font-mono text-muted-foreground">{neutraliseBidi(report.ticker)}</span>}{" "}
          <Link href={`/${chain}/token/${report.token}`} className="font-mono text-xs text-muted-foreground hover:underline">
            {shortAddress(report.token)}
          </Link>
          {report.hidden && <span className="ml-2 text-xs uppercase text-muted-foreground">{UI.admin.reports.hidden}</span>}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {UI.admin.reports.by} {shortAddress(report.reporter)} · {formatRelativeTime(report.createdAt, now)}
        </span>
      </div>
      <p data-testid="report-reason" dir="auto" className="whitespace-pre-wrap break-all">
        {neutraliseBidi(report.reason)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!report.hidden && (
          <ConfirmAction
            label={UI.moderation.hideToken}
            title={UI.moderation.hideTokenTitle}
            body={UI.moderation.hideTokenBody}
            run={() => getModerationApi().hideToken(chain, report.token)}
            onDone={onChanged}
          />
        )}
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => void dismiss()}>
          {busy ? UI.admin.reports.dismissing : UI.admin.reports.dismiss}
        </Button>
        {problem && (
          <span role="alert" className="text-xs text-destructive">
            {problem}
          </span>
        )}
      </div>
    </li>
  );
}

/** The open reports, newest first. A reason and a token's name are strangers' text: drawn as text, direction controls removed. */
export function ReportsTable({
  chain,
  items,
  now,
  onResolve,
  onChanged,
}: {
  chain: string;
  items: Report[];
  now: number;
  onResolve: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  if (items.length === 0) {
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {UI.admin.reports.empty}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border border border-border">
      {items.map((report) => (
        <ReportRow key={report.id} chain={chain} report={report} now={now} onResolve={onResolve} onChanged={onChanged} />
      ))}
    </ul>
  );
}
