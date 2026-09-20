"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Hash } from "viem";

export interface LastTrade {
  message: string;
  hash?: Hash;
}

interface Value {
  last: LastTrade | undefined;
  setLast: (trade: LastTrade) => void;
}

const LastTradeContext = createContext<Value>({ last: undefined, setLast: () => {} });

/**
 * Remembers what the person's latest trade was, above the panels. A purchase that fills the curve replaces the whole
 * trading area with GRADUATING… in the same moment it confirms, taking the panel's own confirmation with it; this is
 * where the confirmation lives on. Used outside a provider, it simply remembers nothing.
 */
export function LastTradeProvider({ children }: { children: ReactNode }) {
  const [last, setLast] = useState<LastTrade | undefined>();
  const value = useMemo(() => ({ last, setLast }), [last]);
  return <LastTradeContext.Provider value={value}>{children}</LastTradeContext.Provider>;
}

export const useLastTrade = () => useContext(LastTradeContext);
