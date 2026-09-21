import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewBuyLocal } from "@vezta/shared";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { testWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { useBuyQuote } from "./use-buy-quote";
import { useCurve } from "./use-curve";
import { useLaunchTax } from "./use-launch-tax";
import { useSellQuote } from "./use-sell-quote";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

function setup(initial = {}) {
  const chain = fakeChain(initial);
  const { wrapper } = testWallet(undefined, chain.transport);
  return { chain, wrapper };
}

describe("useCurve", () => {
  it("reads the curve from the chain and derives status, progress and price", async () => {
    const { chain, wrapper } = setup();
    const { result } = renderHook(() => useCurve(TOKEN), { wrapper });
    await waitFor(() => expect(result.current.curve).toBeDefined());
    expect(chain.calls).toContain("getCurve");
    expect(result.current.status).toBe("trading");
    expect(result.current.progressBps).toBe(0n);
    expect(result.current.spotPrice).toBeGreaterThan(0n);
  });

  it("follows the curve: when it completes and migrates, the status changes without a reload", async () => {
    const { chain, wrapper } = setup();
    const { result } = renderHook(() => useCurve(TOKEN, { refetchMs: 30 }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("trading"));
    chain.set({ curve: freshCurve({ complete: true }) });
    await waitFor(() => expect(result.current.status).toBe("awaiting-migration"));
    chain.set({ curve: freshCurve({ complete: true, migrated: true }) });
    await waitFor(() => expect(result.current.status).toBe("migrated"));
  });

  it("reads nothing without a token", () => {
    const { chain, wrapper } = setup();
    renderHook(() => useCurve(undefined), { wrapper });
    expect(chain.calls).toEqual([]);
  });
});

describe("useLaunchTax", () => {
  it("counts down to the end of the window on the CHAIN's clock, not the browser's", async () => {
    // launched at 1_700_000_000 with a 600 s window; the chain says it is 100 s in.
    const { wrapper } = setup({ curve: freshCurve({ launchTime: 1_700_000_000n, antiSniperWindow: 600 }), taxBps: 9000n, blockTimestamp: 1_700_000_100n });
    const { result } = renderHook(() => useLaunchTax(TOKEN), { wrapper });
    await waitFor(() => expect(result.current.bps).toBe(9000n));
    expect(result.current.endsAt).toBe(1_700_000_600n);
    expect(result.current.secondsLeft).toBe(500);
  });

  it("is zero after the window, however long ago", async () => {
    const { wrapper } = setup({ curve: freshCurve({ launchTime: 1_700_000_000n, antiSniperWindow: 60 }), taxBps: 0n, blockTimestamp: 1_800_000_000n });
    const { result } = renderHook(() => useLaunchTax(TOKEN), { wrapper });
    await waitFor(() => expect(result.current.secondsLeft).toBe(0));
    expect(result.current.bps).toBe(0n);
  });
});

describe("useBuyQuote", () => {
  it("quotes locally on every keystroke, with no round trip, then checks the chain after a pause", async () => {
    const { chain, wrapper } = setup();
    const { result, rerender } = renderHook(({ budget }) => useBuyQuote({ token: TOKEN, budget, debounceMs: 40 }), {
      wrapper,
      initialProps: { budget: 10n ** 16n },
    });
    await waitFor(() => expect(result.current.total).toBeGreaterThan(0n));
    const first = result.current.amount;
    rerender({ budget: 2n * 10n ** 16n });
    // Immediately, in the same render: more budget, more tokens. No previewBuy was needed for that.
    expect(result.current.amount).toBeGreaterThan(first);
    await waitFor(() => expect(chain.calls).toContain("previewBuy"));
    await waitFor(() => expect(result.current.isStale).toBe(false));
  });

  it("is stale when the chain disagrees by more than a wei about what the tokens cost", async () => {
    const { wrapper } = setup({ previewBuyOverride: (amount: bigint) => [amount, 10n ** 17n, 10n ** 15n] });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 20 }), { wrapper });
    await waitFor(() => expect(result.current.isStale).toBe(true));
  });

  it("is stale when only the price moved, even inside the tax window where the fee is expected to differ", async () => {
    const curve = freshCurve();
    const { wrapper } = setup({
      curve,
      taxBps: 500n,
      previewBuyOverride: (amount: bigint) => {
        const local = previewBuyLocal(curve, { feeBps: 100n, taxBps: 500n }, amount);
        return [local.amountOut, local.quoteCost + 10n ** 12n, local.fee]; // someone else bought first
      },
    });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 20 }), { wrapper });
    await waitFor(() => expect(result.current.isStale).toBe(true));
  });

  it("is NOT stale when only the fee differs inside the tax window: the tax falls every second", async () => {
    const curve = freshCurve();
    const { chain, wrapper } = setup({
      curve,
      taxBps: 500n,
      previewBuyOverride: (amount: bigint) => {
        const local = previewBuyLocal(curve, { feeBps: 100n, taxBps: 500n }, amount);
        return [local.amountOut, local.quoteCost, local.fee - 10n ** 12n]; // the chain's tax was a moment lower
      },
    });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 20 }), { wrapper });
    await waitFor(() => expect(chain.calls).toContain("previewBuy"));
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(result.current.isStale).toBe(false);
  });

  it("does not ask the chain to preview a purchase of nothing", async () => {
    const { chain, wrapper } = setup();
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 0n, debounceMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(chain.calls).not.toContain("previewBuy");
  });

  it("states the multiplier inside the launch-tax window: about 50x at 98%", async () => {
    const { wrapper } = setup({ taxBps: 9800n });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 20 }), { wrapper });
    await waitFor(() => expect(result.current.taxMultiplier).toBeGreaterThan(49));
    expect(result.current.taxMultiplier).toBeLessThan(51);
    expect(result.current.launchTax).toBeGreaterThan(0n);
  });

  it("when the curve completes it stops quoting and says so, instead of surfacing the revert", async () => {
    const { chain, wrapper } = setup({ curve: freshCurve({ complete: true }), previewBuyRevert: "CurveCompleted" });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.curveCompleted).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(chain.calls).not.toContain("previewBuy");
    expect(result.current.total).toBe(0n);
  });

  it("reports curveCompleted when previewBuy itself reverts with CurveCompleted, before the curve read has caught up", async () => {
    // The curve read still says trading, but the chain has moved on: the preview is what notices.
    const { wrapper } = setup({ previewBuyRevert: "CurveCompleted" });
    const { result } = renderHook(() => useBuyQuote({ token: TOKEN, budget: 10n ** 16n, debounceMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.curveCompleted).toBe(true));
  });
});

describe("useSellQuote", () => {
  it("prices a sale: what the curve pays, the fee, and what the seller receives", async () => {
    const { wrapper } = setup({ curve: freshCurve({ virtualTokenReserves: (10n ** 27n * 16n) / 15n - 10n ** 25n, virtualQuoteReserves: 20_000_000_000_000_000n }) });
    const { result } = renderHook(() => useSellQuote({ token: TOKEN, amount: 10n ** 24n }), { wrapper });
    await waitFor(() => expect(result.current.payout).toBeGreaterThan(0n));
    expect(result.current.payout).toBe(result.current.quoteOut - result.current.fee);
  });

  it("is zero for nothing", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useSellQuote({ token: TOKEN, amount: 0n }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.payout).toBe(0n);
  });
});
