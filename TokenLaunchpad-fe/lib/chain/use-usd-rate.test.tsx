import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { testWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { useUsdRate } from "./use-usd-rate";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const NOW = () => BigInt(Math.floor(Date.now() / 1000));

function rate(chain: ReturnType<typeof fakeChain>, slug = "sepolia") {
  const wallet = testWallet(undefined, chain.transport);
  return renderHook(() => useUsdRate(slug), { wrapper: wallet.wrapper });
}

describe("useUsdRate", () => {
  it("reads the price and its decimals from the chain's feed", async () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n } });
    const { result } = rate(chain);
    await waitFor(() => expect(result.current).toEqual({ answer: 3_000n * 10n ** 8n, decimals: 8 }));
  });

  it("uses the feed's own decimals, not an assumed eight", async () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 18n, decimals: 18 } });
    const { result } = rate(chain);
    await waitFor(() => expect(result.current?.decimals).toBe(18));
  });

  it("is nothing while it is still asking, so no dollar amount is drawn before there is a price", () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n } });
    const { result } = rate(chain);
    expect(result.current).toBeUndefined();
  });

  it("is nothing when the feed does not answer, rather than a wrong price", async () => {
    const chain = fakeChain();
    const { result } = rate(chain);
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current).toBeUndefined();
  });

  it("is nothing when the feed says zero or a negative price", async () => {
    for (const answer of [0n, -1n]) {
      const chain = fakeChain({ usd: { answer } });
      const { result, unmount } = rate(chain);
      await waitFor(() => expect(chain.calls).toContain("feed:latestRoundData"));
      await new Promise((r) => setTimeout(r, 50));
      expect(result.current, String(answer)).toBeUndefined();
      unmount();
    }
  });

  it("is nothing when the price is more than a day old: a stale price would make every dollar amount wrong", async () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n, updatedAt: NOW() - 25n * 3600n } });
    const { result } = rate(chain);
    await waitFor(() => expect(chain.calls).toContain("feed:latestRoundData"));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBeUndefined();
  });

  it("still uses a price that is a few hours old", async () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n, updatedAt: NOW() - 3n * 3600n } });
    const { result } = rate(chain);
    await waitFor(() => expect(result.current).toBeDefined());
  });

  it("asks for nothing on a chain that has no feed", async () => {
    const chain = fakeChain({ usd: { answer: 3_000n * 10n ** 8n } });
    const { result } = rate(chain, "nochain");
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current).toBeUndefined();
    expect(chain.calls.filter((c) => c.startsWith("feed:"))).toEqual([]);
  });
});
