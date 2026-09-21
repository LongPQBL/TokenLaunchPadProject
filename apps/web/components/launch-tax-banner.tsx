import { UI } from "@vezta/shared";
import { formatCountdown, formatMultiplier } from "@/lib/format";

/**
 * Shown above the buy form while the launch tax is on. It says what a buy costs as a multiple of the normal price,
 * because "98% tax" does not tell a person they are about to pay fifty times too much. Absent when there is no tax
 * or the numbers have not loaded.
 */
export function LaunchTaxBanner({ taxBps, multiplier, secondsLeft }: { taxBps: bigint | undefined; multiplier: number; secondsLeft: number | undefined }) {
  if (!taxBps || taxBps <= 0n || secondsLeft === undefined) return null;
  return (
    <p role="status" className="border border-warning px-3 py-2 text-sm text-warning">
      {UI.token.launchTaxBanner(formatMultiplier(multiplier), formatCountdown(secondsLeft))}
    </p>
  );
}
