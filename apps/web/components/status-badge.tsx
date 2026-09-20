import { UI } from "@vezta/shared";
import { cn } from "@/lib/utils";

/**
 * Where the token is in its life. `migrated` wins: once the pool exists the token has graduated, whatever the
 * `complete` flag says, because a reader who sees GRADUATING… on a token that already trades on Uniswap is misled.
 */
export function StatusBadge({ complete, migrated }: { complete: boolean; migrated: boolean }) {
  const [label, tone] = migrated
    ? [UI.token.status.graduated, "border-primary text-primary"]
    : complete
      ? [UI.token.status.graduating, "border-warning text-warning"]
      : [UI.token.status.trading, "border-success text-success"];

  return (
    <span data-testid="status-badge" className={cn("inline-block border px-2 py-0.5 font-mono text-[0.65rem]", tone)}>
      {label}
    </span>
  );
}
