"use client";

import { useCallback, useRef, useState } from "react";
import type { Hash } from "viem";
import { friendlyError } from "./errors";

export type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; message: string; hash?: Hash }
  | { status: "error"; message: string; /** The friendlyError code: a panel can treat some failures as a state, not an error. */ code: string };

/**
 * Runs one transaction-shaped piece of work and keeps the state the panel shows for it. A person declining in their
 * wallet returns to idle without a word; any other failure becomes one friendly sentence. While a run is in flight a
 * second is ignored, so a double click cannot send the same purchase twice.
 */
export function useTxRun() {
  const [state, setState] = useState<TxState>({ status: "idle" });
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(work: () => Promise<T>, onSuccess: (result: T) => { message: string; hash?: Hash }): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setState({ status: "pending" });
    try {
      const result = await work();
      setState({ status: "success", ...onSuccess(result) });
      return result;
    } catch (e) {
      const friendly = friendlyError(e);
      setState(friendly.silent ? { status: "idle" } : { status: "error", message: friendly.message, code: friendly.code });
      return undefined;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset };
}
