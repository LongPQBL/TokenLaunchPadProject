import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SLIPPAGE_KEY, useSlippage } from "./use-slippage";

beforeEach(() => localStorage.clear());

describe("useSlippage", () => {
  it("defaults to 1%", () => {
    const { result } = renderHook(() => useSlippage());
    expect(result.current.bps).toBe(100n);
  });

  it("remembers the choice across reloads", () => {
    const first = renderHook(() => useSlippage());
    act(() => first.result.current.setBps(300n));
    expect(first.result.current.bps).toBe(300n);
    first.unmount();

    const reloaded = renderHook(() => useSlippage());
    expect(reloaded.result.current.bps).toBe(300n);
  });

  it("refuses values that would protect nothing or allow anything: under 0.1% or over 50%", () => {
    const { result } = renderHook(() => useSlippage());
    act(() => result.current.setBps(0n));
    expect(result.current.bps).toBe(100n);
    act(() => result.current.setBps(5_001n));
    expect(result.current.bps).toBe(100n);
    act(() => result.current.setBps(10n));
    expect(result.current.bps).toBe(10n);
  });

  it("ignores a stored value that is not a valid setting", () => {
    localStorage.setItem(SLIPPAGE_KEY, "banana");
    expect(renderHook(() => useSlippage()).result.current.bps).toBe(100n);
    localStorage.setItem(SLIPPAGE_KEY, "999999");
    expect(renderHook(() => useSlippage()).result.current.bps).toBe(100n);
  });

  it("still works when the browser refuses storage", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      const { result } = renderHook(() => useSlippage());
      expect(result.current.bps).toBe(100n);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
