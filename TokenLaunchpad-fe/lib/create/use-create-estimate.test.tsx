import { act, renderHook, waitFor } from "@testing-library/react";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { testWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { useCreateEstimate } from "./use-create-estimate";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const args = { name: "Demo", ticker: "DEMO", antiSniperWindow: 60 as const };

describe("useCreateEstimate", () => {
  it("reads the creation fee from the chain, even with no wallet connected", async () => {
    const chain = fakeChain({ createFee: 7_000_000_000_000_000n });
    const { wrapper } = testWallet(undefined, chain.transport);
    const { result } = renderHook(() => useCreateEstimate(args), { wrapper });
    await waitFor(() => expect(result.current.createFee).toBe(7_000_000_000_000_000n));
    expect(result.current.networkFee).toBeUndefined(); // nothing to estimate gas for yet
  });

  it("estimates the network fee as gas x gas price once a wallet is connected", async () => {
    const chain = fakeChain();
    const wallet = testWallet(undefined, chain.transport);
    const { result } = renderHook(() => useCreateEstimate(args), { wrapper: wallet.wrapper });
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    // the fake chain says 150,000 gas at 1 gwei
    await waitFor(() => expect(result.current.networkFee).toBe(150_000n * 1_000_000_000n));
  });

  it("makes no estimate for a form that is not filled in: an empty name is not something the form would send", async () => {
    const chain = fakeChain();
    const wallet = testWallet(undefined, chain.transport);
    const { result } = renderHook(() => useCreateEstimate({ ...args, name: "" }), { wrapper: wallet.wrapper });
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.networkFee).toBeUndefined();
  });
});
