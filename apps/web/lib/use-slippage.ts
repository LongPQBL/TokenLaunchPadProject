"use client";

import { useCallback, useEffect, useState } from "react";

export const SLIPPAGE_KEY = "vezta.slippageBps";
const DEFAULT_BPS = 100n; // 1%
const MIN_BPS = 10n; // 0.1%: below this almost any trade fails
const MAX_BPS = 5_000n; // 50%: above this the bound protects nothing

const valid = (bps: bigint) => bps >= MIN_BPS && bps <= MAX_BPS;

function read(): bigint {
  try {
    const raw = localStorage.getItem(SLIPPAGE_KEY);
    if (raw && /^\d+$/.test(raw)) {
      const bps = BigInt(raw);
      if (valid(bps)) return bps;
    }
  } catch {
    /* storage blocked: the default is fine */
  }
  return DEFAULT_BPS;
}

/**
 * The slippage the person accepts, in basis points, kept in this browser. Storage is a convenience only: if it is
 * blocked the setting simply does not persist. An out-of-range value is refused rather than clamped, so a typo like
 * "500" (meaning 5%, typed as bps) cannot silently become 50%.
 */
export function useSlippage() {
  const [bps, setState] = useState<bigint>(DEFAULT_BPS);
  // Read after mount: the server render and the first client render must agree.
  useEffect(() => setState(read()), []);

  const setBps = useCallback((next: bigint) => {
    if (!valid(next)) return;
    setState(next);
    try {
      localStorage.setItem(SLIPPAGE_KEY, next.toString());
    } catch {
      /* not persisted */
    }
  }, []);

  return { bps, setBps };
}
