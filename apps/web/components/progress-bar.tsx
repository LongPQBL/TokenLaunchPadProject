import { cn } from "@/lib/utils";

/**
 * How far a curve is from graduating, as one bar for every place it is drawn (a table row, a card, the token's page). The caller gives
 * it its size. It is the primary colour and still until the curve is full; then it turns green and shimmers, which is the moment
 * worth noticing: the token is about to move to Uniswap. The shimmer is decoration, and is left out for anyone who asks for less motion.
 */
export function ProgressBar({ bps, label, className }: { bps: number; label: string; className?: string }) {
  const clamped = Number.isFinite(bps) ? Math.min(Math.max(bps, 0), 10_000) : 0;
  const full = clamped >= 10_000;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped / 100)}
      data-full={full ? "true" : undefined}
      className={cn("bg-secondary", className)}
    >
      <div className={cn("h-full", full ? "bg-success progress-full" : "bg-primary")} style={{ width: `${clamped / 100}%` }} />
    </div>
  );
}
