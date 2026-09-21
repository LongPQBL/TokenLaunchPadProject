import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { SessionContext, type SessionValue } from "../session/use-session";
import { embeddedConnector, externalConnector, testWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { useSigner } from "./use-signer";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const trading = privateKeyToAccount(generatePrivateKey());
const ready: SessionValue = { status: "ready", account: trading, main: TEST_USER, enable: async () => true };

async function signer(session: SessionValue, embedded = false) {
  const wallet = testWallet([embedded ? embeddedConnector(TEST_USER) : externalConnector()], fakeChain().transport);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <wallet.wrapper>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </wallet.wrapper>
  );
  const hook = renderHook(() => useSigner(), { wrapper });
  await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return hook;
}

describe("useSigner", () => {
  it("is the trading wallet for an external wallet: its address, its own account, and the app's chain", async () => {
    const { result } = await signer(ready);
    await waitFor(() => expect(result.current.account).toBe(trading.address));
    expect(result.current.localAccount).toBe(trading);
    expect(result.current.chainId).toBe(sepolia.id);
    expect(result.current.walletClient).toBeDefined();
  });

  it("is nothing while the trading wallet is not open: it never stands in with the main wallet", async () => {
    const { result } = await signer({ status: "needs-signature", account: undefined, main: TEST_USER, enable: async () => false });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.account).toBeUndefined();
    expect(result.current.walletClient).toBeUndefined();
  });

  it("is the wallet itself for one that signs by itself, with no local account", async () => {
    const { result } = await signer({ status: "none", account: undefined, main: undefined, enable: async () => false }, true);
    await waitFor(() => expect(result.current.account?.toLowerCase()).toBe(TEST_USER));
    expect(result.current.localAccount).toBeUndefined();
  });
});
