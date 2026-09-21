"use client";

import { UI } from "@vezta/shared";
import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { getDeployment } from "@/lib/deployment";
import { formatQuote } from "@vezta/shared";
import { listCandidateTokens } from "@/lib/session/holdings";
import type { SessionAccount } from "@/lib/session/types";
import { withdrawAll, type WithdrawResult } from "@/lib/session/withdraw";
import { friendlyError } from "@/lib/tx/errors";

/** Empties the trading wallet into the main wallet. What happened is said plainly, including what did NOT happen. */
export function WithdrawDialog({ chain, account }: { chain: string; account: SessionAccount }) {
  const { address: main } = useAccount();
  const publicClient = usePublicClient({ chainId: getDeployment()?.chainId });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WithdrawResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function run() {
    if (!main || !publicClient || running) return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const candidateTokens = await listCandidateTokens({ api, chain, sessionAddress: account.address, main });
      setResult(await withdrawAll({ account, to: main, connectedMain: main, publicClient, candidateTokens }));
    } catch (e) {
      setError(friendlyError(e).message);
    } finally {
      setRunning(false);
    }
  }

  const nothing = result && result.tokens === 0 && result.ethSent === 0n && result.failed.length === 0 && !result.ethKept;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          {UI.session.withdrawAll}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.session.withdrawTitle}</DialogTitle>
        <DialogDescription>{UI.session.withdrawBody}</DialogDescription>
        {main && <p className="mt-3 break-all font-mono text-xs">{UI.session.withdrawTo(main)}</p>}

        <Button className="mt-4 w-full" disabled={running || !main} onClick={() => void run()}>
          {UI.session.withdrawRun}
        </Button>

        <div className="mt-3 flex flex-col gap-2 text-sm">
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {nothing && <p role="status">{UI.session.withdrawNothing}</p>}
          {result && result.failed.length === 0 && !nothing && (result.tokens > 0 || result.ethSent > 0n) && (
            <p role="status" className="text-buy">
              {UI.session.withdrawDone(result.tokens, formatQuote(result.ethSent, 18, 6))}
            </p>
          )}
          {result && result.failed.length > 0 && (
            <div role="alert" className="text-destructive">
              <p>{UI.session.withdrawFailed(result.failed.length)}</p>
              <ul className="mt-1 break-all font-mono text-xs">
                {result.failed.map((f) => (
                  <li key={f.token}>{f.token}</li>
                ))}
              </ul>
            </div>
          )}
          {result?.ethKept === "token_failures" && <p className="text-muted-foreground">{UI.session.withdrawKeptForRetry}</p>}
          {result?.ethKept === "dust" && <p className="text-muted-foreground">{UI.session.withdrawDust}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
