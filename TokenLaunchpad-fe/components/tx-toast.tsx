import { chainBySlug, UI } from "@vezta/shared";
import { explorerTxUrl } from "@/lib/explorer";
import type { TxState } from "@/lib/tx/use-tx-run";

/** What a transaction is doing, in words. A link to it appears only for a real transaction hash. */
export function TxToast({ state, chain }: { state: TxState; chain: string }) {
  if (state.status === "idle") return null;

  if (state.status === "pending") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {UI.tx.pending}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }

  const url = state.hash ? explorerTxUrl(chainBySlug(chain), state.hash) : undefined;
  return (
    <p role="status" className="text-sm text-buy">
      {state.message}{" "}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
          View transaction
        </a>
      )}
    </p>
  );
}
