import { act, renderHook } from "@testing-library/react";
import { UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { TradeError } from "../wallet/types";
import { useTxRun } from "./use-tx-run";

const HASH = `0x${"ab".repeat(32)}` as const;

/** A promise the test resolves by hand, so it can look at the state while the work is still in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("useTxRun", () => {
  it("is pending while the work runs, then success with the message built from the result", async () => {
    const { result } = renderHook(() => useTxRun());
    const work = deferred<{ hash: typeof HASH; n: number }>();
    let outcome: unknown;
    act(() => {
      void result.current.run(() => work.promise, (r) => ({ message: `got ${r.n}`, hash: r.hash })).then((r) => (outcome = r));
    });
    expect(result.current.state).toEqual({ status: "pending" });

    await act(async () => work.resolve({ hash: HASH, n: 7 }));
    expect(result.current.state).toEqual({ status: "success", message: "got 7", hash: HASH });
    expect(outcome).toEqual({ hash: HASH, n: 7 });
  });

  it("returns to idle, silently, when the person declines in their wallet", async () => {
    const { result } = renderHook(() => useTxRun());
    await act(async () => {
      await result.current.run(() => Promise.reject(new UserRejectedRequestError(new Error("no"))), () => ({ message: "x" }));
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("shows the friendly message for a failure, and returns undefined", async () => {
    const { result } = renderHook(() => useTxRun());
    let outcome: unknown = "unset";
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(new TradeError("wrong_chain", "raw")), () => ({ message: "x" }));
    });
    expect(result.current.state).toEqual({ status: "error", message: "Switch your wallet to the right network.", code: "wrong_chain" });
    expect(outcome).toBeUndefined();
  });

  it("ignores a second run while one is in flight, so a double click cannot buy twice", async () => {
    const { result } = renderHook(() => useTxRun());
    const work = deferred<number>();
    let calls = 0;
    const job = () => {
      calls++;
      return work.promise;
    };
    act(() => {
      void result.current.run(job, () => ({ message: "done" }));
    });
    await act(async () => {
      await result.current.run(job, () => ({ message: "again" }));
    });
    expect(calls).toBe(1);
    await act(async () => work.resolve(1));
  });

  it("can be cleared", async () => {
    const { result } = renderHook(() => useTxRun());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("x")), () => ({ message: "x" }));
    });
    expect(result.current.state.status).toBe("error");
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ status: "idle" });
  });
});
